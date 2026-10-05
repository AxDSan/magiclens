import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lensByHover, setSettings, test, waitForState } from './fixtures';

// Not an assertion test: renders frames of the experience for a human to look at.
// Run with: VISUAL_DIR=/some/dir npx playwright test visual
const dir = process.env.VISUAL_DIR;

test('visual: capture the lens animation', async ({ page, sw }) => {
  test.skip(!dir, 'set VISUAL_DIR to capture frames');
  mkdirSync(dir!, { recursive: true });
  await setSettings(sw, { engine: 'local' });
  const target = process.env.VISUAL_TARGET ?? '#plain';
  await page.locator(target).scrollIntoViewIfNeeded();
  const box = (await page.locator(target).boundingBox())!;
  const clip = { x: Math.max(0, box.x - 30), y: Math.max(0, box.y - 30), width: Math.min(1280, box.width + 60), height: box.height + 140 };
  await lensByHover(page, target);
  for (const ms of [120, 450, 900]) {
    await page.waitForTimeout(ms === 120 ? 120 : ms - 120);
    await page.screenshot({ path: join(dir!, `scan-${ms}.png`), clip });
  }
  await waitForState(page, 'ready');
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(dir!, 'reveal.png'), clip });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(dir!, 'ready.png'), clip });
  // Select a few words to show the selection highlight.
  const spans = page.locator('magiclens-root .w');
  const first = (await spans.nth(4).boundingBox())!;
  const last = (await spans.nth(9).boundingBox())!;
  await page.mouse.move(first.x + 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 2, last.y + last.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: join(dir!, 'selected.png'), clip });
  await page.locator('magiclens-root button[title="Show recognized text on the image"]').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(dir!, 'show-text.png'), clip });
});
