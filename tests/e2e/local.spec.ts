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

test.describe('local OCR overlay', () => {
  test.beforeEach(async ({ sw }) => {
    await setSettings(sw, { engine: 'local' });
  });

  test('places selectable words over a same-origin image', async ({ page }) => {
    await lensByHover(page, '#plain');
    await waitForState(page, 'ready');
    const spans = await overlaySpans(page);
    const expected = await expectedForImage(page, '#plain', FIXTURES.doc);
    const { ratio, results } = matchWords(expected, spans);
    console.log('plain', ratio.toFixed(2), results.filter((r) => r.iouX < 0.6 || !r.centerOk).map((r) => `${r.word}:${r.iouX.toFixed(2)}`));
    expect(ratio).toBeGreaterThanOrEqual(0.85);
  });
});
