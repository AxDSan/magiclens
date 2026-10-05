import type { ProviderPreset } from '../../shared/providers';
import type { ProviderConfig } from '../../shared/settings';
import { CodedError } from '../../shared/util';
import { providerHttpError, providerNetworkError } from './errors';
import { readSse, stripThinking } from './sse';
import type { LlmClient, LlmRequest } from './types';

/** OpenAI chat-completions, which most providers and local servers also speak. */
export function createOpenAiClient(preset: ProviderPreset, config: ProviderConfig): LlmClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const official = /api\.openai\.com/.test(baseUrl);
  const reasoningModel = /^(o\d|gpt-5)/i.test(config.model);

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    ...(preset.id === 'openrouter' ? { 'X-Title': 'MagicLens' } : {}),
  });

  async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    try {
      return await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw new CodedError('CANCELLED', 'Cancelled');
      throw providerNetworkError(preset.label, baseUrl, error);
    }
  }

  return {
    label: preset.label,
    model: config.model,

    async complete(request: LlmRequest): Promise<string> {
      const content: unknown[] = [];
      if (request.image) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${request.image.mime};base64,${request.image.base64}`,
            ...(official ? { detail: 'high' } : {}),
          },
        });
      }
      content.push({ type: 'text', text: request.prompt });

      const body: Record<string, unknown> = {
        model: config.model,
        stream: true,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content },
        ],
      };
      const maxTokens = request.maxTokens ?? 8192;
      if (official) body.max_completion_tokens = maxTokens;
      else body.max_tokens = maxTokens;
      if (!reasoningModel) body.temperature = request.purpose === 'ocr' ? 0 : 0.4;
      if (official && request.json) body.response_format = { type: 'json_object' };

      // Providers disagree on parameter names; drop or rename what a server rejects.
      let response = await post(body, request.signal);
      for (let attempt = 0; attempt < 3 && response.status === 400; attempt++) {
        const text = await response.text();
        let changed = false;
        if (/max_completion_tokens/.test(text) && 'max_tokens' in body) {
          body.max_completion_tokens = body.max_tokens;
          delete body.max_tokens;
          changed = true;
        } else if (/max_tokens/.test(text) && 'max_completion_tokens' in body) {
          body.max_tokens = body.max_completion_tokens;
          delete body.max_completion_tokens;
          changed = true;
        }
        if (/temperature/.test(text) && 'temperature' in body) {
          delete body.temperature;
          changed = true;
        }
        if (/response_format/.test(text) && 'response_format' in body) {
          delete body.response_format;
          changed = true;
        }
        if (!changed) throw providerHttpError(preset.label, baseUrl, 400, text);
        response = await post(body, request.signal);
      }
      if (!response.ok) {
        throw providerHttpError(preset.label, baseUrl, response.status, await response.text());
      }

      // Some servers ignore `stream` and answer with a plain JSON body.
      if (!response.headers.get('content-type')?.includes('text/event-stream')) {
        const json = await response.json();
        const text = stripThinking(json?.choices?.[0]?.message?.content ?? '');
        request.onText?.(text);
        return text;
      }

      let full = '';
      try {
        for await (const event of readSse(response.body!)) {
          if (event.data === '[DONE]') break;
          let chunk: {
            choices?: { delta?: { content?: string | null } }[];
            error?: { message?: string };
          };
          try {
            chunk = JSON.parse(event.data);
          } catch {
            continue;
          }
          if (chunk.error) {
            throw new CodedError(
              'PROVIDER_ERROR',
              `${preset.label}: ${chunk.error.message ?? 'stream error'}`,
            );
          }
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            full += delta;
            request.onText?.(stripThinking(full));
          }
        }
      } catch (error) {
        if (request.signal?.aborted) throw new CodedError('CANCELLED', 'Cancelled');
        throw error;
      }
      return stripThinking(full);
    },

    async listModels(): Promise<string[]> {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/models`, { headers: headers() });
      } catch (error) {
        throw providerNetworkError(preset.label, baseUrl, error);
      }
      if (!response.ok) {
        throw providerHttpError(preset.label, baseUrl, response.status, await response.text());
      }
      const json = (await response.json()) as {
        data?: { id: string; architecture?: { input_modalities?: string[] } }[];
      };
      return (json.data ?? [])
        .filter((m) => !m.architecture?.input_modalities || m.architecture.input_modalities.includes('image'))
        .map((m) => m.id)
        .sort();
    },
  };
}
