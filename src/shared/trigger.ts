import { browser } from 'wxt/browser';
import type { TriggerMessage } from './messages';

/** Path of the bundled content script, for on-demand injection. */
export const CONTENT_SCRIPT = '/content-scripts/content.js';

/**
 * Sends a trigger to a tab's content script, injecting it first if the tab was opened
 * before the extension was installed (Chrome does not inject into existing tabs).
 */
export async function triggerInTab(tabId: number, message: TriggerMessage, frameId = 0) {
  try {
    await browser.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_SCRIPT],
    });
    await browser.tabs.sendMessage(tabId, message, { frameId });
  }
}
