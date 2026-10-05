import type { OcrBlock, OcrLine, OcrWord } from '../shared/types';
import { groupBlocks, linesFromRaw, type ParsedRefinement, splitWords } from './llm/parse';

/** Keeps the detector's word boxes when the corrected line has the same word count. */
function rewordLine(line: OcrLine, text: string): OcrWord[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length === line.words.length) {
    return line.words.map((word, i) => ({ ...word, text: tokens[i] }));
  }
  // Different segmentation: spread the words over the span the detector found ink in.
  const first = line.words[0]?.box ?? line.box;
  const last = line.words[line.words.length - 1]?.box ?? line.box;
  const span = { x: first.x, y: line.box.y, w: last.x + last.w - first.x, h: line.box.h };
  return splitWords(text, span, line.conf);
}

/**
 * Applies a language model's corrections to detector output: positions stay exact,
 * text comes from the model, and lines the detector missed are added with model boxes.
 */
export function mergeRefinement(blocks: OcrBlock[], refinement: ParsedRefinement): OcrBlock[] {
  const merged: OcrBlock[] = [];
  for (const block of blocks) {
    const lines: OcrLine[] = [];
    for (const line of block.lines) {
      const corrected = refinement.corrections.get(line.id);
      if (corrected === undefined || corrected === line.text) {
        lines.push(line);
      } else if (corrected) {
        lines.push({ ...line, text: corrected, words: rewordLine(line, corrected), conf: Math.max(line.conf, 0.9) });
      }
    }
    if (lines.length) merged.push({ ...block, lines });
  }
  if (refinement.missing.length) {
    const extra = linesFromRaw(refinement.missing, 'm', 0.75);
    merged.push(...groupBlocks(extra, 'mb'));
  }
  return merged;
}
