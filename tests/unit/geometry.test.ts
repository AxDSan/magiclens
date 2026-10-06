import { describe, expect, it } from 'vitest';
import { intersect, objectFitRect, parseObjectPosition } from '../../src/content/geometry';

describe('objectFitRect', () => {
  const box = { w: 400, h: 300 };

  it('fill stretches to the content box', () => {
    expect(objectFitRect('fill', '50% 50%', box.w, box.h, 800, 200)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('contain letterboxes and centers', () => {
    // 800x200 into 400x300: scale 0.5 -> 400x100, centered vertically.
    expect(objectFitRect('contain', '50% 50%', box.w, box.h, 800, 200)).toEqual({ x: 0, y: 100, w: 400, h: 100 });
  });

  it('cover crops and honors object-position percentages', () => {
    // 800x200 into 400x300: scale 1.5 -> 1200x300, free x = -800, 20% -> -160.
    const r = objectFitRect('cover', '20% 50%', box.w, box.h, 800, 200);
    expect(r).toEqual({ x: -160, y: 0, w: 1200, h: 300 });
  });

  it('none keeps the natural size and applies pixel offsets', () => {
    expect(objectFitRect('none', '10px 20px', box.w, box.h, 100, 50)).toEqual({ x: 10, y: 20, w: 100, h: 50 });
  });

  it('scale-down never enlarges', () => {
    expect(objectFitRect('scale-down', '0% 0%', box.w, box.h, 100, 50)).toEqual({ x: 0, y: 0, w: 100, h: 50 });
    expect(objectFitRect('scale-down', '0% 0%', box.w, box.h, 800, 600)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  it('edge-offset syntax measures from the far edges', () => {
    // contain: 200x100 into 400x300 -> scale 2 -> 400x200, free y = 100.
    const r = objectFitRect('contain', 'right 0px bottom 10px', box.w, box.h, 200, 100);
    expect(r).toEqual({ x: 0, y: 90, w: 400, h: 200 });
  });

  it('scales pixel offsets with CSS transforms', () => {
    expect(objectFitRect('none', '10px 0px', 400, 300, 100, 50, 2)).toEqual({ x: 20, y: 0, w: 200, h: 100 });
  });
});

describe('parseObjectPosition', () => {
  it('reads keywords in either order', () => {
    const [x, y] = parseObjectPosition('top right');
    expect(x.pct).toBe(1);
    expect(y.pct).toBe(0);
  });

  it('reads calc() values', () => {
    const [x] = parseObjectPosition('calc(50% + 10px) 0%');
    expect(x.pct).toBeCloseTo(0.5);
    expect(x.px).toBe(10);
  });

  it('defaults to center', () => {
    const [x, y] = parseObjectPosition('');
    expect([x.pct, y.pct]).toEqual([0.5, 0.5]);
  });
});

describe('intersect', () => {
  it('returns the overlap or null', () => {
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 })).toBeNull();
  });
});
