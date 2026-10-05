import type { ImageSource, NBox } from '../shared/types';
import { clamp, CodedError, errorMessage } from '../shared/util';

/** Decoded, orientation-corrected pixels of the image being read. */
export interface Raster {
  canvas: OffscreenCanvas;
  width: number;
  height: number;
}

export interface EncodedImage {
  base64: string;
  mime: string;
  width: number;
  height: number;
}

function newCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new CodedError('INTERNAL', 'Canvas 2D context unavailable');
  return ctx;
}

function rasterFrom(source: CanvasImageSource, width: number, height: number): Raster {
  const canvas = newCanvas(width, height);
  const ctx = context(canvas);
  // Transparent PNGs (logos, stickers) read better on white than on black.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, width: canvas.width, height: canvas.height };
}

/** SVG and a few other formats only decode through an <img> element. */
async function decodeWithImageElement(blob: Blob): Promise<Raster> {
  if (typeof Image === 'undefined') throw new Error('No DOM image decoder here');
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    if (!width || !height) {
      width = 1024;
      height = 1024;
    }
    // Vector images have no fixed resolution: render them large enough to read.
    if (blob.type.includes('svg')) {
      const boost = clamp(2000 / Math.max(width, height), 1, 4);
      width *= boost;
      height *= boost;
    }
    return rasterFrom(img, width, height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeBlob(blob: Blob): Promise<Raster> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    try {
      return rasterFrom(bitmap, bitmap.width, bitmap.height);
    } finally {
      bitmap.close();
    }
  } catch (bitmapError) {
    try {
      return await decodeWithImageElement(blob);
    } catch {
      throw new CodedError(
        'DECODE_FAILED',
        `This image format could not be decoded (${blob.type || 'unknown type'}): ${errorMessage(bitmapError)}`,
      );
    }
  }
}

async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', signal });
  } catch (error) {
    if (signal?.aborted) throw new CodedError('CANCELLED', 'Cancelled');
    throw new CodedError('FETCH_FAILED', `Could not download the image: ${errorMessage(error)}`);
  }
  if (!response.ok) {
    throw new CodedError('FETCH_FAILED', `The image server answered ${response.status}`);
  }
  const blob = await response.blob();
  if (blob.type.startsWith('text/html') || blob.size === 0) {
    throw new CodedError('FETCH_FAILED', 'The image server did not return an image');
  }
  return blob;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

/** Turns an ImageSource into pixels. */
export async function acquire(source: ImageSource, signal?: AbortSignal): Promise<Raster> {
  if (source.kind === 'url') return decodeBlob(await fetchBlob(source.url, signal));
  if (source.kind === 'data') return decodeBlob(await dataUrlToBlob(source.dataUrl));

  if (!source.shot) throw new CodedError('CAPTURE_FAILED', 'The tab could not be captured');
  const shot = await decodeBlob(await dataUrlToBlob(source.shot));
  // Ratio of device pixels to CSS pixels, measured instead of trusting devicePixelRatio.
  const scale = shot.width / source.viewport.w;
  const x = clamp(Math.round(source.rect.x * scale), 0, shot.width - 1);
  const y = clamp(Math.round(source.rect.y * scale), 0, shot.height - 1);
  const w = clamp(Math.round(source.rect.w * scale), 1, shot.width - x);
  const h = clamp(Math.round(source.rect.h * scale), 1, shot.height - y);
  const canvas = newCanvas(w, h);
  context(canvas).drawImage(shot.canvas, x, y, w, h, 0, 0, w, h);
  return { canvas, width: w, height: h };
}

/** Resamples so the longest side is at most `maxSide` (and the area at most `maxPixels`). */
export function fit(raster: Raster, maxSide: number, maxPixels = Infinity): Raster {
  const scale = Math.min(
    1,
    maxSide / Math.max(raster.width, raster.height),
    Math.sqrt(maxPixels / (raster.width * raster.height)),
  );
  return scale >= 0.999 ? raster : resample(raster, scale);
}

export function resample(raster: Raster, scale: number): Raster {
  return resize(raster, raster.width * scale, raster.height * scale);
}

/** Resizes to exact dimensions with high-quality filtering. */
export function resize(raster: Raster, width: number, height: number): Raster {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  let current = raster;
  // Halve repeatedly for large reductions; one big drawImage step aliases thin strokes.
  while (current.width / 2 >= targetWidth && current.height / 2 >= targetHeight) {
    const half = newCanvas(current.width / 2, current.height / 2);
    const ctx = context(half);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(current.canvas, 0, 0, half.width, half.height);
    current = { canvas: half, width: half.width, height: half.height };
  }
  const canvas = newCanvas(targetWidth, targetHeight);
  const ctx = context(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current.canvas, 0, 0, canvas.width, canvas.height);
  return { canvas, width: canvas.width, height: canvas.height };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function encode(
  raster: Raster,
  maxSide: number,
  mime = 'image/jpeg',
  quality = 0.9,
): Promise<EncodedImage> {
  const fitted = fit(raster, maxSide);
  const blob = await fitted.canvas.convertToBlob({ type: mime, quality });
  const base64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  return { base64, mime: blob.type || mime, width: fitted.width, height: fitted.height };
}

export const toDataUrl = (image: EncodedImage) => `data:${image.mime};base64,${image.base64}`;

export function parseDataUrl(dataUrl: string): { mime: string; base64: string } {
  const match = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new CodedError('DECODE_FAILED', 'Malformed data URL');
  return { mime: match[1] || 'image/png', base64: match[2] };
}

/**
 * Estimates text and background colors for each box: two-means over the box pixels, where
 * the cluster that dominates the box border is the background.
 */
export function sampleColors(raster: Raster, boxes: NBox[]): { fg: string; bg: string }[] {
  const small = fit(raster, 1600);
  const { width, height } = small;
  const data = context(small.canvas).getImageData(0, 0, width, height).data;
  const hex = (r: number, g: number, b: number) =>
    `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;

  return boxes.map((box) => {
    const x0 = clamp(Math.floor(box.x * width), 0, width - 1);
    const y0 = clamp(Math.floor(box.y * height), 0, height - 1);
    const x1 = clamp(Math.ceil((box.x + box.w) * width), x0 + 1, width);
    const y1 = clamp(Math.ceil((box.y + box.h) * height), y0 + 1, height);
    const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 2500)));
    const pixels: number[][] = [];
    const border: boolean[] = [];
    for (let y = y0; y < y1; y += step) {
      for (let x = x0; x < x1; x += step) {
        const i = (y * width + x) * 4;
        pixels.push([data[i], data[i + 1], data[i + 2]]);
        border.push(y - y0 < step || y1 - y <= step || x - x0 < step || x1 - x <= step);
      }
    }
    if (pixels.length < 2) return { fg: '#000000', bg: '#ffffff' };

    const luma = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
    let a = pixels[0];
    let b = pixels[0];
    for (const p of pixels) {
      if (luma(p) < luma(a)) a = p;
      if (luma(p) > luma(b)) b = p;
    }
    let centers = [a.slice(), b.slice()];
    const labels = new Uint8Array(pixels.length);
    for (let iteration = 0; iteration < 6; iteration++) {
      const sums = [
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ];
      pixels.forEach((p, i) => {
        const d0 = (p[0] - centers[0][0]) ** 2 + (p[1] - centers[0][1]) ** 2 + (p[2] - centers[0][2]) ** 2;
        const d1 = (p[0] - centers[1][0]) ** 2 + (p[1] - centers[1][1]) ** 2 + (p[2] - centers[1][2]) ** 2;
        const label = d0 <= d1 ? 0 : 1;
        labels[i] = label;
        sums[label][0] += p[0];
        sums[label][1] += p[1];
        sums[label][2] += p[2];
        sums[label][3]++;
      });
      centers = sums.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[k]));
    }
    let borderVotes = 0;
    let borderCount = 0;
    let ones = 0;
    labels.forEach((label, i) => {
      ones += label;
      if (border[i]) {
        borderVotes += label;
        borderCount++;
      }
    });
    // The border decides; fall back to "the larger cluster is background".
    const bgIndex = borderCount
      ? borderVotes * 2 > borderCount
        ? 1
        : 0
      : ones * 2 > labels.length
        ? 1
        : 0;
    const bg = centers[bgIndex];
    let fg = centers[1 - bgIndex];
    // Flat regions give two nearly equal clusters; pick a readable text color instead.
    const contrast = Math.abs(luma(fg) - luma(bg));
    if (contrast < 40) fg = luma(bg) > 128 ? [17, 17, 17] : [250, 250, 250];
    return { fg: hex(fg[0], fg[1], fg[2]), bg: hex(bg[0], bg[1], bg[2]) };
  });
}
