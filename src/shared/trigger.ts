import { browser } from 'wxt/browser';
import type { TriggerMessage } from './messages';

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
      files: ['/content-scripts/content.js'],
    });
    await browser.tabs.sendMessage(tabId, message, { frameId });
  }
}
