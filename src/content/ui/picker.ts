import { toRect } from '../geometry';
import { deepElementsFromPoint, imageAt, targetKind } from '../targets';
import type { UiRoot } from './root';

const BLOCKED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'];

/** Lets the user click any image (or, holding Alt, any element) to read it. */
export class Picker {
  private box = document.createElement('div');
  private label = document.createElement('span');
  private hint = document.createElement('div');
  private candidate: Element | null = null;
  private anyElement = false;
  private onPick: ((target: Element) => void) | null = null;
  active = false;

  constructor(private root: UiRoot) {
    this.box.className = 'pick';
    this.label.className = 'pick-label';
    this.box.append(this.label);
    this.hint.className = 'hint';
    this.hint.innerHTML =
      'Click an image to read it <kbd>Alt</kbd> any element <kbd>Esc</kbd> cancel';
  }

  start(onPick: (target: Element) => void) {
    if (this.active) return;
    this.active = true;
    this.onPick = onPick;
    this.root.attach();
    this.root.container.append(this.box, this.hint);
    requestAnimationFrame(() => this.hint.classList.add('on'));
    window.addEventListener('pointermove', this.onMove, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    for (const type of BLOCKED) window.addEventListener(type, this.onBlocked, true);
    document.documentElement.style.setProperty('cursor', 'crosshair', 'important');
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener('pointermove', this.onMove, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    for (const type of BLOCKED) window.removeEventListener(type, this.onBlocked, true);
    document.documentElement.style.removeProperty('cursor');
    this.box.classList.remove('on');
    this.hint.classList.remove('on');
    setTimeout(() => {
      if (this.active) return;
      this.box.remove();
      this.hint.remove();
    }, 300);
    this.candidate = null;
  }

  private find(x: number, y: number): Element | null {
    if (!this.anyElement) {
      const image = imageAt(x, y, 32);
      if (image) return image;
    }
    // Anything readable: the innermost element of a reasonable size.
    for (const el of deepElementsFromPoint(x, y)) {
      if (el === document.documentElement || el === document.body) continue;
      const r = el.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 16) return el;
    }
    return null;
  }

  private onMove = (event: PointerEvent) => {
    this.anyElement = event.altKey;
    this.highlight(this.find(event.clientX, event.clientY));
  };

  private highlight(target: Element | null) {
    this.candidate = target;
    if (!target) {
      this.box.classList.remove('on');
      return;
    }
    const r = toRect(target.getBoundingClientRect());
    this.box.style.transform = `translate3d(${r.x - 3}px, ${r.y - 3}px, 0)`;
    this.box.style.width = `${r.w + 6}px`;
    this.box.style.height = `${r.h + 6}px`;
    const kind = targetKind(target);
    this.box.classList.toggle('any', !kind);
    this.label.textContent = `${kind && kind !== 'background' ? kind : target.tagName.toLowerCase()} · ${Math.round(r.w)}×${Math.round(r.h)}`;
    this.box.classList.add('on');
  }

  private onBlocked = (event: Event) => {
    if (event.composedPath().includes(this.root.host)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === 'click') {
      const mouse = event as MouseEvent;
      const target = this.candidate ?? this.find(mouse.clientX, mouse.clientY);
      const pick = this.onPick;
      this.stop();
      if (target && pick) pick(target);
    }
  };

  private onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.stop();
    } else if (event.key === 'Alt') {
      this.anyElement = true;
    }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Alt') this.anyElement = false;
  };
}
