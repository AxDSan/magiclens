import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type BrowserContext, test as base, chromium, expect, type Page, type Worker } from '@playwright/test';

// The extension's service worker global, as seen from sw.evaluate().
declare const chrome: { storage: { local: { get(key: string): Promise<Record<string, any>>; set(items: object): Promise<void> } } };

export const EXTENSION = resolve('.output/chrome-mv3');
export const SITE = 'http://localhost:4599/index.html';
export const MOCK = 'http://127.0.0.1:4601';

export interface FixtureWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  line: number;
}
export interface Fixture {
  width: number;
  height: number;
  lines: string[];
  words: FixtureWord[];
}
export const FIXTURES: Record<string, Fixture> = JSON.parse(
  readFileSync(resolve('tests/e2e/.fixtures/manifest.json'), 'utf8'),
);

export const test = base.extend<{ context: BrowserContext; sw: Worker; page: Page }>({
  context: async ({}, use) => {
    // Profiles go under the project, not /tmp (RAM-backed on this machine).
    const profile = mkdtempSync(join(resolve('test-results'), 'profile-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    });
    await use(context);
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  },
  sw: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(sw);
  },
  page: async ({ context, sw }, use) => {
    void sw;
    const page = await context.newPage();
    await page.goto(SITE);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete));
    await use(page);
  },
});

export { expect };

export async function setSettings(sw: Worker, patch: Record<string, unknown>) {
  await sw.evaluate(async (patch) => {
    const current = (await chrome.storage.local.get('settings')).settings ?? {};
    await chrome.storage.local.set({ settings: { ...current, ...patch } });
  }, patch);
}

export async function useMockProvider(sw: Worker, engine: 'hybrid' | 'llm' | 'local') {
  await setSettings(sw, {
    engine,
    provider: 'custom',
    providers: { custom: { apiKey: '', baseUrl: `${MOCK}/v1`, model: 'mock-vision' } },
    boxFormat: 'xyxy1000',
  });
}

export async function scriptMock(script: Record<string, unknown>) {
  await fetch(`${MOCK}/mock/script`, { method: 'POST', body: JSON.stringify(script) });
}

/** Ground-truth line boxes of a fixture on the 0-1000 grid. */
export function truthLines(fixture: Fixture) {
  return fixture.lines.map((text, index) => {
    const words = fixture.words.filter((w) => w.line === index);
    const x0 = Math.min(...words.map((w) => w.x));
    const y0 = Math.min(...words.map((w) => w.y));
    const x1 = Math.max(...words.map((w) => w.x + w.w));
    const y1 = Math.max(...words.map((w) => w.y + w.h));
    return {
      text,
      bbox: [x0 / fixture.width, y0 / fixture.height, x1 / fixture.width, y1 / fixture.height].map((v) => Math.round(v * 1000)),
    };
  });
}

/** Opens the lens like a person would: hover the image, click the lens button. */
export async function lensByHover(page: Page, selector: string) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  const button = page.locator('magiclens-root .hbtn[data-show]');
  await button.waitFor({ state: 'visible', timeout: 5000 });
  await button.click();
}

export async function waitForState(page: Page, state: 'ready' | 'error' | 'refine' | 'scan', timeout = 60_000) {
  await page.locator(`magiclens-root .ov[data-state="${state}"]`).first().waitFor({ state: 'attached', timeout });
}

export interface SpanBox {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function overlaySpans(page: Page): Promise<SpanBox[]> {
  return page.evaluate(() => {
    const root = document.querySelector('magiclens-root')!.shadowRoot!;
    return [...root.querySelectorAll('.ov:not(.closing) .w')].map((span) => {
      const r = span.getBoundingClientRect();
      return { text: span.textContent ?? '', x: r.left, y: r.top, w: r.width, h: r.height };
    });
  });
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/**
 * Checks that each expected word (viewport coordinates) is covered by an overlay word with
 * the same text: horizontal IoU and vertical containment. Returns per-word details.
 */
export function matchWords(expected: { text: string; x: number; y: number; w: number; h: number }[], spans: SpanBox[]) {
  const results = expected.map((word) => {
    const candidates = spans.filter((s) => norm(s.text) === norm(word.text));
    let best = { iouX: 0, centerOk: false, span: null as SpanBox | null };
    for (const span of candidates) {
      const inter = Math.max(0, Math.min(span.x + span.w, word.x + word.w) - Math.max(span.x, word.x));
      const iouX = inter / (span.w + word.w - inter);
      const cy = word.y + word.h / 2;
      const centerOk = cy >= span.y - word.h * 0.2 && cy <= span.y + span.h + word.h * 0.2;
      if (iouX > best.iouX) best = { iouX, centerOk, span };
    }
    return { word: word.text, ...best };
  });
  const placed = results.filter((r) => r.iouX >= 0.6 && r.centerOk).length;
  return { results, placed, ratio: placed / expected.length };
}

/** Maps fixture word boxes to viewport boxes for an <img> laid out with object-fit. */
export async function expectedForImage(page: Page, selector: string, fixture: Fixture) {
  const layout = await page.locator(selector).evaluate((el: HTMLImageElement) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const px = (v: string) => parseFloat(v) || 0;
    return {
      x: r.left + px(s.borderLeftWidth) + px(s.paddingLeft),
      y: r.top + px(s.borderTopWidth) + px(s.paddingTop),
      w: r.width - px(s.borderLeftWidth) - px(s.paddingLeft) - px(s.borderRightWidth) - px(s.paddingRight),
      h: r.height - px(s.borderTopWidth) - px(s.paddingTop) - px(s.borderBottomWidth) - px(s.paddingBottom),
      fit: s.objectFit,
      pos: s.objectPosition.split(' ').map((v) => parseFloat(v) / 100),
      nw: el.naturalWidth,
      nh: el.naturalHeight,
    };
  });
  let scaleX = layout.w / layout.nw;
  let scaleY = layout.h / layout.nh;
  let offX = 0;
  let offY = 0;
  if (layout.fit === 'contain' || layout.fit === 'cover') {
    const s = layout.fit === 'contain' ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
    scaleX = scaleY = s;
    offX = (layout.w - layout.nw * s) * layout.pos[0];
    offY = (layout.h - layout.nh * s) * layout.pos[1];
  }
  return fixture.words.map((w) => ({
    text: w.text,
    x: layout.x + offX + w.x * scaleX,
    y: layout.y + offY + w.y * scaleY,
    w: w.w * scaleX,
    h: w.h * scaleY,
  }));
}
