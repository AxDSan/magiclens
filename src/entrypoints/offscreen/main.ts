import { browser } from 'wxt/browser';
import { dispatchEngineCommand } from '../../engine/host';
import type { EngineEvent, FromEngine, ToEngine } from '../../shared/messages';

// Chrome only: the background service worker forwards engine commands here.
const emit = (event: EngineEvent) => {
  const message: FromEngine = { target: 'background', event };
  browser.runtime.sendMessage(message).catch(() => undefined);
};

browser.runtime.onMessage.addListener((message: ToEngine, _sender, sendResponse) => {
  if (message?.target !== 'engine') return;
  dispatchEngineCommand(message.cmd, emit);
  sendResponse({ ok: true });
});
