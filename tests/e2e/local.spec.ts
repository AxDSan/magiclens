import type { Page, Worker } from '@playwright/test';
import {
  expect,
  expectedForImage,
  FIXTURES,
  lensByHover,
  matchWords,
  overlaySpans,
  setSettings,
  test,
  waitForState,
} from './fixtures';

async function expectPlacement(page: Page, selector: string, fixture: keyof typeof FIXTURES, minRatio = 0.85) {
  const spans = await overlaySpans(page);
  const expected = await expectedForImage(page, selector, FIXTURES[fixture]);
  const { ratio, results } = matchWords(expected, spans);
  const misses = results.filter((r) => r.iouX < 0.6 || !r.centerOk).map((r) => `${r.word}:${r.iouX.toFixed(2)}`);
  expect(ratio, `misplaced or missing words: ${misses.join(', ')}`).toBeGreaterThanOrEqual(minRatio);
}

async function triggerFromBackground(sw: Worker, mode: 'main' | 'pick' | 'all') {
  await sw.evaluate(async (mode) => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    await chrome.tabs.sendMessage(tab.id!, { t: 'trigger', mode });
  }, mode);
}

declare const chrome: {
  tabs: {
    query(q: object): Promise<{ id?: number }[]>;
    sendMessage(tabId: number, message: object): Promise<unknown>;
  };
};

test.describe('local OCR overlay', () => {
  test.beforeEach(async ({ sw }) => {
    await setSettings(sw, { engine: 'local' });
  });

  test('same-origin image: every word lands on its glyphs', async ({ page }) => {
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    await expectPlacement(page, '#plain', 'doc');
  });

  test('cross-origin image is downloaded by the engine', async ({ page }) => {
    await lensByHover(page, '#cross');
    await waitForState(page, 'ready');
    await expectPlacement(page, '#cross', 'dark');
  });

  test('object-fit: contain with padding and border', async ({ page }) => {
    await lensByHover(page, '#contain');
    await waitForState(page, 'ready');
    await expectPlacement(page, '#contain', 'banner');
  });

  test('object-fit: cover with object-position crops correctly', async ({ page }) => {
    await lensByHover(page, '#cover');
    await waitForState(page, 'ready');
    // Cover crops the right side away; only the words inside the visible box count.
    const spans = await overlaySpans(page);
    const box = (await page.locator('#cover').boundingBox())!;
    const expected = (await expectedForImage(page, '#cover', FIXTURES.doc)).filter(
      (w) => w.x >= box.x && w.x + w.w <= box.x + box.width,
    );
    expect(expected.length).toBeGreaterThan(3);
    const { ratio } = matchWords(expected, spans);
    expect(ratio).toBeGreaterThanOrEqual(0.75);
  });

  test('canvas is read from a screenshot of the tab', async ({ page }) => {
    await page.locator('#cv').scrollIntoViewIfNeeded();
    await page.mouse.move(10, 10);
    await page.locator('#cv').hover();
    await page.locator('magiclens-root .hbtn[data-show]').click();
    await waitForState(page, 'ready');
    const spans = await overlaySpans(page);
    const expected = await page.evaluate(() => {
      const r = document.getElementById('cv')!.getBoundingClientRect();
      return (window as unknown as { canvasWords: { text: string; x: number; y: number; w: number; h: number }[] }).canvasWords.map(
        (w) => ({ ...w, x: r.left + w.x, y: r.top + w.y }),
      );
    });
    const { ratio } = matchWords(expected, spans);
    expect(ratio).toBeGreaterThanOrEqual(0.85);
  });

  test('copy gives clean text with spaces and line breaks', async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:4599' });
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    const box = (await page.locator('#plain').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text.replace(/\n+/g, '\n').trim().split('\n')).toEqual(FIXTURES.doc.lines);
  });

  test('keyboard shortcut path reads the main image', async ({ page, sw }) => {
    await page.locator('#plain').scrollIntoViewIfNeeded();
    await triggerFromBackground(sw, 'main');
    await waitForState(page, 'ready');
    await expectPlacement(page, '#plain', 'doc');
  });

  test('Escape closes the overlay', async ({ page }) => {
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    await page.keyboard.press('Escape');
    await expect(page.locator('magiclens-root .ov')).toHaveCount(0);
  });

  test('the page main thread stays responsive while reading', async ({ page }) => {
    await page.evaluate(() => {
      const w = window as unknown as { longTasks: number[] };
      w.longTasks = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.longTasks.push(entry.duration);
      }).observe({ type: 'longtask', buffered: false });
    });
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    await page.waitForTimeout(1500);
    const longTasks = await page.evaluate(() => (window as unknown as { longTasks: number[] }).longTasks);
    console.log('long tasks (ms):', longTasks.map((d) => Math.round(d)));
    expect(Math.max(0, ...longTasks)).toBeLessThan(120);
  });
});
