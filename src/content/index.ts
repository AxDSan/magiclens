import { browser } from 'wxt/browser';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { TriggerMessage } from '../shared/messages';
import { getSettings, onSettingsChanged, type Settings } from '../shared/settings';
import { engineClient } from './client';
import { Lens } from './lens';
import { HoverButton } from './ui/hover';
import { Picker } from './ui/picker';
import { UiRoot } from './ui/root';

const FLAG = '__magiclensActive';

export async function boot(ctx: ContentScriptContext) {
  const scope = globalThis as unknown as Record<string, boolean>;
  // Guards against double injection (manifest + on-demand scripting.executeScript).
  if (scope[FLAG]) return;
  scope[FLAG] = true;

  // Listen before the first read so a change landing during boot is not lost.
  let latest: Settings | null = null;
  let onChange = (next: Settings) => {
    latest = next;
  };
  const stopWatching = onSettingsChanged((next) => onChange(next));
  let settings: Settings = await getSettings();
  if (latest) settings = latest;
  const root = new UiRoot(settings.reducedMotion);
  const lens = new Lens(root, settings);
  const picker = new Picker(root);
  const hover = new HoverButton(
    root,
    (target, event) => void lens.read(target, event.shiftKey ? 'llm' : event.altKey ? 'local' : undefined),
    () => picker.active,
  );
  const apply = (next: Settings) => {
    hover.enabled = next.hoverButton;
    hover.minSize = next.minImageSize;
    if (!next.hoverButton) hover.hide(true);
  };
  apply(settings);

  onChange = (next) => {
    settings = next;
    lens.updateSettings(next);
    lens.refreshAi();
    apply(next);
  };

  const pick = () => {
    hover.hide(true);
    picker.start((target) => void lens.read(target));
  };

  const onMessage = (message: TriggerMessage, _sender: unknown, sendResponse: (response: unknown) => void) => {
    if (message?.t !== 'trigger') return;
    sendResponse({ ok: true });
    switch (message.mode) {
      case 'main':
        if (!lens.readMain(message.engine)) {
          root.toast('No image found in view. Click one to read it.');
          pick();
        }
        break;
      case 'pick':
        pick();
        break;
      case 'all':
        if (!lens.readAll(message.engine)) root.toast('No images with a readable size in view.');
        break;
      case 'context': {
        const target = lens.contextTarget(message.srcUrl);
        if (target) void lens.read(target, message.engine);
        else root.toast('MagicLens could not find an image there.');
        break;
      }
    }
  };
  browser.runtime.onMessage.addListener(onMessage);

  ctx.onInvalidated(() => {
    scope[FLAG] = false;
    // UI first: once an update has orphaned this script, extension API calls throw.
    picker.stop();
    hover.destroy();
    root.destroy();
    const releases = [
      () => browser.runtime.onMessage.removeListener(onMessage),
      stopWatching,
      () => engineClient.disconnect(),
    ];
    for (const release of releases) {
      try {
        release();
      } catch {
        // The extension context is already gone; nothing is left to release.
      }
    }
  });
}
