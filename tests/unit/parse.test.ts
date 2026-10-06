import { describe, expect, it } from 'vitest';
import {
  extractJson,
  groupBlocks,
  linesFromRaw,
  parseOcrJson,
  parseRefinement,
  parseTranslations,
  splitWords,
  toNBoxes,
} from '../../src/engine/llm/parse';

describe('extractJson', () => {
  it('strips code fences and surrounding prose', () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```\nDone.')).toEqual({ a: 1 });
  });

  it('ignores <think> sections', () => {
    expect(extractJson('<think>{"wrong": true}</think>{"right": true}')).toEqual({ right: true });
  });

  it('repairs trailing commas', () => {
    expect(extractJson('{"lines": [1, 2,],}')).toEqual({ lines: [1, 2] });
  });

  it('recovers from output truncated by the token limit', () => {
    const truncated = '{"lines": [{"text": "one", "bbox": [10,20,300,40]}, {"text": "tw';
    expect(extractJson(truncated)).toEqual({ lines: [{ text: 'one', bbox: [10, 20, 300, 40] }, { text: 'tw' }] });
    // The cut-off line has no box yet, so OCR parsing keeps only complete lines.
    expect(parseOcrJson(truncated, 'xyxy1000', 100, 100).lines.map((l) => l.text)).toEqual(['one']);
  });

  it('keeps brackets inside strings intact', () => {
    expect(extractJson('{"text": "a ] b } c"}')).toEqual({ text: 'a ] b } c' });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('I cannot see any text.')).toThrow();
  });
});

const near = (box: { x: number; y: number; w: number; h: number }) => ({
  x: expect.closeTo(box.x, 6),
  y: expect.closeTo(box.y, 6),
  w: expect.closeTo(box.w, 6),
  h: expect.closeTo(box.h, 6),
});

describe('toNBoxes', () => {
  const item = (raw: number[]) => [{ text: 't', raw }];

  it('reads Gemini box_2d (y, x on 0-1000)', () => {
    const [line] = toNBoxes(item([100, 200, 300, 600]), 'yxyx1000', 800, 600);
    expect(line.box).toEqual(near({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 }));
  });

  it('reads x0,y0,x1,y1 on 0-1000', () => {
    const [line] = toNBoxes(item([200, 100, 600, 300]), 'xyxy1000', 800, 600);
    expect(line.box).toEqual(near({ x: 0.2, y: 0.1, w: 0.4, h: 0.2 }));
  });

  it('reads pixel boxes', () => {
    const [line] = toNBoxes(item([160, 60, 480, 180]), 'pixels', 800, 600);
    expect(line.box.x).toBeCloseTo(0.2);
    expect(line.box.h).toBeCloseTo(0.2);
  });

  it('detects 0-1 floats whatever the declared format', () => {
    const [line] = toNBoxes(item([0.2, 0.1, 0.6, 0.3]), 'xyxy1000', 800, 600);
    expect(line.box.x).toBeCloseTo(0.2);
    expect(line.box.w).toBeCloseTo(0.4);
  });

  it('detects a 0-1000 grid when pixels were requested from a small image', () => {
    const [line] = toNBoxes(item([200, 100, 900, 300]), 'pixels', 400, 300);
    expect(line.box.x).toBeCloseTo(0.2);
  });

  it('fixes swapped corners and drops degenerate boxes', () => {
    const lines = toNBoxes(
      [
        { text: 'a', raw: [600, 300, 200, 100] },
        { text: 'b', raw: [100, 100, 100, 100] },
      ],
      'xyxy1000',
      800,
      600,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].box.x).toBeCloseTo(0.2);
  });
});

describe('parseOcrJson', () => {
  it('accepts several shapes models produce', () => {
    const raw = JSON.stringify([
      { text: 'Hello', bbox: [0, 0, 500, 100] },
      { content: 'World', box: { x: 0, y: 200, width: 500, height: 100 } },
      { text: 'Quad', bounding_box: [[0, 400], [500, 400], [500, 500], [0, 500]] },
      { text: 'no box' },
    ]);
    const parsed = parseOcrJson(raw, 'xyxy1000', 100, 100);
    expect(parsed.lines.map((l) => l.text)).toEqual(['Hello', 'World', 'Quad']);
    expect(parsed.lines[1].box.y).toBeCloseTo(0.2);
  });
});

describe('parseRefinement', () => {
  it('maps corrections by id and converts missing boxes', () => {
    const raw = '{"language":"en","lines":[{"id":"l0","text":"Hello"},{"id":"l1","text":""}],"missing":[{"text":"New","bbox":[0,500,250,600]}]}';
    const parsed = parseRefinement(raw, 'xyxy1000', 100, 100);
    expect(parsed.corrections.get('l0')).toBe('Hello');
    expect(parsed.corrections.get('l1')).toBe('');
    expect(parsed.missing[0].box).toEqual(near({ x: 0, y: 0.5, w: 0.25, h: 0.1 }));
  });
});

describe('parseTranslations', () => {
  it('keeps only known ids and joins wrapped lines', () => {
    const raw = '[b0] Hola\n[b1] Una frase\nque continúa\n[id] stray example\n[b9] unknown';
    const parsed = parseTranslations(raw, ['b0', 'b1']);
    expect(Object.fromEntries(parsed)).toEqual({ b0: 'Hola', b1: 'Una frase que continúa' });
  });
});

describe('words and blocks', () => {
  it('splits a line proportionally to characters', () => {
    const words = splitWords('ab cd', { x: 0, y: 0, w: 1, h: 0.1 }, 1);
    expect(words.map((w) => w.text)).toEqual(['ab', 'cd']);
    expect(words[0].box.w).toBeCloseTo(0.4);
    expect(words[1].box.x).toBeCloseTo(0.6);
  });

  it('groups nearby aligned lines into paragraphs', () => {
    const lines = linesFromRaw(
      [
        { text: 'Title', box: { x: 0.1, y: 0.05, w: 0.5, h: 0.08 } },
        { text: 'Body one', box: { x: 0.1, y: 0.3, w: 0.6, h: 0.04 } },
        { text: 'Body two', box: { x: 0.1, y: 0.35, w: 0.55, h: 0.04 } },
      ],
      'l',
      1,
    );
    const blocks = groupBlocks(lines);
    expect(blocks.map((b) => b.lines.map((l) => l.text))).toEqual([['Title'], ['Body one', 'Body two']]);
  });
});
