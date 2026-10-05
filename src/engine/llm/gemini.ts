import type { ProviderPreset } from '../../shared/providers';
import type { ProviderConfig } from '../../shared/settings';
import { CodedError } from '../../shared/util';
import { providerHttpError, providerNetworkError } from './errors';
import { readSse } from './sse';
import type { LlmClient, LlmRequest } from './types';

interface GeminiChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/** Google's native generateContent API (its spatial output is the best documented). */
export function createGeminiClient(preset: ProviderPreset, config: ProviderConfig): LlmClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const model = config.model.replace(/^models\//, '');
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey };

  return {
    label: preset.label,
    model,

    async complete(request: LlmRequest): Promise<string> {
      const parts: unknown[] = [];
      if (request.image) {
        parts.push({ inlineData: { mimeType: request.image.mime, data: request.image.base64 } });
      }
      parts.push({ text: request.prompt });
      const body = {
        systemInstruction: { parts: [{ text: request.system }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: request.purpose === 'ocr' ? 0 : 0.4,
          maxOutputTokens: request.maxTokens ?? 16384,
          ...(request.json ? { responseMimeType: 'application/json' } : {}),
        },
      };

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/models/${model}:streamGenerateContent?alt=sse`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal?.aborted) throw new CodedError('CANCELLED', 'Cancelled');
        throw providerNetworkError(preset.label, baseUrl, error);
      }
      if (!response.ok) {
        throw providerHttpError(preset.label, baseUrl, response.status, await response.text());
      }

      let full = '';
      try {
        for await (const event of readSse(response.body!)) {
          let chunk: GeminiChunk;
          try {
            chunk = JSON.parse(event.data);
          } catch {
            continue;
          }
          if (chunk.error) {
            throw new CodedError('PROVIDER_ERROR', `Gemini: ${chunk.error.message ?? 'error'}`);
          }
          if (chunk.promptFeedback?.blockReason) {
            throw new CodedError(
              'PROVIDER_ERROR',
              `Gemini blocked this image (${chunk.promptFeedback.blockReason}).`,
            );
          }
          for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
            if (part.text && !part.thought) {
              full += part.text;
              request.onText?.(full);
            }
          }
        }
      } catch (error) {
        if (request.signal?.aborted) throw new CodedError('CANCELLED', 'Cancelled');
        throw error;
      }
      return full;
    },

    async listModels(): Promise<string[]> {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/models?pageSize=1000`, { headers });
      } catch (error) {
        throw providerNetworkError(preset.label, baseUrl, error);
      }
      if (!response.ok) {
        throw providerHttpError(preset.label, baseUrl, response.status, await response.text());
      }
      const json = (await response.json()) as {
        models?: { name: string; supportedGenerationMethods?: string[] }[];
      };
      return (json.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .filter((name) => name.startsWith('gemini'))
        .sort();
    },
  };
}
