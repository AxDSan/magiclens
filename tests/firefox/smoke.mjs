// Firefox smoke test: installs the built extension into a real (headless) Firefox through
// WebDriver BiDi and checks two paths end to end:
//   1. local OCR: every word of the fixture lands on its glyphs;
//   2. AI-only reading through an Ollama-like server that refuses extension origins.
// Usage: npm run test:firefox (builds first). Starts the fixture servers if they are not up.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const serverUp = await fetch('http://localhost:4599/index.html').then(() => true, () => false);
if (!serverUp) await import('../e2e/server.mjs');

const MOCK = 'http://127.0.0.1:4601';
const ADDON_ID = 'magiclens@magiclens.dev';
const UUID = '7b6f1c52-3f0e-4f7e-9d5b-6a1f1c0d2e11';
const firefox = process.env.FIREFOX_BIN ?? '/usr/bin/firefox';
const extension = resolve('.output/firefox-mv3');
const fixtures = JSON.parse(readFileSync(resolve('tests/e2e/.fixtures/manifest.json'), 'utf8'));
const profile = mkdtempSync(join(resolve('test-results'), 'ff-profile-'));

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: firefox,
  headless: true,
  userDataDir: profile,
  extraPrefsFirefox: {
    'extensions.autoDisableScopes': 0,
    // Pin the moz-extension:// host so the test can open the options page.
    'extensions.webextensions.uuids': JSON.stringify({ [ADDON_ID]: UUID }),
  },
});

const truthLines = (fixture) =>
  fixture.lines.map((text, index) => {
    const words = fixture.words.filter((w) => w.line === index);
    const box = [
      Math.min(...words.map((w) => w.x)) / fixture.width,
      Math.min(...words.map((w) => w.y)) / fixture.height,
      Math.max(...words.map((w) => w.x + w.w)) / fixture.width,
      Math.max(...words.map((w) => w.y + w.h)) / fixture.height,
    ];
    return { text, bbox: box.map((v) => Math.round(v * 1000)) };
  });

async function setSettings(patch) {
  const options = await browser.newPage();
  // BiDi does not report load events for moz-extension:// pages; wait for the API instead.
  await options.goto(`moz-extension://${UUID}/options.html`, { timeout: 4000 }).catch(() => undefined);
  await options.waitForFunction(() => typeof browser !== 'undefined' && !!browser.storage, { timeout: 15_000 });
  await options.evaluate(async (patch) => {
    const current = (await browser.storage.local.get('settings')).settings ?? {};
    await browser.storage.local.set({ settings: { ...current, ...patch } });
  }, patch);
  await options.close();
}

/** Opens the fixture page, clicks the lens button on #plain and waits for the overlay. */
async function readPlain() {
  const page = await browser.newPage();
  // New tabs start in the background, where Firefox throttles animation frames.
  await page.bringToFront();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto('http://localhost:4599/index.html', { waitUntil: 'load' });
  const box = await page.$eval('#plain', (el) => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  // The content script starts at document_idle; keep hovering until the lens button shows.
  let buttonBox = null;
  for (let attempt = 0; attempt < 20 && !buttonBox; attempt++) {
    await page.mouse.move(box.x + box.w / 2 - 30 + attempt, box.y + box.h / 2, { steps: 3 });
    buttonBox = await page
      .waitForFunction(
        () => {
          const btn = document.querySelector('magiclens-root')?.shadowRoot?.querySelector('.hbtn[data-show]');
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
        },
        { timeout: 750 },
      )
      .catch(() => null);
  }
  if (!buttonBox) throw new Error('lens button never appeared');
  const center = await buttonBox.jsonValue();
  await page.mouse.click(center.x, center.y);
  const started = Date.now();
  const state = await page.waitForFunction(
    () => {
      const ov = document.querySelector('magiclens-root')?.shadowRoot?.querySelector('.ov');
      const s = ov?.getAttribute('data-state');
      return s === 'ready' || s === 'error' ? { s, label: ov.querySelector('.status .label')?.textContent } : null;
    },
    { timeout: 90_000 },
  );
  const result = await state.jsonValue();
  console.log('overlay', result, `${Date.now() - started}ms`);
  if (result.s !== 'ready') throw new Error(`overlay ended in ${result.s}: ${result.label}`);
  return page;
}

const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

let failed = false;
try {
  const id = await browser.installExtension(extension);
  console.log('installed', id);

  // 1. Local OCR placement.
  await setSettings({ engine: 'local' });
  const page = await readPlain();
  const spans = await page.evaluate(() =>
    [...document.querySelector('magiclens-root').shadowRoot.querySelectorAll('.w')].map((s) => {
      const r = s.getBoundingClientRect();
      return { text: s.textContent, x: r.left, y: r.top, w: r.width, h: r.height };
    }),
  );
  const layout = await page.$eval('#plain', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, s: r.width / el.naturalWidth };
  });
  let placed = 0;
  for (const w of fixtures.doc.words) {
    const ex = { x: layout.x + w.x * layout.s, y: layout.y + w.y * layout.s, w: w.w * layout.s, h: w.h * layout.s };
    const ok = spans.some((s) => {
      if (norm(s.text) !== norm(w.text)) return false;
      const inter = Math.max(0, Math.min(s.x + s.w, ex.x + ex.w) - Math.max(s.x, ex.x));
      const iou = inter / (s.w + ex.w - inter);
      const cy = ex.y + ex.h / 2;
      return iou >= 0.6 && cy >= s.y && cy <= s.y + s.h;
    });
    if (ok) placed++;
  }
  const ratio = placed / fixtures.doc.words.length;
  console.log(`firefox placement: ${placed}/${fixtures.doc.words.length} (${Math.round(ratio * 100)}%)`);
  if (ratio < 0.85) throw new Error('placement below 85%');
  await page.close();

  // 2. AI-only through an Ollama-like server (in-process engine, LLM client, Origin rule).
  await fetch(`${MOCK}/mock/script`, { method: 'POST', body: JSON.stringify({ lines: truthLines(fixtures.doc) }) });
  await setSettings({
    engine: 'llm',
    provider: 'ollama',
    providers: { ollama: { apiKey: '', baseUrl: `${MOCK}/ollama/v1`, model: 'qwen2.5vl:3b' } },
    boxFormat: 'xyxy1000',
  });
  await new Promise((r) => setTimeout(r, 300));
  const aiPage = await readPlain();
  const words = await aiPage.evaluate(() =>
    [...document.querySelector('magiclens-root').shadowRoot.querySelectorAll('.w')].map((s) => s.textContent).join(' '),
  );
  const expectedWords = fixtures.doc.lines.join(' ');
  console.log(`firefox AI read: ${words === expectedWords ? 'exact' : `mismatch: ${words}`}`);
  if (words !== expectedWords) throw new Error('AI path returned unexpected text');
  const log = await (await fetch(`${MOCK}/mock/ollama-log`)).json();
  const calls = log.filter((entry) => entry.path.endsWith('/chat/completions'));
  console.log('ollama calls without Origin:', calls.filter((c) => c.origin === null).length, '/', calls.length);
} catch (error) {
  failed = true;
  console.error('FAILED:', error);
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
