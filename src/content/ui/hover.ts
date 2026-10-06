import { clippingAncestors, intersect, isFixedContext, toRect, viewportRect } from '../geometry';
import { imageAt } from '../targets';
import { icon } from './icons';
import type { UiRoot } from './root';

/** The small lens button that appears on images under the pointer. */
export class HoverButton {
  readonly el = document.createElement('button');
  enabled = true;
  minSize = 96;
  private target: Element | null = null;
  private fixed = false;
  private ancestors: Element[] = [];
  private pending: { x: number; y: number } | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | undefined;
  private lastScan = 0;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private showTimer: ReturnType<typeof setTimeout> | undefined;
  private overButton = false;
  private suppressed: () => boolean;

  constructor(
    private root: UiRoot,
    onActivate: (target: Element, event: MouseEvent) => void,
    suppressed: () => boolean,
  ) {
    this.suppressed = suppressed;
    this.el.type = 'button';
    this.el.className = 'hbtn';
    this.el.title = 'Read text in this image (MagicLens)';
    this.el.setAttribute('aria-label', 'Read text in this image');
    this.el.append(icon('lens'));
    root.container.appendChild(this.el);

    this.el.addEventListener('pointerenter', () => {
      this.overButton = true;
      clearTimeout(this.hideTimer);
    });
    this.el.addEventListener('pointerleave', () => {
      this.overButton = false;
      this.scheduleHide();
    });
    this.el.addEventListener('click', (event) => {
      event.preventDefault();
      const target = this.target;
      if (!target) return;
      this.el.toggleAttribute('data-busy', true);
      setTimeout(() => this.el.toggleAttribute('data-busy', false), 600);
      this.hide(true);
      onActivate(target, event);
    });

    window.addEventListener('pointermove', this.onMove, { capture: true, passive: true });
    window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
  }

  private onScroll = () => {
    if (this.target && !this.overButton) this.root.track(this);
  };

  private onMove = (event: PointerEvent) => {
    if (!this.enabled || event.pointerType === 'touch') return;
    this.pending = { x: event.clientX, y: event.clientY };
    if (this.scanTimer) return;
    // Hit-testing is the expensive part; ~12 checks a second is plenty.
    const wait = Math.max(0, 80 - (performance.now() - this.lastScan));
    this.scanTimer = setTimeout(() => {
      this.scanTimer = undefined;
      this.lastScan = performance.now();
      this.scan();
    }, wait);
  };

  private scan() {
    const point = this.pending;
    this.pending = null;
    if (!point || this.overButton) return;
    if (this.suppressed()) return this.hide(true);
    const found = imageAt(point.x, point.y, this.minSize);
    if (found && this.root.overlayFor(found)) return this.hide();
    if (found === this.target) {
      clearTimeout(this.hideTimer);
      return;
    }
    if (!found) return this.scheduleHide();
    clearTimeout(this.hideTimer);
    clearTimeout(this.showTimer);
    const visibleNow = this.el.hasAttribute('data-show');
    this.showTimer = setTimeout(() => this.show(found), visibleNow ? 0 : 140);
  }

  private show(target: Element) {
    this.target = target;
    this.fixed = isFixedContext(target);
    this.ancestors = clippingAncestors(target);
    this.el.classList.toggle('fixed', this.fixed);
    this.root.attach();
    if (!this.el.isConnected) this.root.container.appendChild(this.el);
    this.root.track(this);
    requestAnimationFrame(() => this.el.toggleAttribute('data-show', true));
  }

  private scheduleHide() {
    clearTimeout(this.hideTimer);
    clearTimeout(this.showTimer);
    this.hideTimer = setTimeout(() => {
      if (!this.overButton) this.hide();
    }, 280);
  }

  hide(immediate = false) {
    clearTimeout(this.showTimer);
    this.el.toggleAttribute('data-show', false);
    if (immediate) this.target = null;
    else this.hideTimer = setTimeout(() => (this.target = null), 200);
  }

  update(origin: { x: number; y: number }): boolean {
    const target = this.target;
    if (!target || !target.isConnected) {
      this.el.toggleAttribute('data-show', false);
      return false;
    }
    let visible: ReturnType<typeof intersect> = toRect(target.getBoundingClientRect());
    for (const ancestor of this.ancestors) {
      if (!visible) break;
      visible = intersect(visible, toRect(ancestor.getBoundingClientRect()));
    }
    visible = visible && intersect(visible, viewportRect());
    if (!visible) {
      this.el.toggleAttribute('data-show', false);
      return false;
    }
    const size = 34;
    const inset = visible.h < 70 ? Math.max(2, (visible.h - size) / 2) : 10;
    const x = visible.x + visible.w - size - Math.min(10, inset + 0);
    const y = visible.y + inset;
    this.el.style.left = `${this.fixed ? x : x - origin.x}px`;
    this.el.style.top = `${this.fixed ? y : y - origin.y}px`;
    return true;
  }

  destroy() {
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('scroll', this.onScroll, true);
    this.el.remove();
  }
}
