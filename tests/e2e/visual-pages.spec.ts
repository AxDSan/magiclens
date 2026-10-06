import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from './fixtures';

// Screenshots of the popup and options page for a human to review. Run with VISUAL_DIR=...
const dir = process.env.VISUAL_DIR;

test('visual: popup and options', async ({ context, sw }) => {
  test.skip(!dir, 'set VISUAL_DIR to capture frames');
  mkdirSync(dir!, { recursive: true });
  const id = new URL(sw.url()).host;
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 360, height: 520 });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.waitForTimeout(400);
  await popup.screenshot({ path: join(dir!, 'popup.png'), fullPage: true });
  for (const scheme of ['light', 'dark'] as const) {
    const options = await context.newPage();
    await options.emulateMedia({ colorScheme: scheme });
    await options.setViewportSize({ width: 1100, height: 1000 });
    await options.goto(`chrome-extension://${id}/options.html#welcome`);
    await options.waitForTimeout(400);
    await options.screenshot({ path: join(dir!, `options-${scheme}.png`), fullPage: true });
  }
});
