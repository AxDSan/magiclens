import { type Browser, browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import {
  CONTENT_PORT,
  type ContentRequest,
  type EngineCommand,
  type EngineEvent,
  type FromEngine,
} from '../shared/messages';
import { getSettings } from '../shared/settings';
import { triggerInTab } from '../shared/trigger';
import { errorMessage } from '../shared/util';

const TERMINAL = new Set<EngineEvent['t']>(['result', 'error', 'done']);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface EngineTransport {
  send(cmd: EngineCommand): void;
}

/**
 * Chrome's service worker cannot start the Web Worker Tesseract needs, so the engine lives
 * in an offscreen document there. Firefox and Safari run a background page with a DOM and
 * host the engine in-process.
 */
function createTransport(deliver: (event: EngineEvent) => void): EngineTransport {
  const hasDom = typeof document !== 'undefined';
  if (!hasDom && browser.offscreen) {
    const url = browser.runtime.getURL('/offscreen.html');
    let creating: Promise<void> | null = null;

    const ensure = async () => {
      const contexts = await browser.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as Browser.runtime.ContextType],
        documentUrls: [url],
      });
      if (contexts.length) return;
      creating ??= browser.offscreen
        .createDocument({
          url,
          reasons: ['WORKERS' as Browser.offscreen.Reason],
          justification: 'Runs the OCR engine (WebAssembly in a Web Worker) and AI requests.',
        })
        .finally(() => {
          creating = null;
        });
      await creating;
    };

    browser.runtime.onMessage.addListener((message: FromEngine) => {
      if (message?.target === 'background') deliver(message.event);
    });

    return {
      send(cmd) {
        void (async () => {
          for (let attempt = 0; ; attempt++) {
            try {
              await ensure();
              await browser.runtime.sendMessage({ target: 'engine', cmd });
              return;
            } catch (error) {
              // The document may still be booting; give its listener a moment.
              if (attempt >= 6) {
                if (cmd.type !== 'cancel') {
                  const id = cmd.type === 'ocr' ? cmd.jobId : cmd.reqId;
                  deliver({ t: 'error', id, code: 'INTERNAL', message: errorMessage(error) });
                }
                return;
              }
              await sleep(80 * (attempt + 1));
            }
          }
        })();
      },
    };
  }

  let host: Promise<typeof import('../engine/host')> | null = null;
  return {
    send(cmd) {
      host ??= import('../engine/host');
      void host.then((module) => module.dispatchEngineCommand(cmd, deliver));
    },
  };
}

export default defineBackground(() => {
  const routes = new Map<string, Browser.runtime.Port>();

  const deliver = (event: EngineEvent) => {
    const port = routes.get(event.id);
    if (!port) return;
    try {
      port.postMessage(event);
    } catch {
      routes.delete(event.id);
      return;
    }
    if (TERMINAL.has(event.t)) routes.delete(event.id);
  };

  const engine = createTransport(deliver);

  // captureVisibleTab is limited to two calls per second.
  let lastCapture = 0;
  let captureChain: Promise<unknown> = Promise.resolve();
  const capture = (windowId: number): Promise<string> => {
    const run = async () => {
      const wait = 550 - (Date.now() - lastCapture);
      if (wait > 0) await sleep(wait);
      lastCapture = Date.now();
      return browser.tabs.captureVisibleTab(windowId, { format: 'png' });
    };
    const result = captureChain.then(run, run);
    captureChain = result.catch(() => undefined);
    return result;
  };

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== CONTENT_PORT) return;
    const owned = new Set<string>();

    const handle = async (message: ContentRequest) => {
      switch (message.t) {
        case 'ocr': {
          routes.set(message.jobId, port);
          owned.add(message.jobId);
          let source = message.source;
          if (source.kind === 'capture') {
            const tab = port.sender?.tab;
            try {
              if (!tab || tab.windowId === undefined) throw new Error('No tab to capture');
              if (!tab.active) throw new Error('The tab must be visible to capture it');
              source = { ...source, shot: await capture(tab.windowId) };
              deliver({ t: 'captured', id: message.jobId });
            } catch (error) {
              deliver({
                t: 'error',
                id: message.jobId,
                code: 'CAPTURE_FAILED',
                message: `Could not capture the page: ${errorMessage(error)}`,
              });
              return;
            }
          }
          engine.send({
            type: 'ocr',
            jobId: message.jobId,
            source,
            engine: message.engine,
            settings: await getSettings(),
          });
          break;
        }
        case 'analyze': {
          const { t: _t, ...job } = message;
          routes.set(job.reqId, port);
          owned.add(job.reqId);
          engine.send({ type: 'analyze', ...job, settings: await getSettings() });
          break;
        }
        case 'cancel':
          routes.delete(message.id);
          engine.send({ type: 'cancel', id: message.id });
          break;
        case 'open-options':
          await browser.runtime.openOptionsPage();
          break;
        case 'ping':
          break;
      }
    };

    port.onMessage.addListener((message: ContentRequest) => void handle(message));
    port.onDisconnect.addListener(() => {
      for (const id of owned) {
        if (routes.get(id) === port) {
          routes.delete(id);
          engine.send({ type: 'cancel', id });
        }
      }
    });
  });

  browser.runtime.onInstalled.addListener(async ({ reason }) => {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: 'ml-image',
      title: 'Read text in image',
      contexts: ['image'],
    });
    browser.contextMenus.create({
      id: 'ml-here',
      title: 'Read text here with MagicLens',
      contexts: ['page', 'frame', 'link', 'video', 'selection'],
    });
    if (reason === 'install') {
      await browser.tabs.create({ url: browser.runtime.getURL('/options.html#welcome') });
    }
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    void triggerInTab(
      tab.id,
      { t: 'trigger', mode: 'context', srcUrl: info.srcUrl },
      info.frameId ?? 0,
    ).catch((error) => console.warn('[MagicLens]', error));
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    const target = tab?.id
      ? tab
      : (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!target?.id) return;
    await triggerInTab(target.id, {
      t: 'trigger',
      mode: command === 'lens-pick' ? 'pick' : 'main',
    }).catch((error) => console.warn('[MagicLens]', error));
  });
});
