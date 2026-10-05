import type { OcrLine, OcrResult } from '../../shared/types';
import { clamp } from '../../shared/util';

export const TEXT_FONT = 'Arial, "Liberation Sans", "Helvetica Neue", Helvetica, sans-serif';

interface FontMetrics {
  /** Font ascent/descent as a fraction of the font size. */
  ascent: number;
  descent: number;
  /** Ink height (ascender top to descender bottom) as a fraction of the font size. */
  ink: number;
  /** Advance width of `text` at a 1px font size. */
  width(text: string): number;
}

let metrics: FontMetrics | null = null;

/** Measures the overlay font once, so spans can be sized to match the image's glyphs. */
export function fontMetrics(): FontMetrics {
  if (metrics) return metrics;
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `100px ${TEXT_FONT}`;
  const sample = ctx.measureText('Hxgjpqy');
  const ascent = (sample.fontBoundingBoxAscent || 90.5) / 100;
  const descent = (sample.fontBoundingBoxDescent || 21.2) / 100;
  const tall = ctx.measureText('Hdklb').actualBoundingBoxAscent;
  const deep = ctx.measureText('gjpqy').actualBoundingBoxDescent;
  const ink = tall && deep ? (tall + deep) / 100 : 0.93;
  const cache = new Map<string, number>();
  metrics = {
    ascent,
    descent,
    ink,
    width(text) {
      let w = cache.get(text);
      if (w === undefined) {
        w = ctx.measureText(text).width / 100;
        if (cache.size > 4000) cache.clear();
        cache.set(text, w);
      }
      return w;
    },
  };
  return metrics;
}

export interface WordRef {
  span: HTMLSpanElement;
  text: string;
  line: number;
  block: number;
}

export interface TextLayer {
  highlights: DocumentFragment;
  backgrounds: DocumentFragment;
  text: DocumentFragment;
  words: WordRef[];
}

const f = (n: number) => +n.toFixed(5);

/** Inline style for a box given as fractions of the frame. */
function boxStyle(x: number, y: number, w: number, h: number, pad = 0) {
  return (
    `left:calc(var(--fw)*${f(x)}px - ${pad}px);top:calc(var(--fh)*${f(y)}px - ${pad}px);` +
    `width:calc(var(--fw)*${f(w)}px + ${pad * 2}px);height:calc(var(--fh)*${f(h)}px + ${pad * 2}px)`
  );
}

/**
 * Builds the selectable text layer. Every length is a multiple of the CSS variables
 * --fw/--fh (frame size in px), so resizing the overlay only updates three variables and
 * keeps any selection and running animation intact.
 */
export function buildTextLayer(result: OcrResult): TextLayer {
  const m = fontMetrics();
  const aspect = result.width / result.height;
  const highlights = document.createDocumentFragment();
  const backgrounds = document.createDocumentFragment();
  const text = document.createDocumentFragment();
  const words: WordRef[] = [];
  const allWords = result.blocks.reduce((n, b) => n + b.lines.reduce((k, l) => k + l.words.length, 0), 0);
  const lineHighlights = allWords > 400;
  let lineIndex = 0;

  const waveDelay = (cx: number, cy: number) =>
    `${Math.round(clamp(cx * 0.5 + cy * 0.5, 0, 1) * 560 + Math.random() * 40)}ms`;

  const addHighlight = (line: OcrLine, x: number, y: number, w: number, h: number) => {
    const hl = document.createElement('div');
    hl.className = line.approximate ? 'hl approx' : 'hl';
    hl.style.cssText = `${boxStyle(x, y, w, h, 1.5)};--d:${waveDelay(x + w / 2, y + h / 2)}`;
    highlights.appendChild(hl);
  };

  result.blocks.forEach((block, blockIndex) => {
    for (const line of block.lines) {
      const thisLine = lineIndex++;
      // Font size as a fraction of frame height.
      const font = Math.max(line.size, 0.004) / m.ink;
      const angle = line.baseline && Math.abs(line.baseline.angle) > 0.012 ? line.baseline.angle : 0;
      const tan = Math.tan(angle);

      const bg = document.createElement('div');
      bg.className = 'lbg';
      bg.style.cssText = `${boxStyle(line.box.x, line.box.y, line.box.w, line.box.h, 2)};--bg:${line.bg ?? '#fff'}`;
      backgrounds.appendChild(bg);
      if (lineHighlights) addHighlight(line, line.box.x, line.box.y, line.box.w, line.box.h);

      // Positions a span so its baseline sits on the detected baseline and its width
      // covers [x, x + w]; scaleX is multiplied by the frame aspect (--ar) in CSS because
      // widths scale with --fw while fonts scale with --fh.
      const place = (span: HTMLSpanElement, content: string, x: number, w: number, y: number, h: number) => {
        let top: number;
        if (line.baseline) {
          const dx = (x - line.box.x) * aspect;
          top = line.baseline.y + dx * tan - m.ascent * font;
        } else {
          top = y + h / 2 - ((m.ascent + m.descent) * font) / 2;
        }
        const natural = m.width(content) * font;
        const stretch = clamp(natural > 0 ? w / Math.cos(angle) / natural : 1, 0.05, 20);
        span.textContent = content;
        span.style.cssText =
          `left:calc(var(--fw)*${f(x)}px);top:calc(var(--fh)*${f(top)}px);` +
          `font-size:calc(var(--fh)*${f(font)}px);--lh:${f(m.ascent + m.descent)};` +
          `--fg:${line.fg ?? '#111'};` +
          (angle
            ? `transform-origin:0 calc(var(--fh)*${f(m.ascent * font)}px);transform:rotate(${f(angle)}rad) scaleX(calc(${f(stretch)}*var(--ar)))`
            : `transform:scaleX(calc(${f(stretch)}*var(--ar)))`);
        text.appendChild(span);
      };

      const lineWords = line.words.filter((word) => word.text);
      lineWords.forEach((word, i) => {
        const span = document.createElement('span');
        span.className = 'w';
        place(span, word.text, word.box.x, word.box.w, word.box.y, word.box.h);
        words.push({ span, text: word.text, line: thisLine, block: blockIndex });
        if (!lineHighlights) addHighlight(line, word.box.x, word.box.y, word.box.w, word.box.h);
        // A stretched space between words keeps the selection highlight continuous.
        const next = lineWords[i + 1];
        const gap = next ? next.box.x - (word.box.x + word.box.w) : 0;
        if (next && gap > 0) {
          const spacer = document.createElement('span');
          spacer.className = 'g';
          place(spacer, ' ', word.box.x + word.box.w, gap, word.box.y, word.box.h);
        }
      });
    }
  });
  return { highlights, backgrounds, text, words };
}

/** Plain text of the part of the layer covered by `range`, with real spaces and newlines. */
export function serializeRange(range: Range, words: WordRef[]): string {
  let out = '';
  let previous: WordRef | null = null;
  for (const word of words) {
    const node = word.span.firstChild;
    if (!node || !range.intersectsNode(node)) continue;
    let piece = word.text;
    let start = 0;
    let end = piece.length;
    if (range.startContainer === node) start = range.startOffset;
    else if (range.startContainer === word.span && range.startOffset > 0) start = end;
    if (range.endContainer === node) end = range.endOffset;
    else if (range.endContainer === word.span && range.endOffset === 0) end = 0;
    piece = piece.slice(start, Math.max(start, end));
    if (!piece) continue;
    if (previous) {
      out += previous.block !== word.block ? '\n\n' : previous.line !== word.line ? '\n' : ' ';
    }
    out += piece;
    previous = word;
  }
  return out;
}

/** The current selection as a Range, if it lies inside `shadow`. */
export function selectionRangeIn(shadow: ShadowRoot): Range | null {
  const selection = document.getSelection();
  const toRange = (s: AbstractRange) => {
    const range = document.createRange();
    range.setStart(s.startContainer, s.startOffset);
    range.setEnd(s.endContainer, s.endOffset);
    return range;
  };
  const inside = (r: AbstractRange) => shadow.contains(r.startContainer) || shadow.contains(r.endContainer);
  type Composed = Selection & {
    getComposedRanges?: (options?: unknown, ...more: unknown[]) => StaticRange[];
  };
  const composed = selection as Composed | null;
  if (composed?.getComposedRanges) {
    for (const call of [() => composed.getComposedRanges!({ shadowRoots: [shadow] }), () => composed.getComposedRanges!(shadow)]) {
      try {
        const ranges = call();
        if (ranges.length && !ranges[0].collapsed && inside(ranges[0])) return toRange(ranges[0]);
      } catch {
        // Older signature; try the next form.
      }
    }
  }
  const legacy = (shadow as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.();
  if (legacy && legacy.rangeCount && !legacy.isCollapsed) {
    const range = legacy.getRangeAt(0);
    if (inside(range)) return range;
  }
  if (selection && selection.rangeCount && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    if (inside(range)) return range;
  }
  return null;
}
