import type { OcrResult, ProgressInfo, Rect } from '../../shared/types';
import { clamp } from '../../shared/util';
import { clippingAncestors, intersect, isFixedContext, toRect, viewportRect } from '../geometry';
import type { FrameMap, Mapper } from '../targets';
import { Panel, type PanelActions } from './panel';
import { buildTextLayer, fontMetrics, type WordRef } from './textlayer';

export type OverlayState = 'scan' | 'refine' | 'ready' | 'error';

const MIN_SCAN_MS = 900;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: Element) => {
  const node = document.createElement(tag);
  node.className = className;
  parent?.appendChild(node);
  return node;
};

/**
 * Everything MagicLens draws over one element: the processing effects, the selectable text
 * layer, translations and the action panel. Positioned every frame by the UI root.
 */
export class Overlay {
  readonly el = el('div', 'ov');
  state: OverlayState = 'scan';
  result: OcrResult | null = null;
  image: string | null = null;
  words: WordRef[] = [];
  panel: Panel | null = null;
  showText = false;
  translations: Record<string, string> | null = null;
  onClose: (() => void) | null = null;

  private clip = el('div', 'clip', this.el);
  private fx = el('div', 'fx', this.clip);
  private frame = el('div', 'frame', this.clip);
  private hls = el('div', 'hls', this.frame);
  private bgs = el('div', 'bgs', this.frame);
  private trs = el('div', 'trs', this.frame);
  private txt = el('div', 'txt', this.frame);
  private bloomWrap = el('div', 'bloom-wrap', this.el);
  private bloom = el('div', 'bloom', this.bloomWrap);
  private ring = el('div', 'ring', this.el);
  private status = el('div', 'status', this.el);
  private label = el('span', 'label');
  private pct = el('span', 'pct');
  private progressBar = el('div', 'progress');
  private startedAt = performance.now();
  private presentChain: Promise<void> = Promise.resolve();
  private fixed: boolean;
  private ancestors: Element[];
  private map: FrameMap | null = null;
  private mapKey = '';
  private lastKey = '';
  private frameCount = 0;
  private closed = false;
  private visibleClip: Rect | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(
    readonly target: Element,
    public mapper: Mapper,
    private panelActions: PanelActions,
    private aiReady: boolean,
  ) {
    // Under the effects: the veil that dims the image. Above everything: the reveal flash.
    this.clip.prepend(el('div', 'veil'));
    el('div', 'flash', this.clip);
    this.fixed = isFixedContext(target);
    this.ancestors = clippingAncestors(target);
    this.el.classList.toggle('fixed', this.fixed);
    this.el.dataset.state = 'scan';
    this.txt.setAttribute('role', 'document');
    this.txt.setAttribute('aria-label', 'Text recognized in the image');

    // Effects: inner aurora edge, light beam, sparkles.
    const edge = el('div', 'edge', this.fx);
    el('div', 'spin', edge);
    el('div', 'beam', this.fx);
    this.spawnSparks(el('div', 'sparks', this.fx));
    el('div', 'spin', this.ring);
    el('div', 'spin', this.bloom);

    const orb = el('span', 'orb');
    this.progressBar.append(document.createElement('i'));
    this.status.append(orb, this.label, this.pct, this.progressBar);
    this.label.textContent = 'Reading';
  }

  private spawnSparks(container: HTMLElement) {
    const rect = this.target.getBoundingClientRect();
    const count = Math.round(clamp((rect.width * rect.height) / 7000, 10, 36));
    const small = Math.min(rect.width, rect.height) < 160;
    for (let i = 0; i < count; i++) {
      const spark = el('i', 'spark', container);
      const size = (small ? 3 : 4) + Math.random() * (small ? 3 : 5);
      const drift = (small ? 14 : 34) * (0.4 + Math.random());
      const angle = Math.random() * Math.PI * 2;
      spark.style.cssText =
        `--x:${(4 + Math.random() * 92).toFixed(1)}%;--y:${(4 + Math.random() * 92).toFixed(1)}%;` +
        `--s:${size.toFixed(1)}px;--t:${(1.7 + Math.random() * 1.9).toFixed(2)}s;` +
        `--delay:${(-Math.random() * 3.4).toFixed(2)}s;` +
        `--dx:${(Math.cos(angle) * drift).toFixed(1)}px;--dy:${(Math.sin(angle) * drift).toFixed(1)}px`;
    }
  }

  get isClosed() {
    return this.closed;
  }

  private setState(state: OverlayState) {
    this.state = state;
    this.el.dataset.state = state;
  }

  setLabel(text: string) {
    if (this.label.textContent === text) return;
    this.label.textContent = text;
    this.label.classList.remove('swap');
    void this.label.offsetWidth;
    this.label.classList.add('swap');
  }

  progress(info: ProgressInfo) {
    this.setLabel(info.label);
    const determinate = info.progress !== undefined && info.stage === 'recognize';
    this.pct.textContent = determinate ? `${Math.round(info.progress! * 100)}%` : '';
    this.progressBar.classList.toggle('on', determinate);
    if (determinate) this.progressBar.style.setProperty('--p', String(info.progress));
  }

  /**
   * Shows a result, but never before the scan animation has had a moment to play: a read
   * that finishes in 200ms should still feel like a deliberate reveal, not a flicker.
   */
  present(result: OcrResult, final: boolean, image?: string) {
    this.presentChain = this.presentChain.then(async () => {
      const wait = MIN_SCAN_MS - (performance.now() - this.startedAt);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (!this.closed) this.show(result, final, image);
    });
  }

  /** Draws a result. `final` false = local OCR shown while the AI refines it. */
  private show(result: OcrResult, final: boolean, image?: string) {
    this.result = result;
    if (image) this.image = image;
    const layer = buildTextLayer(result);
    const firstReveal = !this.words.length;
    this.hls.replaceChildren(layer.highlights);
    this.bgs.replaceChildren(layer.backgrounds);
    this.txt.replaceChildren(layer.text);
    this.words = layer.words;
    this.el.style.setProperty('--lh', String(fontMetrics().ascent + fontMetrics().descent));
    if (!firstReveal) this.el.toggleAttribute('data-revealed', true);

    if (!final) {
      this.setState('refine');
      return;
    }
    if (!result.blocks.length) {
      this.setState('error');
      this.setLabel('No text found in this image');
      this.pct.textContent = '';
      this.later(() => this.close(), 2400);
      return;
    }
    this.setState('ready');
    this.later(() => this.el.toggleAttribute('data-revealed', true), 1400);
    this.ensurePanel();
    this.panel!.setMeta(this.describe(result));
  }

  private describe(result: OcrResult) {
    const lines = result.blocks.reduce((n, b) => n + b.lines.length, 0);
    const engine = result.engine === 'local' ? 'Local OCR' : result.model;
    return `${lines} line${lines === 1 ? '' : 's'} · ${engine}`;
  }

  ensurePanel() {
    if (this.panel) return this.panel;
    this.panel = new Panel(this.panelActions, this.aiReady);
    this.el.parentElement?.appendChild(this.panel.el);
    return this.panel;
  }

  fail(message: string, retry?: () => void) {
    this.setState('error');
    this.setLabel(message);
    this.pct.textContent = '';
    this.progressBar.classList.remove('on');
    if (retry) {
      const again = document.createElement('button');
      again.textContent = 'Retry';
      again.addEventListener('click', () => {
        again.remove();
        retry();
      });
      this.status.append(again);
    }
    this.later(() => this.close(), retry ? 9000 : 5000);
  }

  restart() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.startedAt = performance.now();
    this.setState('scan');
    this.setLabel('Reading');
  }

  toggleShowText(): boolean {
    this.showText = !this.showText;
    this.el.toggleAttribute('data-show', this.showText);
    return this.showText;
  }

  /** Paints translated paragraphs over the original text, sized to fit each paragraph. */
  showTranslations(translations: Record<string, string>) {
    if (!this.result) return;
    this.translations = translations;
    const fragment = document.createDocumentFragment();
    const metrics = fontMetrics();
    const fitTargets: { node: HTMLElement; start: number }[] = [];
    for (const block of this.result.blocks) {
      const translated = translations[block.id];
      if (!translated) continue;
      const first = block.lines[0];
      const lineFont = block.lines.reduce((n, l) => n + l.size, 0) / block.lines.length / metrics.ink;
      const node = el('div', 'tr');
      const pad = 0.004;
      node.style.cssText =
        `left:calc(var(--fw)*${(block.box.x - pad).toFixed(5)}px);top:calc(var(--fh)*${(block.box.y - pad).toFixed(5)}px);` +
        `width:calc(var(--fw)*${(block.box.w + pad * 2).toFixed(5)}px);height:calc(var(--fh)*${(block.box.h + pad * 2).toFixed(5)}px);` +
        `--bg:${first.bg ?? '#ffffff'};--fg:${first.fg ?? '#111111'};` +
        `--d:${Math.round((block.box.y * 0.6 + block.box.x * 0.4) * 400)}ms`;
      node.textContent = translated;
      fragment.append(node);
      fitTargets.push({ node, start: lineFont });
    }
    this.trs.replaceChildren(fragment);
    this.el.toggleAttribute('data-translated', true);
    // Shrink each paragraph's font until it fits its box (in units of frame height so it
    // keeps fitting when the image is resized).
    const fh = this.map?.frame.h || 1;
    for (const { node, start } of fitTargets) {
      let size = start * 1.05;
      for (let i = 0; i < 24; i++) {
        node.style.fontSize = `calc(var(--fh)*${size.toFixed(5)}px)`;
        if (node.scrollHeight <= node.clientHeight + 1 && node.scrollWidth <= node.clientWidth + 1) break;
        size *= 0.9;
        if (size * fh < 6) break;
      }
    }
  }

  clearTranslations() {
    this.translations = null;
    this.trs.replaceChildren();
    this.el.toggleAttribute('data-translated', false);
  }

  selectAll() {
    const first = this.words[0]?.span.firstChild;
    const last = this.words[this.words.length - 1]?.span.firstChild;
    if (!first || !last) return;
    const selection = document.getSelection();
    selection?.setBaseAndExtent(first, 0, last, last.textContent?.length ?? 0);
  }

  containsPoint(x: number, y: number): boolean {
    const r = this.visibleClip;
    return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  /** Repositions everything. Returns false once the overlay should be removed. */
  update(origin: { x: number; y: number }): boolean {
    if (this.closed) return false;
    if (!this.target.isConnected) {
      this.close();
      return false;
    }
    const rect = toRect(this.target.getBoundingClientRect());
    if (rect.w < 2 || rect.h < 2) {
      this.el.style.visibility = 'hidden';
      if (this.panel) this.panel.el.style.visibility = 'hidden';
      return true;
    }
    this.el.style.visibility = '';
    if (this.panel) this.panel.el.style.visibility = '';

    // Object-fit geometry needs computed style; refresh it on size changes and periodically.
    const sizeKey = `${rect.w.toFixed(1)}x${rect.h.toFixed(1)}`;
    if (!this.map || sizeKey !== this.mapKey || this.frameCount++ % 30 === 0) {
      this.map = this.mapper();
      this.mapKey = sizeKey;
    }
    const { clip, frame } = this.map;

    // Clip to scrollers/carousels that hide part of the element.
    let visible: Rect | null = { x: rect.x + clip.x, y: rect.y + clip.y, w: clip.w, h: clip.h };
    for (const ancestor of this.ancestors) {
      if (!visible) break;
      visible = intersect(visible, toRect(ancestor.getBoundingClientRect()));
    }
    this.visibleClip = visible;

    const x = this.fixed ? rect.x : rect.x - origin.x;
    const y = this.fixed ? rect.y : rect.y - origin.y;
    const key = [x, y, rect.w, rect.h, clip.x, clip.y, clip.w, clip.h, frame.x, frame.y, frame.w, frame.h, visible?.x, visible?.y, visible?.w, visible?.h]
      .map((n) => (n === undefined ? '' : (n as number).toFixed(2)))
      .join(',');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.write(x, y, rect, clip, frame, visible);
    }
    if (this.panel) {
      const anchor = intersect(visible ?? { x: rect.x + clip.x, y: rect.y + clip.y, w: clip.w, h: clip.h }, viewportRect()) ??
        { x: rect.x + clip.x, y: rect.y + clip.y, w: clip.w, h: clip.h };
      this.panel.place(anchor, origin, this.fixed);
    }
    return true;
  }

  private write(x: number, y: number, rect: Rect, clip: Rect, frame: Rect, visible: Rect | null) {
    const s = this.el.style;
    s.transform = `translate3d(${x}px, ${y}px, 0)`;
    s.width = `${rect.w}px`;
    s.height = `${rect.h}px`;
    const radius = getComputedStyle(this.target).borderRadius || '0px';
    s.setProperty('--r', radius.split(' ')[0]);
    s.setProperty('--diag', `${Math.ceil(Math.hypot(clip.w, clip.h) + 8)}px`);
    s.setProperty('--edge', `${Math.round(clamp(Math.min(clip.w, clip.h) * 0.09, 8, 34))}px`);
    s.setProperty('--bloom', `${Math.round(clamp(Math.min(clip.w, clip.h) * 0.05, 6, 16))}px`);

    const place = (node: HTMLElement, r: Rect) => {
      node.style.left = `${r.x}px`;
      node.style.top = `${r.y}px`;
      node.style.width = `${r.w}px`;
      node.style.height = `${r.h}px`;
    };
    place(this.clip, clip);
    place(this.frame, { x: frame.x - clip.x, y: frame.y - clip.y, w: frame.w, h: frame.h });
    this.frame.style.setProperty('--fw', String(frame.w));
    this.frame.style.setProperty('--fh', String(frame.h));
    this.frame.style.setProperty('--ar', String(frame.w / Math.max(frame.h, 1)));
    place(this.ring, { x: clip.x - 2, y: clip.y - 2, w: clip.w + 4, h: clip.h + 4 });
    place(this.bloom, { x: clip.x - 4, y: clip.y - 4, w: clip.w + 8, h: clip.h + 8 });

    // Status pill inside the image when it fits, otherwise just below it.
    const inside = clip.h >= 92 && clip.w >= 180;
    this.status.style.top = inside ? `${clip.y + clip.h - 42}px` : `${clip.y + clip.h + 8}px`;
    this.status.style.left = `${clip.x + clip.w / 2}px`;

    // Hide what a carousel or scroll box hides (the ring/bloom margins included).
    if (visible && (visible.w < clip.w - 0.5 || visible.h < clip.h - 0.5)) {
      const left = visible.x - rect.x;
      const top = visible.y - rect.y;
      s.clipPath = `inset(${top}px ${rect.w - left - visible.w}px ${rect.h - top - visible.h}px ${left}px)`;
    } else if (!visible) {
      s.clipPath = 'inset(50%)';
    } else {
      s.clipPath = '';
    }
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(setTimeout(fn, ms));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.timers.forEach(clearTimeout);
    this.el.classList.add('closing');
    this.panel?.el.classList.remove('in');
    setTimeout(() => {
      this.el.remove();
      this.panel?.el.remove();
    }, 300);
    this.onClose?.();
  }
}
