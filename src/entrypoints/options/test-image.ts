import type { EncodedImage } from '../../engine/image';
import type { NBox } from '../../shared/types';

export interface TestImage {
  image: EncodedImage;
  expected: { text: string; box: NBox }[];
}

/** Renders a small image with known text at known positions to check a provider end to end. */
export async function makeTestImage(): Promise<TestImage> {
  const width = 640;
  const height = 300;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#fdfbff');
  gradient.addColorStop(1, '#e9eefc');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const lines = [
    { text: 'MagicLens vision check', font: 'bold 34px Arial, sans-serif', x: 40, y: 80, color: '#1b1f3b' },
    { text: 'Invoice #4521 total $87.30', font: '26px Arial, sans-serif', x: 40, y: 160, color: '#333' },
    { text: 'Hello, world!', font: 'italic 30px Georgia, serif', x: 300, y: 245, color: '#7a2ec2' },
  ];
  const expected: TestImage['expected'] = [];
  for (const line of lines) {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(line.text, line.x, line.y);
    const m = ctx.measureText(line.text);
    expected.push({
      text: line.text,
      box: {
        x: (line.x - m.actualBoundingBoxLeft) / width,
        y: (line.y - m.actualBoundingBoxAscent) / height,
        w: (m.actualBoundingBoxLeft + m.actualBoundingBoxRight) / width,
        h: (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / height,
      },
    });
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { image: { base64: btoa(binary), mime: 'image/png', width, height }, expected };
}

export function iou(a: NBox, b: NBox): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, r - x) * Math.max(0, bottom - y);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}
