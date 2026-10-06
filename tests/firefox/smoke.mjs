// Firefox smoke test: installs the built extension into a real (headless) Firefox through
// WebDriver BiDi, reads the fixture image with local OCR and checks word placement.
// Usage: npm run test:firefox (builds first). Starts the fixture servers if they are not up.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const serverUp = await fetch('http://localhost:4599/index.html').then(() => true, () => false);
if (!serverUp) await import('../e2e/server.mjs');

const firefox = process.env.FIREFOX_BIN ?? '/usr/bin/firefox';
const extension = resolve('.output/firefox-mv3');
const fixtures = JSON.parse(readFileSync(resolve('tests/e2e/.fixtures/manifest.json'), 'utf8'));
const profile = mkdtempSync(join(resolve('test-results'), 'ff-profile-'));

const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: firefox,
  headless: true,
  userDataDir: profile,
  extraPrefsFirefox: { 'extensions.autoDisableScopes': 0 },
});
let failed = false;
try {
  const id = await browser.installExtension(extension);
  console.log('installed', id);
  const page = await browser.newPage();
  // New tabs start in the background, where Firefox throttles animation frames.
  await page.bringToFront();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('console', (m) => console.log('[page]', m.type(), m.text()));
  await page.goto('http://localhost:4599/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => !!document.querySelector('magiclens-root') || document.readyState === 'complete');

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
  const clickAt = Date.now();
  await page.mouse.click(center.x, center.y);
  console.log('click took', Date.now() - clickAt, 'ms');

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
  const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
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
  if (ratio < 0.85) {
    const debug = await page.evaluate(() => {
      const root = document.querySelector('magiclens-root').shadowRoot;
      return {
        overlays: [...root.querySelectorAll('.ov')].map((o) => ({ state: o.dataset.state, rect: o.getBoundingClientRect().toJSON(), words: o.querySelectorAll('.w').length })),
        img: document.querySelector('#plain').getBoundingClientRect().toJSON(),
        scrollY,
      };
    });
    console.log('debug', JSON.stringify(debug), JSON.stringify(spans.slice(0, 3)), JSON.stringify(layout));
  }
  console.log(`firefox placement: ${placed}/${fixtures.doc.words.length} (${Math.round(ratio * 100)}%)`);
  if (ratio < 0.85) throw new Error('placement below 85%');
} catch (error) {
  failed = true;
  console.error('FAILED:', error);
} finally {
  await browser.close();
  rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
