import { PROVIDERS, type ProviderId } from '../../shared/providers';
import type { ProviderConfig } from '../../shared/settings';
import { createAnthropicClient } from './anthropic';
import { createGeminiClient } from './gemini';
import { createOpenAiClient } from './openai';
import type { LlmClient } from './types';

export type { LlmClient, LlmRequest } from './types';

export function createClient(provider: ProviderId, config: ProviderConfig): LlmClient {
  const preset = PROVIDERS[provider];
  switch (preset.kind) {
    case 'anthropic':
      return createAnthropicClient(preset, config);
    case 'gemini':
      return createGeminiClient(preset, config);
    default:
      return createOpenAiClient(preset, config);
  }
}
