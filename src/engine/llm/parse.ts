import type { BoxFormat } from '../../shared/providers';
import type { NBox, OcrBlock, OcrLine } from '../../shared/types';
import { clamp } from '../../shared/util';
import { stripThinking } from './sse';

/** Pulls the first JSON value out of model output, repairing common damage. */
export function extractJson(raw: string): unknown {
  const text = stripThinking(raw).replace(/```(?:json)?/gi, '');
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error('The model did not return JSON');

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
    else if (c === '}' || c === ']') {
      stack.pop();
      if (!stack.length) {
        end = i + 1;
        break;
      }
    }
  }

  let candidate: string;
  if (end > 0) {
    candidate = text.slice(start, end);
  } else {
    // Truncated output (token limit): drop the dangling fragment and close what is open.
    candidate = text.slice(start);
    if (inString) candidate += '"';
    candidate = candidate.replace(/,\s*"[^"]*"?\s*:?\s*$/, '').replace(/[,:\s]+$/, '');
    candidate += stack.reverse().join('');
  }
  const attempts = [candidate, candidate.replace(/,\s*([}\]])/g, '$1')];
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try the next repair
    }
  }
  // Last resort for truncation in the middle of an array element: cut back to the last
  // complete object.
  const lastObject = candidate.lastIndexOf('},');
  if (lastObject > 0) {
    const trimmed = candidate.slice(0, lastObject + 1);
    const open = (trimmed.match(/\[/g) ?? []).length - (trimmed.match(/]/g) ?? []).length;
    const braces = (trimmed.match(/{/g) ?? []).length - (trimmed.match(/}/g) ?? []).length;
    try {
      return JSON.parse(trimmed + ']'.repeat(Math.max(0, open)) + '}'.repeat(Math.max(0, braces)));
    } catch {
      // fall through
    }
  }
  throw new Error('The model returned malformed JSON');
}

const BOX_KEYS = ['box_2d', 'bbox_2d', 'bbox', 'box', 'bounding_box', 'boundingBox', 'coordinates', 'position', 'rect'];

/** Reads a box in any of the shapes models produce, as raw [a, b, c, d] numbers. */
function rawBox(item: Record<string, unknown>): number[] | null {
  for (const key of BOX_KEYS) {
    const value = item[key];
    if (Array.isArray(value)) {
      if (value.length === 4 && value.every((v) => typeof v === 'number')) return value as number[];
      // Quadrilateral as four [x, y] points.
      if (value.length >= 4 && value.every((p) => Array.isArray(p) && p.length >= 2)) {
        const xs = (value as number[][]).map((p) => p[0]);
        const ys = (value as number[][]).map((p) => p[1]);
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }
    } else if (value && typeof value === 'object') {
      const o = value as Record<string, number>;
      if ('x0' in o) return [o.x0, o.y0, o.x1, o.y1];
      if ('xmin' in o) return [o.xmin, o.ymin, o.xmax, o.ymax];
      if ('left' in o && 'right' in o) return [o.left, o.top, o.right, o.bottom];
      if ('x' in o && 'width' in o) return [o.x, o.y, o.x + o.width, o.y + o.height];
      if ('x' in o && 'w' in o) return [o.x, o.y, o.x + o.w, o.y + o.h];
    }
  }
  return null;
}

export interface RawLine {
  text: string;
  box: NBox;
}

/**
 * Converts model boxes to normalized boxes. The declared format is a strong hint, but models
 * drift (0-1 floats, pixels on a 0-1000 request), so the value range decides when they clash.
 */
export function toNBoxes(
  items: { text: string; raw: number[] }[],
  format: BoxFormat,
  width: number,
  height: number,
): RawLine[] {
  if (!items.length) return [];
  const max = Math.max(...items.flatMap((i) => i.raw));
  let mode: 'unit' | 'grid' | 'pixels' = format === 'pixels' ? 'pixels' : 'grid';
  if (max <= 1.0001) mode = 'unit';
  else if (mode === 'pixels' && max > Math.max(width, height) * 1.05 && max <= 1000) mode = 'grid';
  else if (mode === 'grid' && max > 1000.5) mode = 'pixels';

  const out: RawLine[] = [];
  for (const { text, raw } of items) {
    let [x0, y0, x1, y1] = format === 'yxyx1000' ? [raw[1], raw[0], raw[3], raw[2]] : raw;
    const sx = mode === 'unit' ? 1 : mode === 'grid' ? 1000 : width;
    const sy = mode === 'unit' ? 1 : mode === 'grid' ? 1000 : height;
    x0 = clamp(x0 / sx, 0, 1);
    x1 = clamp(x1 / sx, 0, 1);
    y0 = clamp(y0 / sy, 0, 1);
    y1 = clamp(y1 / sy, 0, 1);
    if (x1 < x0) [x0, x1] = [x1, x0];
    if (y1 < y0) [y0, y1] = [y1, y0];
    if (x1 - x0 < 0.002 || y1 - y0 < 0.002) continue;
    out.push({ text, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
  }
  return out;
}

function itemsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((v) => v && typeof v === 'object');
  return [];
}

export interface ParsedOcr {
  language?: string;
  lines: RawLine[];
}

export function parseOcrJson(raw: string, format: BoxFormat, width: number, height: number): ParsedOcr {
  const json = extractJson(raw);
  const root = (Array.isArray(json) ? { lines: json } : json) as Record<string, unknown>;
  const list = itemsOf(root.lines ?? root.text_lines ?? root.results ?? root.items ?? []);
  const items = list
    .map((item) => ({
      text: String(item.text ?? item.content ?? item.label ?? '').trim(),
      raw: rawBox(item),
    }))
    .filter((i): i is { text: string; raw: number[] } => !!i.text && !!i.raw);
  return {
    language: typeof root.language === 'string' ? root.language : undefined,
    lines: toNBoxes(items, format, width, height),
  };
}

export interface ParsedRefinement {
  language?: string;
  corrections: Map<string, string>;
  missing: RawLine[];
}

export function parseRefinement(raw: string, format: BoxFormat, width: number, height: number): ParsedRefinement {
  const json = extractJson(raw) as Record<string, unknown>;
  const corrections = new Map<string, string>();
  for (const item of itemsOf(json.lines)) {
    if (typeof item.id === 'string' && typeof item.text === 'string') {
      corrections.set(item.id, item.text.trim());
    }
  }
  const missing = itemsOf(json.missing)
    .map((item) => ({ text: String(item.text ?? '').trim(), raw: rawBox(item) }))
    .filter((i): i is { text: string; raw: number[] } => !!i.text && !!i.raw);
  return {
    language: typeof json.language === 'string' ? json.language : undefined,
    corrections,
    missing: toNBoxes(missing, format, width, height),
  };
}

/** Splits a line box into word boxes, proportional to character counts. */
export function splitWords(text: string, box: NBox, conf: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const totalChars = words.reduce((n, w) => n + w.length, 0) + Math.max(0, words.length - 1);
  let cursor = 0;
  return words.map((word) => {
    const start = cursor / totalChars;
    cursor += word.length;
    const end = cursor / totalChars;
    cursor += 1;
    return {
      text: word,
      box: { x: box.x + start * box.w, y: box.y, w: (end - start) * box.w, h: box.h },
      conf,
    };
  });
}

export function linesFromRaw(raw: RawLine[], prefix: string, conf: number): OcrLine[] {
  return raw.map((line, i) => ({
    id: `${prefix}${i}`,
    text: line.text,
    box: line.box,
    // Model boxes hug the ink loosely; text this tall reads naturally inside them.
    size: line.box.h * 0.9,
    conf,
    words: splitWords(line.text, line.box, conf),
    approximate: true,
  }));
}

const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

/** Groups lines (already in reading order) into paragraphs. */
export function groupBlocks(lines: OcrLine[], prefix = 'b'): OcrBlock[] {
  const blocks: OcrBlock[] = [];
  let current: OcrLine[] = [];
  const flush = () => {
    if (!current.length) return;
    const x0 = Math.min(...current.map((l) => l.box.x));
    const y0 = Math.min(...current.map((l) => l.box.y));
    const x1 = Math.max(...current.map((l) => l.box.x + l.box.w));
    const y1 = Math.max(...current.map((l) => l.box.y + l.box.h));
    blocks.push({ id: `${prefix}${blocks.length}`, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, lines: current });
    current = [];
  };
  for (const line of lines) {
    const prev = current[current.length - 1];
    if (prev) {
      const h = (prev.box.h + line.box.h) / 2;
      const gap = line.box.y - (prev.box.y + prev.box.h);
      const sameSize = Math.max(prev.box.h, line.box.h) / Math.min(prev.box.h, line.box.h) < 1.6;
      const aligned =
        overlap(prev.box.x, prev.box.x + prev.box.w, line.box.x, line.box.x + line.box.w) > 0 ||
        Math.abs(prev.box.x - line.box.x) < h * 1.5;
      if (!(gap > -h * 0.4 && gap < h * 0.9 && sameSize && aligned)) flush();
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/** Parses "[id] translation" lines, keeping only ids that exist. */
export function parseTranslations(raw: string, knownIds: Iterable<string>): Map<string, string> {
  const known = new Set(knownIds);
  const out = new Map<string, string>();
  let last: string | null = null;
  for (const line of stripThinking(raw).split(/\r?\n/)) {
    const tagged = /^\s*\[([^\]]+)\]\s?(.*)$/.exec(line);
    if (tagged) {
      last = known.has(tagged[1]) ? tagged[1] : null;
      if (last) out.set(last, tagged[2].trim());
    } else if (last && line.trim()) {
      out.set(last, `${out.get(last)} ${line.trim()}`);
    }
  }
  return out;
}
