import type { ImageSource, Rect } from '../shared/types';
import { boxModel, objectFitRect, toRect, visibleRect } from './geometry';

export type TargetKind = 'img' | 'video' | 'canvas' | 'svg' | 'background' | 'element';

/** Maps the analyzed image onto the element, relative to its border box (screen px). */
export interface FrameMap {
  /** Region of the element the overlay may draw in. */
  clip: Rect;
  /** Where image coordinate (0,0)-(1,1) lands. */
  frame: Rect;
}

export type Mapper = () => FrameMap;

let hostElement: Element | null = null;
export function setUiHost(host: Element) {
  hostElement = host;
}

export function targetKind(el: Element): TargetKind | null {
  if (el instanceof HTMLImageElement) return 'img';
  if (el instanceof HTMLVideoElement) return 'video';
  if (el instanceof HTMLCanvasElement) return 'canvas';
  if (el instanceof SVGSVGElement) return 'svg';
  if (el instanceof HTMLElement) {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none' && bg.includes('url(')) return 'background';
  }
  return null;
}

export function isSizable(rect: Rect, min = 64): boolean {
  return rect.w >= min * 0.75 && rect.h >= 24 && rect.w * rect.h >= min * min * 0.6;
}

/** elementsFromPoint that also looks inside open shadow roots. */
export function deepElementsFromPoint(
  x: number,
  y: number,
  root: Document | ShadowRoot = document,
  depth = 0,
): Element[] {
  const out: Element[] = [];
  const seen = new Set<Element>();
  for (const el of root.elementsFromPoint(x, y)) {
    if (el === hostElement) continue;
    const shadow = (el as HTMLElement).shadowRoot;
    if (shadow && depth < 4) {
      for (const inner of deepElementsFromPoint(x, y, shadow, depth + 1)) {
        if (!seen.has(inner)) {
          seen.add(inner);
          out.push(inner);
        }
      }
    }
    if (!seen.has(el)) {
      seen.add(el);
      out.push(el);
    }
  }
  return out;
}

/** The image-like element under a point, looking through transparent overlays. */
export function imageAt(x: number, y: number, min = 64): Element | null {
  const stack = deepElementsFromPoint(x, y).slice(0, 14);
  for (const el of stack) {
    if (el === document.documentElement || el === document.body) continue;
    const kind = targetKind(el);
    if (kind && kind !== 'element' && isSizable(toRect(el.getBoundingClientRect()), min)) return el;
  }
  return null;
}

function isOnTop(el: Element, rect: Rect): boolean {
  const top = deepElementsFromPoint(rect.x + rect.w / 2, rect.y + rect.h / 2)[0];
  return !!top && (top === el || el.contains(top) || top.contains(el));
}

const KIND_WEIGHT: Record<TargetKind, number> = {
  img: 1,
  canvas: 0.9,
  video: 0.8,
  background: 0.7,
  svg: 0.6,
  element: 0.3,
};

function candidates(min: number): Element[] {
  const found = new Set<Element>();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const el of document.querySelectorAll('img, video, canvas, svg')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw) found.add(el);
  }
  // Sample the viewport to find CSS backgrounds and images in shadow DOM.
  for (let gx = 1; gx <= 6; gx++) {
    for (let gy = 1; gy <= 6; gy++) {
      const el = imageAt((vw * gx) / 7, (vh * gy) / 7, min);
      if (el) found.add(el);
    }
  }
  return [...found].filter((el) => {
    const kind = targetKind(el);
    if (!kind) return false;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || parseFloat(style.opacity) < 0.1) return false;
    const vis = visibleRect(el);
    return !!vis && isSizable(vis, min);
  });
}

/** Picks the most prominent image in the viewport: big, central and not covered. */
export function findMainImage(min = 64): Element | null {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxDistance = Math.hypot(vw / 2, vh / 2);
  let best: Element | null = null;
  let bestScore = 0;
  for (const el of candidates(min)) {
    const vis = visibleRect(el);
    if (!vis) continue;
    const distance = Math.hypot(vis.x + vis.w / 2 - vw / 2, vis.y + vis.h / 2 - vh / 2);
    const centrality = 1 - (distance / maxDistance) * 0.6;
    const onTop = isOnTop(el, vis) ? 1 : 0.35;
    const score = vis.w * vis.h * centrality * onTop * KIND_WEIGHT[targetKind(el) ?? 'element'];
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

/** All readable images in view, top to bottom. */
export function visibleImages(min = 64, limit = 12): Element[] {
  const list = candidates(min);
  // Drop elements nested in another candidate (an <img> inside a background div).
  const outer = list.filter((el) => !list.some((other) => other !== el && other.contains(el) && targetKind(other) === 'background'));
  return outer
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
    .slice(0, limit)
    .map((entry) => entry.el);
}

export interface SourcePlan {
  kind: TargetKind;
  /** Undefined when the pixels can only be had by screenshot. */
  source?: ImageSource;
  mapper: Mapper;
  /** Alternate way to read pixels if the engine cannot download the URL. */
  readback?: () => Promise<string | null>;
}

function canvasToDataUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      }, 'image/png');
    } catch {
      // Tainted by cross-origin pixels.
      resolve(null);
    }
  });
}

function drawToDataUrl(source: CanvasImageSource, width: number, height: number): Promise<string | null> {
  if (!width || !height) return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  try {
    ctx.drawImage(source, 0, 0, width, height);
  } catch {
    return Promise.resolve(null);
  }
  return canvasToDataUrl(canvas);
}

function replacedMapper(el: Element, natural: () => [number, number]): Mapper {
  return () => {
    const box = boxModel(el);
    const [nw, nh] = natural();
    const placed = objectFitRect(
      box.style.objectFit,
      box.style.objectPosition,
      box.content.w,
      box.content.h,
      nw,
      nh,
      box.scale,
    );
    return {
      clip: box.content,
      frame: { x: box.content.x + placed.x, y: box.content.y + placed.y, w: placed.w, h: placed.h },
    };
  };
}

async function waitForImage(img: HTMLImageElement) {
  if (img.complete && img.naturalWidth) return;
  if (img.loading === 'lazy') img.loading = 'eager';
  await Promise.race([img.decode().catch(() => undefined), new Promise((r) => setTimeout(r, 4000))]);
}

export async function planSource(el: Element): Promise<SourcePlan> {
  const kind = targetKind(el) ?? 'element';
  if (el instanceof HTMLImageElement) {
    await waitForImage(el);
    const url = el.currentSrc || el.src;
    const mapper = replacedMapper(el, () => [el.naturalWidth, el.naturalHeight]);
    const readback = () => drawToDataUrl(el, el.naturalWidth, el.naturalHeight);
    if (el.naturalWidth && url) {
      if (url.startsWith('data:')) return { kind, mapper, source: { kind: 'data', dataUrl: url } };
      const sameOrigin = (() => {
        try {
          return new URL(url, location.href).origin === location.origin;
        } catch {
          return false;
        }
      })();
      // Same-origin and blob: pixels are readable here, which also covers images that
      // need the page's cookies.
      if (sameOrigin || url.startsWith('blob:')) {
        const dataUrl = await readback();
        if (dataUrl) return { kind, mapper, source: { kind: 'data', dataUrl } };
      }
      if (/^https?:/.test(url)) return { kind, mapper, source: { kind: 'url', url }, readback };
    }
    return { kind, mapper };
  }
  if (el instanceof HTMLVideoElement && el.videoWidth) {
    const mapper = replacedMapper(el, () => [el.videoWidth, el.videoHeight]);
    const dataUrl = await drawToDataUrl(el, el.videoWidth, el.videoHeight);
    return dataUrl ? { kind, mapper, source: { kind: 'data', dataUrl } } : { kind, mapper };
  }
  // Canvas (WebGL buffers read back blank), SVG, CSS backgrounds and arbitrary elements are
  // read from a screenshot: what you see is exactly what gets read.
  return { kind, mapper: () => ({ clip: boxModel(el).content, frame: boxModel(el).content }) };
}

/** Frame map for screenshot-based reads: the captured region, relative to the border box. */
export function captureMapper(el: Element, captured: Rect): Mapper {
  const at = toRect(el.getBoundingClientRect());
  const fx = (captured.x - at.x) / at.w;
  const fy = (captured.y - at.y) / at.h;
  const fw = captured.w / at.w;
  const fh = captured.h / at.h;
  return () => {
    const now = el.getBoundingClientRect();
    const rect = { x: fx * now.width, y: fy * now.height, w: fw * now.width, h: fh * now.height };
    return { clip: rect, frame: rect };
  };
}
