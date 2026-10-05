import { setUiHost } from '../targets';
import type { Overlay } from './overlay';
import { STYLES } from './styles';
import { selectionRangeIn, serializeRange } from './textlayer';

export interface Tracked {
  /** Returns false when it no longer needs frames. */
  update(origin: { x: number; y: number }): boolean;
}

const ISOLATED_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'keydown',
  'keyup',
  'keypress',
  'input',
  'wheel',
  'touchstart',
  'touchend',
] as const;

/** The single shadow-DOM host that holds all MagicLens UI on a page. */
export class UiRoot {
  readonly host = document.createElement('magiclens-root');
  readonly shadow: ShadowRoot;
  readonly container = document.createElement('div');
  readonly overlays: Overlay[] = [];
  private tracked = new Set<Tracked>();
  private frame = 0;
  private toastEl: HTMLDivElement | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private pointer = { x: -1, y: -1 };
  private disposers: (() => void)[] = [];

  constructor(reducedMotion: boolean) {
    this.shadow = this.host.attachShadow({ mode: 'open' });
    for (const [property, value] of [
      ['position', 'absolute'],
      ['top', '0'],
      ['left', '0'],
      ['width', '0'],
      ['height', '0'],
      ['z-index', '2147483647'],
      ['pointer-events', 'none'],
      ['display', 'block'],
    ]) {
      this.host.style.setProperty(property, value, 'important');
    }
    this.applyStyles();
    this.container.className = 'root';
    this.setReducedMotion(reducedMotion);
    this.shadow.append(this.container);
    setUiHost(this.host);

    // Keep page handlers (lightbox "click outside to close", keyboard shortcuts) from
    // reacting to interaction with our UI.
    for (const type of ISOLATED_EVENTS) {
      this.shadow.addEventListener(type, (event) => event.stopPropagation());
    }

    const onCopy = (event: ClipboardEvent) => {
      const range = selectionRangeIn(this.shadow);
      if (!range) return;
      const overlay = this.overlays.find((o) => o.words.some((w) => range.intersectsNode(w.span)));
      if (!overlay) return;
      const text = serializeRange(range, overlay.words);
      if (!text) return;
      event.clipboardData?.setData('text/plain', text);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const open = this.overlays.filter((o) => !o.isClosed);
        const top = open.find((o) => o.containsPoint(this.pointer.x, this.pointer.y)) ?? open[open.length - 1];
        if (top) {
          top.close();
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        const active = this.shadow.activeElement;
        if (active && /^(INPUT|TEXTAREA)$/.test(active.tagName)) return;
        const hovered = this.overlays.find((o) => !o.isClosed && o.state === 'ready' && o.containsPoint(this.pointer.x, this.pointer.y));
        if (hovered) {
          hovered.selectAll();
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
    };
    const onPointer = (event: PointerEvent) => {
      this.pointer = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener('copy', onCopy, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointermove', onPointer, { capture: true, passive: true });
    this.disposers.push(
      () => document.removeEventListener('copy', onCopy, true),
      () => window.removeEventListener('keydown', onKey, true),
      () => window.removeEventListener('pointermove', onPointer, true),
    );
  }

  private applyStyles() {
    // Constructable sheets bypass strict page CSPs; <style> is the fallback where the
    // content-script realm cannot adopt them (older Firefox).
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLES);
      this.shadow.adoptedStyleSheets = [sheet];
      if (this.shadow.adoptedStyleSheets.length) return;
    } catch {
      // fall through
    }
    const style = document.createElement('style');
    style.textContent = STYLES;
    this.shadow.append(style);
  }

  setReducedMotion(reduced: boolean) {
    const prefers = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.container.classList.toggle('reduced', reduced || !!prefers);
  }

  /** Re-attaches the host if the page replaced the document contents. */
  attach() {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host);
  }

  addOverlay(overlay: Overlay) {
    this.attach();
    this.overlays.push(overlay);
    this.container.appendChild(overlay.el);
    this.track(overlay);
  }

  removeOverlay(overlay: Overlay) {
    const index = this.overlays.indexOf(overlay);
    if (index >= 0) this.overlays.splice(index, 1);
  }

  overlayFor(target: Element): Overlay | undefined {
    return this.overlays.find((o) => o.target === target && !o.isClosed);
  }

  track(item: Tracked) {
    this.tracked.add(item);
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.frame = 0;
    if (!this.tracked.size) return;
    const hostRect = this.host.getBoundingClientRect();
    const origin = { x: hostRect.left, y: hostRect.top };
    for (const item of [...this.tracked]) {
      let keep = false;
      try {
        keep = item.update(origin);
      } catch (error) {
        console.warn('[MagicLens] update failed', error);
      }
      if (!keep) this.tracked.delete(item);
    }
    if (this.tracked.size) this.frame = requestAnimationFrame(this.tick);
  };

  toast(message: string, ms = 2800) {
    this.attach();
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      this.toastEl.className = 'toast';
      this.container.appendChild(this.toastEl);
    }
    const toast = this.toastEl;
    toast.textContent = message;
    requestAnimationFrame(() => toast.classList.add('on'));
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove('on'), ms);
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.disposers.forEach((dispose) => dispose());
    this.overlays.forEach((o) => o.close());
    this.host.remove();
  }
}
