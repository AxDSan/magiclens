export type ProviderKind = 'openai' | 'anthropic' | 'gemini';

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'xai'
  | 'together'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

/**
 * How a model reports text positions.
 * - `yxyx1000`: Gemini's native `box_2d` = [ymin, xmin, ymax, xmax] on a 0-1000 grid.
 * - `xyxy1000`: [x0, y0, x1, y1] on a 0-1000 grid (Qwen3-VL and a sane default).
 * - `pixels`: [x0, y0, x1, y1] in pixels of the image as sent (Claude, Qwen2.5-VL).
 */
export type BoxFormat = 'yxyx1000' | 'xyxy1000' | 'pixels';

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  needsKey: boolean;
  local?: boolean;
  keyUrl?: string;
  hint?: string;
  /** Longest image side to send; larger images are downscaled first. */
  maxImageSide: number;
}

export const PROVIDERS: Record<ProviderId, ProviderPreset> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    needsKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    maxImageSide: 2048,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-opus-5',
    needsKey: true,
    keyUrl: 'https://platform.claude.com/settings/keys',
    maxImageSide: 1568,
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-flash-latest',
    needsKey: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    hint: 'Gemini returns the most precise text positions of the cloud models.',
    maxImageSide: 3072,
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
    needsKey: true,
    keyUrl: 'https://openrouter.ai/keys',
    hint: 'One key for hundreds of models. Pick any model with image input.',
    maxImageSide: 2048,
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    needsKey: true,
    keyUrl: 'https://console.groq.com/keys',
    maxImageSide: 1600,
  },
  mistral: {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    needsKey: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    maxImageSide: 1600,
  },
  xai: {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4',
    needsKey: true,
    keyUrl: 'https://console.x.ai',
    maxImageSide: 1600,
  },
  together: {
    id: 'together',
    label: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    model: 'Qwen/Qwen2.5-VL-72B-Instruct',
    needsKey: true,
    keyUrl: 'https://api.together.ai/settings/api-keys',
    maxImageSide: 1600,
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5vl:3b',
    needsKey: false,
    local: true,
    hint:
      'Pull a vision model first (ollama pull qwen2.5vl:3b) and start Ollama with ' +
      'OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*,safari-web-extension://*".',
    maxImageSide: 1280,
  },
  lmstudio: {
    id: 'lmstudio',
    label: 'LM Studio (local)',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    needsKey: false,
    local: true,
    hint: 'Load a vision model (e.g. Qwen2.5-VL or Gemma 3) and start the local server.',
    maxImageSide: 1280,
  },
  custom: {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    kind: 'openai',
    baseUrl: 'http://localhost:8000/v1',
    model: '',
    needsKey: false,
    hint: 'Any server that speaks the OpenAI chat-completions API with image input.',
    maxImageSide: 1600,
  },
};

export const PROVIDER_ORDER: ProviderId[] = [
  'anthropic',
  'openai',
  'gemini',
  'openrouter',
  'groq',
  'mistral',
  'xai',
  'together',
  'ollama',
  'lmstudio',
  'custom',
];

/** Picks the coordinate convention a model was trained on. */
export function detectBoxFormat(provider: ProviderId, model: string): BoxFormat {
  const m = model.toLowerCase();
  if (provider === 'gemini' || m.includes('gemini')) return 'yxyx1000';
  if (/qwen-?2\.?5-?vl|qwen2_5_vl|qwen2\.5vl/.test(m)) return 'pixels';
  if (/qwen-?3-?vl|qwen3vl/.test(m)) return 'xyxy1000';
  if (provider === 'anthropic' || m.includes('claude')) return 'pixels';
  return 'xyxy1000';
}
