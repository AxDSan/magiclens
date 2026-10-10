import { browser } from 'wxt/browser';
import type { OcrLine } from '../../shared/types';

// Files added by the build hook in wxt.config.ts are not in WXT's typed public paths.
export const assetUrl = (path: string) => (browser.runtime.getURL as (p: string) => string)(path);

export function lineIsNoise(line: Pick<OcrLine, 'text' | 'conf'>): boolean {
  const alnum = (line.text.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (alnum === 0) return true;
  // Isolated single glyphs are usually texture, not text.
  return line.text.replace(/\s/g, '').length === 1 && line.conf < 0.8;
}
