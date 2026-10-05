export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function uid(prefix = 'ml'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Error carrying a stable code the UI can react to. */
export class CodedError extends Error {
  constructor(
    readonly code: import('./messages').ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CodedError';
  }
}
