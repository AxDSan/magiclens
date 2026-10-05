import { CodedError, errorMessage } from '../../shared/util';

/** Turns an HTTP failure from a provider into a message a person can act on. */
export function providerHttpError(
  label: string,
  baseUrl: string,
  status: number,
  body: string,
): CodedError {
  let detail = body.trim();
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message ?? parsed?.message ?? parsed?.error ?? detail;
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    // Not JSON; keep the raw text.
  }
  detail = detail.slice(0, 300);
  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(baseUrl);
  let message: string;
  if (status === 401) message = `${label} rejected the API key. Check it in MagicLens settings.`;
  else if (status === 403 && baseUrl.includes(':11434'))
    message =
      'Ollama refused the request from the extension. Restart Ollama with ' +
      'OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*,safari-web-extension://*".';
  else if (status === 403) message = `${label} denied access (403). ${detail}`;
  else if (status === 404) message = `${label}: model or endpoint not found. ${detail}`;
  else if (status === 429) message = `${label} rate limit or quota reached. ${detail}`;
  else if (status >= 500) message = `${label} is having trouble (${status}). ${detail}`;
  else message = `${label} error ${status}: ${detail}`;
  if (local && status === 404) message += ' Is the model loaded in your local server?';
  return new CodedError('PROVIDER_ERROR', message);
}

export function providerNetworkError(label: string, baseUrl: string, error: unknown): CodedError {
  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(baseUrl);
  return new CodedError(
    'PROVIDER_ERROR',
    local
      ? `Could not reach ${label} at ${baseUrl}. Is the server running?`
      : `Could not reach ${label}: ${errorMessage(error)}`,
  );
}
