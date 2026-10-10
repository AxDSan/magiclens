import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { SUPPORT_URL } from '../../shared/links';
import type { TriggerMode } from '../../shared/messages';
import { PROVIDERS } from '../../shared/providers';
import { type EngineChoice, getSettings, providerReady, saveSettings, type Settings } from '../../shared/settings';
import { triggerInTab } from '../../shared/trigger';
import { Logo } from '../../ui/Logo';
import '../../ui/page.css';
import './popup.css';

const ENGINES: { id: EngineChoice; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'local', label: 'Local' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'llm', label: 'AI' },
];

const ACTIONS: { mode: TriggerMode; title: string; detail: string; command?: string }[] = [
  { mode: 'main', title: 'Read the main image', detail: 'Finds the most prominent image in view', command: 'lens-main-image' },
  { mode: 'pick', title: 'Pick an element', detail: 'Click any image, canvas or element', command: 'lens-pick' },
  { mode: 'all', title: 'Read every image in view', detail: 'Runs on all visible images' },
];

function Popup() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [shortcuts, setShortcuts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    void getSettings().then(setSettings);
    void browser.commands.getAll().then((commands) =>
      setShortcuts(Object.fromEntries(commands.map((c) => [c.name ?? '', c.shortcut ?? '']))),
    );
  }, []);

  const run = async (mode: TriggerMode) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      await triggerInTab(tab.id, { t: 'trigger', mode });
      window.close();
    } catch {
      setError('MagicLens cannot run on this page (browser pages and web stores are protected).');
    }
  };

  const setEngine = async (engine: EngineChoice) => setSettings(await saveSettings({ engine }));

  if (!settings) return null;
  const ready = providerReady(settings);
  const config = settings.providers[settings.provider];

  return (
    <main>
      <header class="brand">
        <Logo size={34} />
        <div>
          <h1>MagicLens</h1>
          <div class="tag">Read the text inside any image</div>
        </div>
        <button class="icon-btn" title="Settings" onClick={() => browser.runtime.openOptionsPage()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
          </svg>
        </button>
      </header>

      <section class="actions">
        {ACTIONS.map((action) => (
          <button class="action" key={action.mode} onClick={() => void run(action.mode)}>
            <span>
              <strong>{action.title}</strong>
              <small>{action.detail}</small>
            </span>
            {action.command && shortcuts[action.command] && <kbd>{shortcuts[action.command]}</kbd>}
          </button>
        ))}
      </section>
      {error && <p class="error">{error}</p>}

      <section class="engine">
        <div class="row">
          <span class="label">Engine</span>
          <div class="segmented">
            {ENGINES.map((engine) => (
              <button
                key={engine.id}
                aria-pressed={settings.engine === engine.id}
                onClick={() => void setEngine(engine.id)}
              >
                {engine.label}
              </button>
            ))}
          </div>
        </div>
        <div class="row provider">
          <span class="label">AI</span>
          {ready ? (
            <span class="pill ok">
              {PROVIDERS[settings.provider].label} · {config.model}
            </span>
          ) : (
            <button class="link" onClick={() => browser.runtime.openOptionsPage()}>
              Connect a provider for translate, explain & ask →
            </button>
          )}
        </div>
      </section>
      <footer>
        <p>
          Tip: hover any image and click the <b>lens</b> button, or right-click → <i>Read text in image</i>.
        </p>
        <a class="support" href={SUPPORT_URL} target="_blank" rel="noopener">
          Support MagicLens on Ko-fi
        </a>
      </footer>
    </main>
  );
}

render(<Popup />, document.getElementById('app')!);
