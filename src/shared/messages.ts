import type { Settings } from './settings';
import type { AnalysisKind, EngineKind, ImageSource, OcrResult, ProgressInfo } from './types';

export const CONTENT_PORT = 'magiclens';

export type ErrorCode =
  | 'FETCH_FAILED'
  | 'DECODE_FAILED'
  | 'CAPTURE_FAILED'
  | 'NO_PROVIDER'
  | 'PROVIDER_ERROR'
  | 'CANCELLED'
  | 'INTERNAL';

export interface OcrJob {
  jobId: string;
  source: ImageSource;
  /** Overrides the engine picked in settings for this one job. */
  engine?: EngineKind;
}

export interface AnalysisJob {
  reqId: string;
  kind: AnalysisKind;
  question?: string;
  /** JPEG data URL returned with the OCR result. */
  image: string;
  result: OcrResult;
}

/** Content script -> background, over the long-lived port. */
export type ContentRequest =
  | ({ t: 'ocr' } & OcrJob)
  | ({ t: 'analyze' } & AnalysisJob)
  | { t: 'cancel'; id: string }
  | { t: 'open-options' }
  /** Keeps Chrome's service worker awake while a long job runs. */
  | { t: 'ping' };

/** Engine -> content script (relayed by the background script). */
export type EngineEvent =
  /** Sent by the background script once a screenshot was taken (the overlay may now show). */
  | { t: 'captured'; id: string }
  | { t: 'progress'; id: string; info: ProgressInfo }
  | { t: 'partial'; id: string; result: OcrResult }
  | { t: 'result'; id: string; result: OcrResult; image: string }
  | { t: 'delta'; id: string; text: string }
  | { t: 'done'; id: string; text: string; translations?: Record<string, string> }
  | { t: 'error'; id: string; message: string; code: ErrorCode };

/** Background -> content script, via tabs.sendMessage. */
export type TriggerMode = 'main' | 'pick' | 'all' | 'context';

export interface TriggerMessage {
  t: 'trigger';
  mode: TriggerMode;
  srcUrl?: string;
  engine?: EngineKind;
}

/**
 * Background -> engine. Settings travel with each job because Chrome's offscreen document
 * has no access to extension storage.
 */
export type EngineCommand =
  | ({ type: 'ocr'; settings: Settings } & OcrJob)
  | ({ type: 'analyze'; settings: Settings } & AnalysisJob)
  | { type: 'cancel'; id: string };

export interface ToEngine {
  target: 'engine';
  cmd: EngineCommand;
}

export interface FromEngine {
  target: 'background';
  event: EngineEvent;
}
