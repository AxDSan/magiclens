import Anthropic from '@anthropic-ai/sdk';
import type { ProviderPreset } from '../../shared/providers';
import type { ProviderConfig } from '../../shared/settings';
import { CodedError } from '../../shared/util';
import { providerHttpError, providerNetworkError } from './errors';
import type { LlmClient, LlmRequest } from './types';

type ImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

// Models with server-side refusal fallbacks and the effort control.
const supportsFallbacks = (model: string) => /^claude-(opus-5|fable-5)/.test(model);
const supportsEffort = (model: string) =>
  /^claude-(opus-[5-9]|opus-4-[5-9]|sonnet-[5-9]|sonnet-4-[6-9]|fable|mythos)/.test(model);

export function createAnthropicClient(preset: ProviderPreset, config: ProviderConfig): LlmClient {
  const client = new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseUrl.replace(/\/+$/, '') || undefined,
    // The key belongs to the person running the extension and never leaves their browser
    // except to go to Anthropic.
    dangerouslyAllowBrowser: true,
    maxRetries: 1,
  });

  function translateError(error: unknown, signal?: AbortSignal): Error {
    if (signal?.aborted || error instanceof Anthropic.APIUserAbortError) {
      return new CodedError('CANCELLED', 'Cancelled');
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return providerNetworkError(preset.label, config.baseUrl, error);
    }
    if (error instanceof Anthropic.APIError && typeof error.status === 'number') {
      return providerHttpError(preset.label, config.baseUrl, error.status, error.message);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  return {
    label: preset.label,
    model: config.model,

    async complete(request: LlmRequest): Promise<string> {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (request.image) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: request.image.mime as ImageMime,
            data: request.image.base64,
          },
        });
      }
      content.push({ type: 'text', text: request.prompt });

      let useFallbacks = supportsFallbacks(config.model);
      let useEffort = supportsEffort(config.model);

      const run = async (): Promise<string> => {
        const stream = client.beta.messages.stream(
          {
            model: config.model,
            max_tokens: request.maxTokens ?? 32000,
            system: request.system,
            messages: [{ role: 'user', content }],
            // Reading text is a simple task: low effort keeps it fast.
            ...(useEffort
              ? { output_config: { effort: request.purpose === 'ocr' ? 'low' : 'medium' } }
              : {}),
            ...(useFallbacks
              ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
              : {}),
          },
          { signal: request.signal },
        );
        let text = '';
        for await (const event of stream) {
          if (event.type === 'content_block_start' && event.content_block.type === 'fallback') {
            // A declined partial answer is followed by the fallback model's own answer.
            text = '';
            request.onText?.(text);
          } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            text += event.delta.text;
            request.onText?.(text);
          }
        }
        const message = await stream.finalMessage();
        if (message.stop_reason === 'refusal') {
          throw new CodedError('PROVIDER_ERROR', 'Claude declined to process this image.');
        }
        const lastFallback = message.content.findLastIndex((block) => block.type === 'fallback');
        return message.content
          .slice(lastFallback + 1)
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('');
      };

      try {
        return await run();
      } catch (error) {
        // Older or proxied deployments may reject the newer request fields; retry without.
        if (
          error instanceof Anthropic.BadRequestError &&
          (useFallbacks || useEffort) &&
          /fallback|effort|output_config|beta/i.test(error.message)
        ) {
          useFallbacks = false;
          useEffort = false;
          try {
            return await run();
          } catch (retryError) {
            throw translateError(retryError, request.signal);
          }
        }
        throw translateError(error, request.signal);
      }
    },

    async listModels(): Promise<string[]> {
      const ids: string[] = [];
      try {
        for await (const model of client.models.list()) ids.push(model.id);
      } catch (error) {
        throw translateError(error);
      }
      return ids;
    },
  };
}
