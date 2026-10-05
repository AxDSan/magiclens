import type { EncodedImage } from '../image';

export interface LlmRequest {
  system: string;
  prompt: string;
  image?: EncodedImage;
  /** OCR wants terse, deterministic JSON; analysis wants prose. */
  purpose: 'ocr' | 'analysis';
  json?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Called with the full text generated so far. */
  onText?: (text: string) => void;
}

export interface LlmClient {
  readonly label: string;
  readonly model: string;
  complete(request: LlmRequest): Promise<string>;
  listModels(): Promise<string[]>;
}
