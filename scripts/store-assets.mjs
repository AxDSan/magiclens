// Renders the store listing images into store/assets from a real Chrome build:
// 1280x800 screenshots (all stores), promo tiles (Chrome, Edge), a 300x300 logo (Edge), and
// the landing page's social preview (web/og.png).
// AI answers come from the scripted mock server the E2E tests use, so no key is needed.
// Run: npm run store:assets
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(root, '.output', 'chrome-mv3');
const out = join(root, 'store', 'assets');
const MOCK = 'http://127.0.0.1:4601';
const DEMO_PORT = 4610;
mkdirSync(out, { recursive: true });

const demo = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(join(root, 'store', 'demo.html')));
}).listen(DEMO_PORT, '127.0.0.1');

const mockUp = () => fetch(`${MOCK}/mock/script`, { method: 'POST', body: '{}' }).then(() => true, () => false);
let mock = null;
if (!(await mockUp())) {
  mock = spawn(process.execPath, [join(root, 'tests', 'e2e', 'server.mjs')], { stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await mockUp()); i++) await new Promise((r) => setTimeout(r, 100));
}

// Profiles go under the project, not /tmp (RAM-backed on this machine).
mkdirSync(join(root, '.cache'), { recursive: true });
const profile = mkdtempSync(join(root, '.cache', 'store-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});

try {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const setSettings = (patch) =>
    worker.evaluate(async (patch) => {
      const current = (await chrome.storage.local.get('settings')).settings ?? {};
      await chrome.storage.local.set({ settings: { ...current, ...patch } });
    }, patch);
  const script = (body) => fetch(`${MOCK}/mock/script`, { method: 'POST', body: JSON.stringify(body) });

  await setSettings({
    engine: 'hybrid',
    provider: 'ollama',
    providers: { ollama: { apiKey: '', baseUrl: `${MOCK}/v1`, model: 'qwen2.5vl:3b' } },
    translateTo: 'English',
  });
  await script({
    delayMs: 40,
    lines: [
      { text: 'NOITE DE FADO', bbox: [90, 180, 650, 340] },
      { text: 'Música ao vivo todas as sextas', bbox: [90, 440, 820, 520] },
      { text: 'Alfama, a partir das 21h', bbox: [90, 560, 640, 640] },
      { text: 'Entrada livre', bbox: [90, 740, 360, 805] },
    ],
    translations: {
      'NOITE DE FADO': 'FADO NIGHT',
      'Música ao vivo todas as sextas': 'Live music every Friday',
      'Alfama, a partir das 21h': 'Alfama, from 9 pm',
      // Tesseract groups these two lines into one paragraph, and paragraphs are translated whole.
      'Música ao vivo todas as sextas Alfama, a partir das 21h': 'Live music every Friday\nAlfama, from 9 pm',
      'Entrada livre': 'Free entry',
    },
    explain:
      'A poster for a **fado night** in Alfama, Lisbon.\n\n' +
      '- Live fado music **every Friday**\n- Starts at **9 pm**\n- Entry is **free**',
  });

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${DEMO_PORT}/`);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth));
  const lens = (selector) => page.locator(`magiclens-root ${selector}`);
  const open = async (selector) => {
    // Leave room under the image for the panel.
    await page.evaluate((sel) => window.scrollTo(0, document.querySelector(sel).getBoundingClientRect().top + scrollY - 140), selector);
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await lens('.hbtn[data-show]').click();
    await lens('.ov[data-state="ready"]').waitFor({ state: 'attached', timeout: 60_000 });
    await page.mouse.move(8, 8);
    await page.waitForTimeout(1200);
  };
  const shot = (name) => page.screenshot({ path: join(out, name) });

  // 1. The reading effect, held in place for the photo.
  await open('#poster');
  await page.evaluate(() => {
    const shadow = document.querySelector('magiclens-root').shadowRoot;
    const overlay = shadow.querySelector('.ov');
    overlay.removeAttribute('data-idle');
    overlay.dataset.state = 'scan';
    overlay.querySelector('.frame').style.visibility = 'hidden';
    overlay.querySelector('.status .label').textContent = 'Reading text';
    shadow.querySelector('.panel').remove();
  });
  await page.waitForTimeout(1500);
  await shot('1-reading.png');

  // 2. Selectable text: highlight two lines as a reader would.
  await page.reload();
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth));
  await open('#poster');
  const words = lens('.w');
  const first = await words.nth(3).boundingBox();
  const last = await words.nth(10).boundingBox();
  await page.mouse.move(first.x + 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 2, last.y + last.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.mouse.move(8, 8);
  await page.waitForTimeout(300);
  await shot('2-select.png');

  // 3. Translation painted over the original.
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await lens('.panel button[title="Translate the text in place"]').click();
  await lens('.tr').first().waitFor();
  await page.waitForTimeout(2500);
  await shot('3-translate.png');

  // 4. Explain.
  await lens('.panel button[title="Explain this image"]').click();
  await page.waitForTimeout(3000);
  await shot('4-explain.png');

  // 5. Settings.
  await setSettings({ engine: 'auto', provider: 'gemini' });
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.waitForTimeout(600);
  await options.screenshot({ path: join(out, '5-settings.png') });

  // Promo tiles and logo, drawn from the extension icon.
  const icon = readFileSync(join(root, 'assets', 'icon.svg'), 'utf8');
  const tile = async (name, width, height, iconSize, titleSize, tagline) => {
    const art = await context.newPage();
    await art.setViewportSize({ width, height });
    await art.setContent(`<!doctype html><html><body style="margin:0;width:${width}px;height:${height}px;
      display:flex;align-items:center;justify-content:center;gap:${Math.round(iconSize * 0.3)}px;
      font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,Arial,sans-serif;color:#fff;
      background:${tagline === null ? 'transparent' : 'radial-gradient(120% 140% at 15% 10%,#2c3a7a 0,#1b1f3d 45%,#2a1640 100%)'}">
      <div style="width:${iconSize}px;height:${iconSize}px">${icon.replace('<svg ', '<svg style="width:100%;height:100%" ')}</div>
      ${tagline === null ? '' : `<div><div style="font-weight:700;font-size:${titleSize}px;letter-spacing:-0.01em">MagicLens</div>
      <div style="margin-top:${Math.round(titleSize * 0.2)}px;font-size:${Math.round(titleSize * 0.42)}px;opacity:.82;max-width:${Math.round(width * 0.6)}px">${tagline}</div></div>`}
      </body></html>`);
    await art.screenshot({ path: isAbsolute(name) ? name : join(out, name), omitBackground: tagline === null });
    await art.close();
  };
  await tile('promo-small-440x280.png', 440, 280, 96, 40, 'Read the text inside any image');
  await tile('promo-marquee-1400x560.png', 1400, 560, 220, 88, 'Select, copy, translate and explain the text inside any image, right where it appears');
  await tile('logo-300x300.png', 300, 300, 300, 0, null);
  // Social preview for the landing page (committed: the site serves it).
  await tile(join(root, 'web', 'og.png'), 1200, 630, 200, 84, 'Every image is now text. Select, copy, translate and explain it, right where it appears.');
  console.log(`Store assets written to ${out}`);
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
  demo.close();
  mock?.kill();
}
