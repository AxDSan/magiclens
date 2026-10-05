import type { Rect } from '../shared/types';

export type ObjectFit = 'fill' | 'contain' | 'cover' | 'none' | 'scale-down';

interface Axis {
  /** Fraction of the free space (0..1), applied from `edge`. */
  pct: number;
  px: number;
  fromEnd: boolean;
}

const KEYWORD_PCT: Record<string, number> = {
  left: 0,
  top: 0,
  center: 0.5,
  right: 1,
  bottom: 1,
};

function parseOffset(token: string): { pct: number; px: number } | null {
  if (token in KEYWORD_PCT) return { pct: KEYWORD_PCT[token], px: 0 };
  if (token.endsWith('%')) return { pct: parseFloat(token) / 100, px: 0 };
  if (token.endsWith('px')) return { pct: 0, px: parseFloat(token) };
  if (token.startsWith('calc(')) {
    const pct = /(-?[\d.]+)%/.exec(token);
    const px = /([+-]?\s*[\d.]+)px/.exec(token);
    return {
      pct: pct ? parseFloat(pct[1]) / 100 : 0,
      px: px ? parseFloat(px[1].replace(/\s/g, '')) : 0,
    };
  }
  const n = parseFloat(token);
  return Number.isFinite(n) ? { pct: 0, px: n } : null;
}

/** Parses a computed `object-position` (2-value, or 4-value edge-offset syntax). */
export function parseObjectPosition(value: string): [Axis, Axis] {
  const tokens: string[] = (value || '50% 50%').match(/calc\([^)]*\)|\S+/g) ?? [];
  const center: Axis = { pct: 0.5, px: 0, fromEnd: false };
  if (tokens.length === 4) {
    const axes: Axis[] = [];
    for (let i = 0; i < 4; i += 2) {
      const edge = tokens[i];
      const offset = parseOffset(tokens[i + 1]) ?? { pct: 0, px: 0 };
      axes.push({ ...offset, fromEnd: edge === 'right' || edge === 'bottom' });
    }
    const xFirst = tokens[0] === 'left' || tokens[0] === 'right';
    return xFirst ? [axes[0], axes[1]] : [axes[1], axes[0]];
  }
  if (tokens.length >= 2) {
    // Keyword pairs may come in either order ("top left").
    let [a, b] = tokens;
    if (a === 'top' || a === 'bottom' || b === 'left' || b === 'right') [a, b] = [b, a];
    const x = parseOffset(a) ?? { pct: 0.5, px: 0 };
    const y = parseOffset(b) ?? { pct: 0.5, px: 0 };
    return [
      { ...x, fromEnd: false },
      { ...y, fromEnd: false },
    ];
  }
  if (tokens.length === 1) {
    const single = parseOffset(tokens[0]) ?? { pct: 0.5, px: 0 };
    const vertical = tokens[0] === 'top' || tokens[0] === 'bottom';
    return vertical
      ? [center, { ...single, fromEnd: false }]
      : [{ ...single, fromEnd: false }, center];
  }
  return [center, center];
}

/**
 * Where a replaced element's intrinsic image is drawn inside its content box, following
 * the CSS `object-fit` / `object-position` rules. Result is relative to the content box.
 */
export function objectFitRect(
  fit: string,
  position: string,
  boxW: number,
  boxH: number,
  naturalW: number,
  naturalH: number,
  pxScale = 1,
): Rect {
  if (!naturalW || !naturalH || !boxW || !boxH) return { x: 0, y: 0, w: boxW, h: boxH };
  let w = boxW;
  let h = boxH;
  const contain = Math.min(boxW / naturalW, boxH / naturalH);
  const cover = Math.max(boxW / naturalW, boxH / naturalH);
  switch (fit as ObjectFit) {
    case 'contain':
      w = naturalW * contain;
      h = naturalH * contain;
      break;
    case 'cover':
      w = naturalW * cover;
      h = naturalH * cover;
      break;
    case 'none':
      w = naturalW * pxScale;
      h = naturalH * pxScale;
      break;
    case 'scale-down': {
      const s = Math.min(pxScale, contain);
      w = naturalW * s;
      h = naturalH * s;
      break;
    }
    default:
      return { x: 0, y: 0, w: boxW, h: boxH };
  }
  const [ax, ay] = parseObjectPosition(position);
  const place = (axis: Axis, free: number) => {
    const offset = free * axis.pct + axis.px * pxScale;
    return axis.fromEnd ? free - offset : offset;
  };
  return { x: place(ax, boxW - w), y: place(ay, boxH - h), w, h };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return r > x && bottom > y ? { x, y, w: r - x, h: bottom - y } : null;
}

export const toRect = (r: DOMRect | DOMRectReadOnly): Rect => ({
  x: r.left,
  y: r.top,
  w: r.width,
  h: r.height,
});

export interface BoxModel {
  /** Border box in viewport coordinates. */
  rect: Rect;
  /** Content box relative to the border box (already scaled by CSS transforms). */
  content: Rect;
  /** CSS-px to screen-px scale from transforms. */
  scale: number;
  radius: string;
  style: CSSStyleDeclaration;
}

export function boxModel(el: Element): BoxModel {
  const rect = toRect(el.getBoundingClientRect());
  const style = getComputedStyle(el);
  const layoutWidth = (el as HTMLElement).offsetWidth || rect.w;
  const scale = layoutWidth ? rect.w / layoutWidth : 1;
  const px = (v: string) => (parseFloat(v) || 0) * scale;
  const left = px(style.borderLeftWidth) + px(style.paddingLeft);
  const top = px(style.borderTopWidth) + px(style.paddingTop);
  const right = px(style.borderRightWidth) + px(style.paddingRight);
  const bottom = px(style.borderBottomWidth) + px(style.paddingBottom);
  return {
    rect,
    content: {
      x: left,
      y: top,
      w: Math.max(0, rect.w - left - right),
      h: Math.max(0, rect.h - top - bottom),
    },
    scale,
    radius: style.borderRadius,
    style,
  };
}

/** Elements whose overflow clips the target (carousels, scroll boxes). */
export function clippingAncestors(el: Element): Element[] {
  const out: Element[] = [];
  let node = el.parentElement;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible' || style.contain.includes('paint')) {
      out.push(node);
    }
    if (style.position === 'fixed') break;
    node = node.parentElement;
  }
  return out;
}

/** True when the element is inside something that does not scroll with the document. */
export function isFixedContext(el: Element): boolean {
  let node: Element | null = el;
  while (node && node !== document.documentElement) {
    const position = getComputedStyle(node).position;
    if (position === 'fixed' || position === 'sticky') return true;
    node = node.parentElement;
  }
  return false;
}

export function viewportRect(): Rect {
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}

/** The part of the element actually visible on screen, in viewport coordinates. */
export function visibleRect(el: Element, ancestors = clippingAncestors(el)): Rect | null {
  let visible: Rect | null = toRect(el.getBoundingClientRect());
  for (const ancestor of ancestors) {
    if (!visible) return null;
    visible = intersect(visible, toRect(ancestor.getBoundingClientRect()));
  }
  return visible ? intersect(visible, viewportRect()) : null;
}
