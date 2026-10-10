import { browser } from 'wxt/browser';
import { CONTENT_SCRIPT } from '../shared/trigger';

/**
 * The stores (Chrome Web Store, Edge Add-ons, Opera Add-ons, AMO) deliver updates and the
 * browser downloads them on its own schedule; extensions must not fetch code themselves.
 * Without a listener, a downloaded update waits until the background is unloaded, which can
 * land in the middle of a read. This gate applies it as soon as no job is in flight.
 */
export function createUpdateGate(isBusy: () => boolean, reload: () => void) {
  let pending = false;
  const apply = () => {
    if (pending && !isBusy()) reload();
  };
  return {
    /** An update was downloaded: apply it now, or once the last job settles. */
    available() {
      pending = true;
      apply();
    },
    /** Call whenever a job finishes or is cancelled. */
    settled: apply,
  };
}

/**
 * Chromium does not inject content scripts into tabs that were open before an install or
 * update, so those tabs would have no lens button (and, after an update, an orphaned one
 * that can no longer reach the background). Injecting the new script makes the old
 * instance tear itself down and the new one take over. Firefox injects on its own; the
 * content script's guard makes the extra injection a no-op there.
 */
export async function injectIntoOpenTabs() {
  const tabs = await browser.tabs.query({ discarded: false });
  await Promise.allSettled(
    tabs.map((tab) =>
      tab.id === undefined || !/^(https?|file):/.test(tab.url ?? '')
        ? Promise.resolve()
        : browser.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            files: [CONTENT_SCRIPT],
          }),
    ),
  );
}
