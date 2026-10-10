import { browser } from 'wxt/browser';
import { type BoxFormat, PROVIDERS, type ProviderId, PROVIDER_ORDER } from './providers';

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type EngineChoice = 'auto' | 'local' | 'llm' | 'hybrid';
export type PageSegmentation = 'auto' | 'sparse' | 'block';
export type OcrModel = 'tesseract' | 'paddle';

export interface Settings {
  engine: EngineChoice;
  ocrLangs: string[];
  ocrModel: OcrModel;
  segmentation: PageSegmentation;
  provider: ProviderId;
  providers: Record<ProviderId, ProviderConfig>;
  boxFormat: 'auto' | BoxFormat;
  translateTo: string;
  hoverButton: boolean;
  minImageSize: number;
  reducedMotion: boolean;
  /** Extra instructions appended to every analysis prompt. */
  customInstructions: string;
}

export const DEFAULT_SETTINGS: Settings = {
  engine: 'auto',
  ocrLangs: ['eng'],
  ocrModel: 'tesseract',
  segmentation: 'auto',
  provider: 'anthropic',
  providers: Object.fromEntries(
    PROVIDER_ORDER.map((id) => [
      id,
      { apiKey: '', baseUrl: PROVIDERS[id].baseUrl, model: PROVIDERS[id].model },
    ]),
  ) as Record<ProviderId, ProviderConfig>,
  boxFormat: 'auto',
  translateTo: 'English',
  hoverButton: true,
  minImageSize: 96,
  reducedMotion: false,
  customInstructions: '',
};

const KEY = 'settings';

function merge(stored: Partial<Settings> | undefined): Settings {
  const providers = { ...DEFAULT_SETTINGS.providers };
  for (const id of PROVIDER_ORDER) {
    providers[id] = { ...DEFAULT_SETTINGS.providers[id], ...stored?.providers?.[id] };
  }
  return { ...DEFAULT_SETTINGS, ...stored, providers };
}

// API keys stay in storage.local: storage.sync would copy them to every signed-in device.
export async function getSettings(): Promise<Settings> {
  const data = await browser.storage.local.get(KEY);
  return merge(data[KEY] as Partial<Settings> | undefined);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = merge({ ...(await getSettings()), ...patch });
  await browser.storage.local.set({ [KEY]: next });
  return next;
}

export function onSettingsChanged(callback: (settings: Settings) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'local' && changes[KEY]) {
      callback(merge(changes[KEY].newValue as Partial<Settings> | undefined));
    }
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** True when the active provider has what it needs to run (a key, or a local model). */
export function providerReady(settings: Settings): boolean {
  const preset = PROVIDERS[settings.provider];
  const config = settings.providers[settings.provider];
  if (!config.baseUrl || !config.model) return false;
  return !preset.needsKey || config.apiKey.trim().length > 0;
}

/** Resolves `auto` to a concrete engine. */
export function resolveEngine(settings: Settings): 'local' | 'llm' | 'hybrid' {
  if (settings.engine !== 'auto') return settings.engine;
  return providerReady(settings) ? 'hybrid' : 'local';
}
