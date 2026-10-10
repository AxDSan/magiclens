import { describe, expect, it } from 'vitest';
import { buildCharset, decodeCtc } from '../../src/engine/ocr/paddle-decode';
import {
  detectionSize,
  findTextBoxes,
  groupIntoBlocks,
  toImageBox,
  unclipBox,
} from '../../src/engine/ocr/paddle-geometry';

describe('detectionSize', () => {
  it('caps the longest side at 960 and keeps the aspect ratio', () => {
    expect(detectionSize(1000, 500)).toEqual({ width: 960, height: 480 });
  });

  it('snaps each side to a multiple of 32 with a 32 minimum', () => {
    expect(detectionSize(100, 50)).toEqual({ width: 96, height: 64 });
    expect(detectionSize(10, 10)).toEqual({ width: 32, height: 32 });
  });
});

describe('findTextBoxes', () => {
  // A 6x4 probability map, row-major.
  const map = (cells: Array<[x: number, y: number, p: number]>) => {
    const prob = new Float32Array(6 * 4);
    for (const [x, y, p] of cells) prob[y * 6 + x] = p;
    return prob;
  };

  it('returns the bounding box of a confident 4-connected region', () => {
    const cells: Array<[number, number, number]> = [];
    for (let y = 1; y < 3; y++) for (let x = 1; x < 4; x++) cells.push([x, y, 0.9]);
    expect(findTextBoxes(map(cells), 6, 4)).toEqual([{ x0: 1, y0: 1, x1: 4, y1: 3 }]);
  });

  it('drops regions whose mean probability is below the box score', () => {
    const cells: Array<[number, number, number]> = [];
    for (let x = 0; x < 4; x++) cells.push([x, 0, 0.5]);
    expect(findTextBoxes(map(cells), 6, 4)).toEqual([]);
  });

  it('drops regions smaller than the minimum pixel count', () => {
    expect(findTextBoxes(map([[0, 0, 0.9], [1, 0, 0.9], [2, 0, 0.9]]), 6, 4)).toEqual([]);
  });

  it('keeps separate regions apart', () => {
    const cells: Array<[number, number, number]> = [];
    for (let x = 0; x < 2; x++) cells.push([x, 0, 0.9], [x, 1, 0.9]);
    for (let x = 4; x < 6; x++) cells.push([x, 3, 0.9], [x, 2, 0.9]);
    expect(findTextBoxes(map(cells), 6, 4)).toEqual([
      { x0: 0, y0: 0, x1: 2, y1: 2 },
      { x0: 4, y0: 2, x1: 6, y1: 4 },
    ]);
  });
});

describe('unclipBox', () => {
  it('expands by area * ratio / perimeter on each side', () => {
    // 10x10: d = 100 * 1.5 / (2 * 20) = 3.75
    expect(unclipBox({ x0: 10, y0: 10, x1: 20, y1: 20 })).toEqual({
      x0: 6.25,
      y0: 6.25,
      x1: 23.75,
      y1: 23.75,
    });
  });
});

describe('toImageBox', () => {
  it('scales from detector space to image pixels', () => {
    const box = toImageBox(
      { x0: 10, y0: 5, x1: 100, y1: 50 },
      { width: 960, height: 480 },
      1920,
      960,
    );
    expect(box).toEqual({ x0: 20, y0: 10, x1: 200, y1: 100 });
  });

  it('clamps to the image', () => {
    const box = toImageBox(
      { x0: -5, y0: 0, x1: 1000, y1: 480 },
      { width: 960, height: 480 },
      1920,
      960,
    );
    expect(box).toEqual({ x0: 0, y0: 0, x1: 1920, y1: 960 });
  });
});

describe('groupIntoBlocks', () => {
  it('joins stacked, horizontally overlapping lines and splits the rest', () => {
    const lines = [
      { x0: 0, y0: 0, x1: 100, y1: 10 },
      { x0: 0, y0: 12, x1: 100, y1: 22 }, // 2px below, shares x: joins block 0
      { x0: 0, y0: 100, x1: 100, y1: 110 }, // far below: new block
      { x0: 200, y0: 12, x1: 300, y1: 22 }, // beside line 1 with no x overlap: new block
    ];
    expect(groupIntoBlocks(lines)).toEqual([[0, 1], [2], [3]]);
  });
});

describe('buildCharset', () => {
  it('puts the CTC blank first and the word-separator space last, dropping empty lines', () => {
    expect(buildCharset('a\n\nb\n')).toEqual(['', 'a', 'b', ' ']);
  });
});

describe('decodeCtc', () => {
  const charset = ['', 'a', 'b', ' '];
  const CLASSES = charset.length;

  // Each frame is [argmax class, its probability]; the other classes sit at a low floor.
  const logitsFrom = (frames: Array<[number, number]>) => {
    const out = new Float32Array(frames.length * CLASSES).fill(0.01);
    frames.forEach(([index, prob], t) => {
      out[t * CLASSES + index] = prob;
    });
    return out;
  };
  const decode = (frames: Array<[number, number]>) =>
    decodeCtc(logitsFrom(frames), frames.length, CLASSES, charset);

  it('keeps a double letter when a blank separates the two runs', () => {
    const line = decode([[1, 0.9], [0, 0.9], [1, 0.9]]);
    expect(line.text).toBe('aa');
    expect(line.words[0]).toMatchObject({ t0: 0, t1: 3 });
  });

  it('collapses consecutive identical frames into one character', () => {
    expect(decode([[1, 0.9], [1, 0.9], [2, 0.9]]).text).toBe('ab');
  });

  it('splits words at space classes and ignores leading and repeated spaces', () => {
    const line = decode([[3, 0.9], [1, 0.9], [0, 0.9], [3, 0.9], [3, 0.9], [2, 0.9], [3, 0.9]]);
    expect(line.text).toBe('a b');
    expect(line.words.map((w) => [w.text, w.t0, w.t1])).toEqual([
      ['a', 1, 2],
      ['b', 5, 6],
    ]);
  });

  it('averages a character confidence over the timesteps of its run', () => {
    const line = decode([[1, 0.9], [1, 0.7], [0, 0.8]]);
    expect(line.words[0].conf).toBeCloseTo(0.8);
    expect(line.conf).toBeCloseTo(0.8);
  });

  it('returns no text when every frame is blank', () => {
    expect(decode([[0, 0.9], [0, 0.9]])).toEqual({ text: '', conf: 0, words: [] });
  });
});
