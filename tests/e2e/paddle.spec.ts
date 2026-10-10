import type { Page } from '@playwright/test';
import { expectedForImage, FIXTURES, lensByHover, matchWords, overlaySpans, setSettings, test, expect, waitForState } from './fixtures';

async function expectPlacement(page: Page, selector: string, fixture: keyof typeof FIXTURES, minRatio = 0.85) {
  const spans = await overlaySpans(page);
  const expected = await expectedForImage(page, selector, FIXTURES[fixture]);
  const { ratio, results } = matchWords(expected, spans);
  const misses = results.filter((r) => r.iouX < 0.6 || !r.centerOk).map((r) => `${r.word}:${r.iouX.toFixed(2)}`);
  expect(ratio, `misplaced or missing words: ${misses.join(', ')}`).toBeGreaterThanOrEqual(minRatio);
}

test.describe('PaddleOCR PP-OCRv5 overlay', () => {
  test.beforeEach(async ({ sw }) => {
    await setSettings(sw, { engine: 'local', ocrModel: 'paddle' });
  });

  test('same-origin image: Paddle runs and every word lands on its glyphs', async ({ page }) => {
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    // The summary names the model that produced the result, so this proves Paddle ran, not Tesseract.
    await expect(page.locator('magiclens-root .meta').first()).toContainText('PaddleOCR PP-OCRv5 mobile');
    await expectPlacement(page, '#plain', 'doc');
  });
});
