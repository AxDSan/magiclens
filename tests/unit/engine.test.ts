import { describe, expect, it } from 'vitest';
import { mergeRefinement } from '../../src/engine/hybrid';
import { readSse, stripThinking } from '../../src/engine/llm/sse';
import { convertTesseract } from '../../src/engine/ocr/tesseract';
import type { OcrBlock } from '../../src/shared/types';

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('readSse', () => {
  it('reassembles events split across network chunks', async () => {
    const events = [];
    for await (const event of readSse(streamOf(['data: {"a"', ':1}\r\n\r\nevent: x\ndata: two\n', 'data: lines\n\ndata: [DONE]']))) {
      events.push(event);
    }
    expect(events).toEqual([
      { event: undefined, data: '{"a":1}' },
      { event: 'x', data: 'two\nlines' },
      { event: undefined, data: '[DONE]' },
    ]);
  });

  it('strips unfinished think blocks while streaming', () => {
    expect(stripThinking('<think>planning')).toBe('');
    expect(stripThinking('<think>x</think>Answer')).toBe('Answer');
  });
});

// Shape of tesseract.js `blocks` output, as observed from v7.
const tessWord = (text: string, x0: number, x1: number, confidence = 95) => ({
  text,
  confidence,
  bbox: { x0, y0: 35, x1, y1: 62 },
});
const tessBlocks = [
  {
    paragraphs: [
      {
        bbox: { x0: 33, y0: 35, x1: 373, y1: 62 },
        lines: [
          {
            text: 'Hello world, typography!\n',
            confidence: 96,
            bbox: { x0: 33, y0: 35, x1: 373, y1: 62 },
            baseline: { x0: 33, y0: 56, x1: 373, y1: 56, has_baseline: true },
            rowAttributes: { rowHeight: 27, descenders: 6, ascenders: 6 },
            words: [tessWord('Hello', 33, 100), tessWord('world,', 111, 193), tessWord('|||', 196, 200, 20), tessWord('typography!', 206, 373)],
          },
        ],
      },
    ],
  },
];

describe('convertTesseract', () => {
  it('normalizes boxes, baseline and font size, and drops noise words', () => {
    const [block] = convertTesseract(tessBlocks, 700, 220);
    const [line] = block.lines;
    expect(line.text).toBe('Hello world, typography!');
    expect(line.words).toHaveLength(3);
    expect(line.box.x).toBeCloseTo(33 / 700);
    expect(line.baseline!.y).toBeCloseTo(56 / 220);
    expect(line.baseline!.angle).toBe(0);
    expect(line.size).toBeCloseTo(27 / 220);
  });
});

describe('mergeRefinement', () => {
  const blocks: OcrBlock[] = [
    {
      id: 'b0',
      box: { x: 0, y: 0, w: 1, h: 0.2 },
      lines: [
        {
          id: 'l0',
          text: 'He1lo wor1d',
          box: { x: 0, y: 0, w: 1, h: 0.1 },
          size: 0.1,
          conf: 0.6,
          words: [
            { text: 'He1lo', box: { x: 0, y: 0, w: 0.4, h: 0.1 }, conf: 0.6 },
            { text: 'wor1d', box: { x: 0.5, y: 0, w: 0.5, h: 0.1 }, conf: 0.6 },
          ],
        },
        { id: 'l1', text: '~~', box: { x: 0, y: 0.1, w: 0.2, h: 0.1 }, size: 0.1, conf: 0.3, words: [] },
      ],
    },
  ];

  it('keeps detector word boxes when the word count matches', () => {
    const merged = mergeRefinement(blocks, {
      corrections: new Map([
        ['l0', 'Hello world'],
        ['l1', ''],
      ]),
      missing: [],
    });
    expect(merged[0].lines).toHaveLength(1);
    expect(merged[0].lines[0].words.map((w) => [w.text, w.box.x])).toEqual([
      ['Hello', 0],
      ['world', 0.5],
    ]);
  });

  it('re-spreads words when the model splits them differently', () => {
    const merged = mergeRefinement(blocks, { corrections: new Map([['l0', 'Hello big world']]), missing: [] });
    const words = merged[0].lines[0].words;
    expect(words.map((w) => w.text)).toEqual(['Hello', 'big', 'world']);
    expect(words[2].box.x + words[2].box.w).toBeCloseTo(1);
  });

  it('adds lines the detector missed as approximate blocks', () => {
    const merged = mergeRefinement(blocks, {
      corrections: new Map(),
      missing: [{ text: 'Footer', box: { x: 0, y: 0.9, w: 0.3, h: 0.05 } }],
    });
    expect(merged).toHaveLength(2);
    expect(merged[1].lines[0].approximate).toBe(true);
  });
});
