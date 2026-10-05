import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(here, '.fixtures');

interface Spec {
  name: string;
  width: number;
  height: number;
  background: string;
  color: string;
  lines: { text: string; x: number; y: number; size: number; weight?: string }[];
}

const SPECS: Spec[] = [
  {
    name: 'doc',
    width: 900,
    height: 420,
    background: '#ffffff',
    color: '#111111',
    lines: [
      { text: 'Quarterly report summary', x: 48, y: 90, size: 40, weight: 'bold' },
      { text: 'Revenue grew by 42 percent this year', x: 48, y: 190, size: 30 },
      { text: 'Contact the finance team for details', x: 48, y: 280, size: 28 },
      { text: 'Updated October 2026', x: 48, y: 360, size: 24 },
    ],
  },
  {
    name: 'dark',
    width: 720,
    height: 360,
    background: '#16213e',
    color: '#f5f5f5',
    lines: [
      { text: 'Welcome back', x: 60, y: 120, size: 48, weight: 'bold' },
      { text: 'Your order ships tomorrow', x: 60, y: 230, size: 32 },
    ],
  },
  {
    name: 'banner',
    width: 1200,
    height: 300,
    background: '#fff4d6',
    color: '#3b2400',
    lines: [{ text: 'Summer sale ends Sunday', x: 80, y: 180, size: 72, weight: 'bold' }],
  },
];

export default async function globalSetup() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const manifest: Record<string, unknown> = {};
  for (const spec of SPECS) {
    const out = await page.evaluate((s: Spec) => {
      const canvas = document.createElement('canvas');
      canvas.width = s.width;
      canvas.height = s.height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = s.background;
      ctx.fillRect(0, 0, s.width, s.height);
      ctx.fillStyle = s.color;
      ctx.textBaseline = 'alphabetic';
      const words: { text: string; x: number; y: number; w: number; h: number; line: number }[] = [];
      s.lines.forEach((line, lineIndex) => {
        ctx.font = `${line.weight ?? 'normal'} ${line.size}px Arial, "Liberation Sans", sans-serif`;
        ctx.fillText(line.text, line.x, line.y);
        let cursor = 0;
        for (const word of line.text.split(' ')) {
          const before = line.text.slice(0, line.text.indexOf(word, cursor));
          cursor = before.length + word.length;
          const startX = line.x + ctx.measureText(before).width;
          const m = ctx.measureText(word);
          words.push({
            text: word,
            x: startX - m.actualBoundingBoxLeft,
            y: line.y - m.actualBoundingBoxAscent,
            w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
            h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent,
            line: lineIndex,
          });
        }
      });
      return { png: canvas.toDataURL('image/png'), words };
    }, spec);
    writeFileSync(join(FIXTURE_DIR, `${spec.name}.png`), Buffer.from(out.png.split(',')[1], 'base64'));
    manifest[spec.name] = { width: spec.width, height: spec.height, lines: spec.lines.map((l) => l.text), words: out.words };
  }
  writeFileSync(join(FIXTURE_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  await browser.close();
}
