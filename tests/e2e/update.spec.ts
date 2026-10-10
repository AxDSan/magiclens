import { expect, lensByHover, setSettings, test, waitForState } from './fixtures';

declare const chrome: {
  runtime: { reload(): void };
  developerPrivate: { updateProfileConfiguration(update: object, done: () => void): void };
};

// Reloading an unpacked extension runs the same path as a store update: the old content
// script is orphaned and onInstalled fires with reason "update".
test('a tab opened before an update keeps a working lens without a page reload', async ({ context, page, sw }) => {
  await setSettings(sw, { engine: 'local' });
  await page.locator('#plain').scrollIntoViewIfNeeded();
  const box = (await page.locator('#plain').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await expect(page.locator('magiclens-root .hbtn[data-show]')).toBeVisible();
  await page.mouse.move(0, 0);
  const oldRoot = await page.locator('magiclens-root').elementHandle();

  // Without developer mode Chromium disables a command-line extension when it reloads.
  const settings = await context.newPage();
  await settings.goto('chrome://extensions');
  await settings.evaluate(
    () => new Promise<void>((done) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, done)),
  );
  await settings.close();

  const restarted = context.waitForEvent('serviceworker');
  await sw.evaluate(() => chrome.runtime.reload()).catch(() => undefined);
  await restarted;
  // The re-injected script takes over and the orphaned instance removes its UI.
  await expect.poll(() => oldRoot!.evaluate((el) => el.isConnected)).toBe(false);
  await page.bringToFront();
  await lensByHover(page, '#plain');
  await waitForState(page, 'ready');
  await expect(page.locator('magiclens-root')).toHaveCount(1);
});
