/** Axis-aligned box in normalized coordinates (0..1) of the analyzed image. */
export interface NBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrWord {
  text: string;
  box: NBox;
  conf: number;
}

export interface OcrLine {
  id: string;
  text: string;
  box: NBox;
  /** Normalized font size (fraction of image height). */
  size: number;
  /** Baseline: normalized y where the baseline crosses box.x, and its slope in radians. */
  baseline?: { y: number; angle: number };
  conf: number;
  words: OcrWord[];
  /** Estimated text / background colors, `#rrggbb`. */
  fg?: string;
  bg?: string;
  /** True when the position came from a language model instead of a text detector. */
  approximate?: boolean;
}

export interface OcrBlock {
  id: string;
  box: NBox;
  lines: OcrLine[];
}

export type EngineKind = 'local' | 'llm' | 'hybrid';

export interface OcrResult {
  engine: EngineKind;
  /** Human-readable model name, e.g. "Tesseract (eng)" or "gpt-4.1-mini". */
  model: string;
  width: number;
  height: number;
  blocks: OcrBlock[];
  text: string;
  language?: string;
  ms: number;
  notes?: string[];
}

/** Where the pixels come from. The content script picks the cheapest source that works. */
export type ImageSource =
  | { kind: 'url'; url: string }
  | { kind: 'data'; dataUrl: string }
  | {
      kind: 'capture';
      /** Visible element rect in viewport CSS pixels. */
      rect: Rect;
      viewport: { w: number; h: number };
      /** Filled in by the background script. */
      shot?: string;
    };

export type AnalysisKind = 'explain' | 'summarize' | 'translate' | 'ask';

export interface ProgressInfo {
  stage: 'acquire' | 'load' | 'detect' | 'recognize' | 'llm' | 'refine' | 'done';
  /** 0..1, or undefined when indeterminate. */
  progress?: number;
  label: string;
}
