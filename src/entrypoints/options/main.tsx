import { type ComponentChildren, render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { browser } from 'wxt/browser';
import { createClient } from '../../engine/llm';
import { parseOcrJson } from '../../engine/llm/parse';
import { OCR_SYSTEM, ocrPrompt } from '../../engine/llm/prompts';
import { SUPPORT_URL } from '../../shared/links';
import { detectBoxFormat, PROVIDER_ORDER, PROVIDERS } from '../../shared/providers';
import {
  type EngineChoice,
  getSettings,
  providerReady,
  resolveEngine,
  saveSettings,
  type Settings,
} from '../../shared/settings';
import { errorMessage } from '../../shared/util';
import { Logo } from '../../ui/Logo';
import '../../ui/page.css';
import './options.css';
import { iou, makeTestImage } from './test-image';

const ENGINES: { id: EngineChoice; title: string; text: string }[] = [
  { id: 'auto', title: 'Auto', text: 'Hybrid when an AI provider is connected, otherwise local OCR.' },
  { id: 'local', title: 'Local OCR', text: 'Runs in your browser with the OCR model chosen below. Private, offline, free.' },
  { id: 'hybrid', title: 'Hybrid', text: 'Local OCR finds exact positions; the AI corrects the text.' },
  { id: 'llm', title: 'AI vision', text: 'The model reads the image and places the text itself.' },
];

const OCR_LANGUAGES: [string, string][] = [
  ['eng', 'English'], ['spa', 'Spanish'], ['fra', 'French'], ['deu', 'German'], ['ita', 'Italian'],
  ['por', 'Portuguese'], ['nld', 'Dutch'], ['pol', 'Polish'], ['ces', 'Czech'], ['swe', 'Swedish'],
  ['dan', 'Danish'], ['nor', 'Norwegian'], ['fin', 'Finnish'], ['hun', 'Hungarian'], ['ron', 'Romanian'],
  ['tur', 'Turkish'], ['ell', 'Greek'], ['rus', 'Russian'], ['ukr', 'Ukrainian'], ['ara', 'Arabic'],
  ['heb', 'Hebrew'], ['hin', 'Hindi'], ['ben', 'Bengali'], ['tha', 'Thai'], ['vie', 'Vietnamese'],
  ['ind', 'Indonesian'], ['jpn', 'Japanese'], ['chi_sim', 'Chinese (Simplified)'],
  ['chi_tra', 'Chinese (Traditional)'], ['kor', 'Korean'],
];

const TRANSLATE_TARGETS = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Polish', 'Czech',
  'Swedish', 'Danish', 'Norwegian', 'Finnish', 'Hungarian', 'Romanian', 'Turkish', 'Greek',
  'Russian', 'Ukrainian', 'Arabic', 'Hebrew', 'Hindi', 'Bengali', 'Thai', 'Vietnamese',
  'Indonesian', 'Japanese', 'Korean', 'Chinese (Simplified)', 'Chinese (Traditional)',
];

function Section(props: { id?: string; title: string; text?: string; children: ComponentChildren }) {
  return (
    <section class="card" id={props.id}>
      <div class="card-head">
        <h2>{props.title}</h2>
        {props.text && <p>{props.text}</p>}
      </div>
      {props.children}
    </section>
  );
}

function Toggle(props: { label: string; text?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label class="toggle-row">
      <span>
        <strong>{props.label}</strong>
        {props.text && <small>{props.text}</small>}
      </span>
      <span class="switch">
        <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.currentTarget.checked)} />
        <span />
      </span>
    </label>
  );
}

/** Firefox asks for consent before an extension sends page content or the provider key out. */
async function requestDataConsent() {
  if (!navigator.userAgent.includes('Firefox')) return;
  try {
    await (browser.permissions.request as (p: unknown) => Promise<boolean>)({
      data_collection: ['authenticationInfo', 'websiteContent'],
    });
  } catch {
    // Older Firefox without data-collection permissions.
  }
}

type TestState = { status: 'idle' | 'running' | 'ok' | 'error'; message?: string };

function ProviderSection({ settings, update }: { settings: Settings; update: (patch: Partial<Settings>) => void }) {
  const id = settings.provider;
  const preset = PROVIDERS[id];
  const config = settings.providers[id];
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const [reveal, setReveal] = useState(false);
  const [test, setTest] = useState<TestState>({ status: 'idle' });

  useEffect(() => {
    setModels([]);
    setModelError('');
    setTest({ status: 'idle' });
  }, [id]);

  const setConfig = (patch: Partial<typeof config>) =>
    update({ providers: { ...settings.providers, [id]: { ...config, ...patch } } });

  const loadModels = async () => {
    setLoadingModels(true);
    setModelError('');
    try {
      const list = await createClient(id, config).listModels();
      setModels(list);
      if (!list.length) setModelError('The provider returned no models.');
    } catch (error) {
      setModelError(errorMessage(error));
    } finally {
      setLoadingModels(false);
    }
  };

  const runTest = async () => {
    void requestDataConsent();
    setTest({ status: 'running' });
    const started = performance.now();
    try {
      const { image, expected } = await makeTestImage();
      const format = settings.boxFormat === 'auto' ? detectBoxFormat(id, config.model) : settings.boxFormat;
      const raw = await createClient(id, config).complete({
        system: OCR_SYSTEM,
        prompt: ocrPrompt(format, image.width, image.height),
        image,
        purpose: 'ocr',
        json: true,
        maxTokens: 4096,
      });
      const parsed = parseOcrJson(raw, format, image.width, image.height);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      if (!parsed.lines.length) {
        setTest({ status: 'error', message: `Connected in ${seconds}s, but the model read no text. Is it a vision model?` });
        return;
      }
      const scores = expected.map((line) => Math.max(0, ...parsed.lines.map((p) => iou(p.box, line.box))));
      const placement = scores.reduce((a, b) => a + b, 0) / scores.length;
      const quality = placement > 0.5 ? 'precise' : placement > 0.25 ? 'approximate' : 'poor';
      setTest({
        status: 'ok',
        message: `Works · ${seconds}s · read “${parsed.lines[0].text}” · text placement ${quality} (${Math.round(placement * 100)}%)${quality === 'poor' ? ' — Hybrid mode is recommended for this model' : ''}`,
      });
    } catch (error) {
      setTest({ status: 'error', message: errorMessage(error) });
    }
  };

  return (
    <Section
      id="provider"
      title="AI provider"
      text="Bring your own key, or point MagicLens at a local server. Used for Hybrid/AI reading, translation, explanations and questions."
    >
      <div class="providers">
        {PROVIDER_ORDER.map((pid) => (
          <button
            key={pid}
            class="provider"
            aria-pressed={pid === id}
            onClick={() => {
              if (!PROVIDERS[pid].local) void requestDataConsent();
              update({ provider: pid });
            }}
          >
            <span>{PROVIDERS[pid].label}</span>
            {PROVIDERS[pid].needsKey && providerReady({ ...settings, provider: pid }) && (
              <i class="ready" title="API key saved" />
            )}
          </button>
        ))}
      </div>

      {preset.hint && <p class="hint">{preset.hint}</p>}

      <div class="fields">
        {(preset.needsKey || id === 'custom') && (
          <label class="field">
            <span>API key {preset.keyUrl && <a href={preset.keyUrl} target="_blank" rel="noreferrer">Get a key ↗</a>}</span>
            <div class="with-button">
              <input
                type={reveal ? 'text' : 'password'}
                value={config.apiKey}
                placeholder={preset.needsKey ? 'Paste your key' : 'Optional'}
                autocomplete="off"
                spellcheck={false}
                onInput={(e) => setConfig({ apiKey: e.currentTarget.value.trim() })}
              />
              <button class="btn" onClick={() => setReveal(!reveal)}>{reveal ? 'Hide' : 'Show'}</button>
            </div>
          </label>
        )}
        <label class="field">
          <span>Model</span>
          <div class="with-button">
            <input
              type="text"
              list="model-list"
              value={config.model}
              placeholder="Model id"
              spellcheck={false}
              onInput={(e) => setConfig({ model: e.currentTarget.value.trim() })}
            />
            <button class="btn" onClick={() => void loadModels()} disabled={loadingModels}>
              {loadingModels ? 'Loading…' : 'Load models'}
            </button>
          </div>
          <datalist id="model-list">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {modelError && <small class="error-text">{modelError}</small>}
          {!!models.length && <small class="muted">{models.length} models available — start typing to filter.</small>}
        </label>
        <details class="advanced">
          <summary>Advanced</summary>
          <label class="field">
            <span>Base URL</span>
            <input type="url" value={config.baseUrl} spellcheck={false} onInput={(e) => setConfig({ baseUrl: e.currentTarget.value.trim() })} />
          </label>
          <label class="field">
            <span>Text position format</span>
            <select value={settings.boxFormat} onChange={(e) => update({ boxFormat: e.currentTarget.value as Settings['boxFormat'] })}>
              <option value="auto">Auto ({detectBoxFormat(id, config.model)})</option>
              <option value="yxyx1000">Gemini box_2d (y, x on 0-1000)</option>
              <option value="xyxy1000">x0, y0, x1, y1 on 0-1000</option>
              <option value="pixels">Pixel coordinates</option>
            </select>
          </label>
        </details>
      </div>

      <div class="test-row">
        <button class="btn primary" onClick={() => void runTest()} disabled={test.status === 'running' || !providerReady(settings)}>
          {test.status === 'running' ? 'Testing…' : 'Test with a sample image'}
        </button>
        {test.message && <span class={`pill ${test.status === 'ok' ? 'ok' : 'err'}`}>{test.message}</span>}
      </div>
    </Section>
  );
}

function Shortcuts() {
  const [commands, setCommands] = useState<{ name?: string; description?: string; shortcut?: string }[]>([]);
  useEffect(() => {
    void browser.commands.getAll().then(setCommands);
  }, []);
  const firefox = navigator.userAgent.includes('Firefox');
  return (
    <Section title="Keyboard shortcuts" text="Press them on any page.">
      <ul class="shortcuts">
        {commands
          .filter((c) => c.description)
          .map((c) => (
            <li key={c.name}>
              <span>{c.description}</span>
              <kbd>{c.shortcut || 'not set'}</kbd>
            </li>
          ))}
        <li>
          <span>Close the lens over an image</span>
          <kbd>Esc</kbd>
        </li>
        <li>
          <span>Select all text of the hovered image</span>
          <kbd>Ctrl/⌘ A</kbd>
        </li>
      </ul>
      <p class="muted">
        {firefox ? (
          'Change shortcuts in about:addons → gear menu → Manage Extension Shortcuts.'
        ) : (
          <a href="#" onClick={(e) => { e.preventDefault(); void browser.tabs.create({ url: 'chrome://extensions/shortcuts' }); }}>
            Change shortcuts
          </a>
        )}
      </p>
    </Section>
  );
}

let saveChain: Promise<unknown> = Promise.resolve();

function Options() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout>>();
  const welcome = useMemo(() => location.hash === '#welcome', []);

  useEffect(() => {
    void getSettings().then(setSettings);
  }, []);

  const update = (patch: Partial<Settings>) => {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    // Serialize writes so quick successive edits never overwrite each other.
    saveChain = saveChain.then(() => saveSettings(patch));
    void saveChain.then(() => {
      setSaved(true);
      clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaved(false), 1400);
    });
  };

  if (!settings) return null;
  const effective = resolveEngine(settings);

  return (
    <div class="page">
      <header class="top">
        <div class="brand">
          <Logo size={44} />
          <div>
            <h1>MagicLens</h1>
            <div class="tag">Read, select, translate and explain the text inside any image.</div>
          </div>
        </div>
        <span class={`saved ${saved ? 'on' : ''}`}>Saved</span>
      </header>

      {welcome && (
        <div class="welcome">
          <strong>You're set.</strong> Hover any image and click the lens button, press{' '}
          <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>, or right-click an image → <i>Read text in image</i>.
          Local OCR works right away; connect an AI provider below for translation and explanations.
        </div>
      )}

      <Section title="Reading engine" text={`Currently using: ${ENGINES.find((e) => e.id === effective)?.title}.`}>
        <div class="engines">
          {ENGINES.map((engine) => (
            <button key={engine.id} class="engine" aria-pressed={settings.engine === engine.id} onClick={() => update({ engine: engine.id })}>
              <strong>{engine.title}</strong>
              <small>{engine.text}</small>
            </button>
          ))}
        </div>
        {settings.engine !== 'local' && settings.engine !== 'auto' && !providerReady(settings) && (
          <p class="warn-text">This engine needs an AI provider — set one up below.</p>
        )}
      </Section>

      <ProviderSection settings={settings} update={update} />

      <Section
        title="Local OCR"
        text={
          settings.ocrModel === 'tesseract'
            ? 'Languages Tesseract should look for. English is built in; other languages download once (2–15 MB each) and are cached.'
            : 'PaddleOCR runs from models bundled with the extension. Nothing is downloaded.'
        }
      >
        <label class="field inline">
          <span>OCR model</span>
          <select value={settings.ocrModel} onChange={(e) => update({ ocrModel: e.currentTarget.value as Settings['ocrModel'] })}>
            <option value="tesseract">Tesseract</option>
            <option value="paddle">PaddleOCR PP-OCRv5 (mobile)</option>
          </select>
        </label>
        {settings.ocrModel === 'tesseract' && (
          <>
            <div class="chips">
              {OCR_LANGUAGES.map(([code, label]) => {
                const on = settings.ocrLangs.includes(code);
                return (
                  <button
                    key={code}
                    class="chip"
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? settings.ocrLangs.filter((l) => l !== code) : [...settings.ocrLangs, code];
                      update({ ocrLangs: next.length ? next : ['eng'] });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <label class="field inline">
              <span>Page layout</span>
              <select value={settings.segmentation} onChange={(e) => update({ segmentation: e.currentTarget.value as Settings['segmentation'] })}>
                <option value="auto">Automatic (documents, screenshots; retries sparse text)</option>
                <option value="sparse">Sparse text (memes, signs, UI)</option>
                <option value="block">Single block of text</option>
              </select>
            </label>
          </>
        )}
      </Section>

      <Section title="Translation & answers">
        <label class="field inline">
          <span>Translate into</span>
          <select value={settings.translateTo} onChange={(e) => update({ translateTo: e.currentTarget.value })}>
            {TRANSLATE_TARGETS.map((lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            ))}
          </select>
        </label>
        <label class="field">
          <span>Extra instructions for explanations and answers</span>
          <textarea
            value={settings.customInstructions}
            placeholder="e.g. Answer in Spanish. Keep it short. Explain like I'm a student."
            onInput={(e) => update({ customInstructions: e.currentTarget.value })}
          />
        </label>
      </Section>

      <Section title="Interface">
        <Toggle
          label="Lens button on images"
          text="Shows a small button when you hover an image."
          checked={settings.hoverButton}
          onChange={(hoverButton) => update({ hoverButton })}
        />
        <label class="field inline">
          <span>Smallest image to offer the button on: {settings.minImageSize}px</span>
          <input
            type="range"
            min={48}
            max={320}
            step={8}
            value={settings.minImageSize}
            onInput={(e) => update({ minImageSize: Number(e.currentTarget.value) })}
          />
        </label>
        <Toggle
          label="Reduce motion"
          text="Calmer effects (also follows your system setting)."
          checked={settings.reducedMotion}
          onChange={(reducedMotion) => update({ reducedMotion })}
        />
      </Section>

      <Shortcuts />

      <Section title="Privacy">
        <ul class="privacy">
          <li><b>Local OCR</b> runs entirely in your browser. Nothing leaves your device.</li>
          <li><b>Hybrid and AI</b> modes send the image (and recognized text) only to the provider you chose, only when you read an image.</li>
          <li>API keys are stored in this browser's local extension storage and are never synced.</li>
        </ul>
      </Section>

      <Section
        title="About"
        text={`Version ${browser.runtime.getManifest().version}. Updates arrive automatically through your browser's add-on store.`}
      >
        <p class="support">
          MagicLens is free and has no ads or tracking. If it saves you time, you can support its
          development.{' '}
          <a class="btn" href={SUPPORT_URL} target="_blank" rel="noopener">
            Support on Ko-fi
          </a>
        </p>
        <p class="legal-links">
          <a href="legal.html#privacy" target="_blank">Privacy policy</a>
          <a href="legal.html#terms" target="_blank">Terms of use</a>
        </p>
      </Section>
    </div>
  );
}

render(<Options />, document.getElementById('app')!);
