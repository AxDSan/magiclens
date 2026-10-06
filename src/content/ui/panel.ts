import { getSettings, providerReady } from '../../shared/settings';
import type { Rect } from '../../shared/types';
import { clamp } from '../../shared/util';
import { icon, type IconName } from './icons';
import { renderMarkdown } from './markdown';

export interface PanelActions {
  copy(): Promise<boolean>;
  selectAll(): void;
  toggleShow(): boolean;
  translate(): void;
  explain(): void;
  summarize(): void;
  ask(question: string): void;
  close(): void;
  openSettings(): void;
}

function button(name: IconName, label: string, title: string, iconOnly = false): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = iconOnly ? 'btn icon' : 'btn';
  el.title = title;
  el.setAttribute('aria-label', title);
  el.append(icon(name));
  if (!iconOnly) el.append(label);
  return el;
}

export class Panel {
  readonly el = document.createElement('div');
  private meta = document.createElement('span');
  private out = document.createElement('div');
  private askForm = document.createElement('form');
  private askInput = document.createElement('input');
  private showButton: HTMLButtonElement;
  private copyButton: HTMLButtonElement;
  private translateButton: HTMLButtonElement;
  private height = 0;

  constructor(
    private actions: PanelActions,
    private aiReady: boolean,
  ) {
    this.el.className = 'panel';
    const bar = document.createElement('div');
    bar.className = 'bar';
    this.meta.className = 'meta';

    this.copyButton = button('copy', 'Copy', 'Copy all text');
    const selectButton = button('selectAll', '', 'Select all text', true);
    this.showButton = button('text', '', 'Show recognized text on the image', true);
    this.translateButton = button('translate', 'Translate', 'Translate the text in place');
    const explainButton = button('sparkle', 'Explain', 'Explain this image');
    const summaryButton = button('summary', '', 'Summarize', true);
    const askButton = button('ask', '', 'Ask about this image', true);
    const closeButton = button('close', '', 'Close (Esc)', true);
    this.showButton.setAttribute('aria-pressed', 'false');
    const sep = () => Object.assign(document.createElement('span'), { className: 'sep' });

    bar.append(
      this.meta,
      sep(),
      this.copyButton,
      selectButton,
      this.showButton,
      sep(),
      this.translateButton,
      explainButton,
      summaryButton,
      askButton,
      sep(),
      closeButton,
    );

    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    const inner = document.createElement('div');
    const card = document.createElement('div');
    card.className = 'card';
    this.out.className = 'out';
    this.askForm.className = 'ask';
    this.askForm.hidden = true;
    this.askInput.placeholder = 'Ask anything about this image…';
    this.askInput.enterKeyHint = 'send';
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'send';
    send.title = 'Ask';
    send.append(icon('send'));
    this.askForm.append(this.askInput, send);
    card.append(this.out, this.askForm);
    inner.append(card);
    sheet.append(inner);
    this.el.append(bar, sheet);

    this.copyButton.addEventListener('click', async () => {
      if (await this.actions.copy()) this.flash(this.copyButton, 'Copied');
    });
    selectButton.addEventListener('click', () => this.actions.selectAll());
    this.showButton.addEventListener('click', () => {
      this.showButton.setAttribute('aria-pressed', String(this.actions.toggleShow()));
    });
    this.translateButton.addEventListener('click', () => void this.needsAi(() => this.actions.translate()));
    explainButton.addEventListener('click', () => void this.needsAi(() => this.actions.explain()));
    summaryButton.addEventListener('click', () => void this.needsAi(() => this.actions.summarize()));
    askButton.addEventListener('click', () =>
      void this.needsAi(() => {
        this.open();
        this.askForm.hidden = false;
        this.askInput.focus();
      }),
    );
    closeButton.addEventListener('click', () => this.actions.close());
    this.askForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const question = this.askInput.value.trim();
      if (!question) return;
      this.askInput.value = '';
      this.actions.ask(question);
    });
    requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.add('in')));
  }

  setMeta(text: string) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    this.meta.replaceChildren(dot, text);
  }

  setAiReady(ready: boolean) {
    this.aiReady = ready;
  }

  private async needsAi(run: () => void) {
    // Settings may have changed in another tab since this panel was created.
    if (!this.aiReady) this.aiReady = providerReady(await getSettings());
    if (this.aiReady) return run();
    this.open();
    const notice = document.createElement('div');
    notice.className = 'notice';
    const link = document.createElement('a');
    link.textContent = 'Open MagicLens settings';
    link.addEventListener('click', () => this.actions.openSettings());
    notice.append('Connect an AI provider (OpenAI, Claude, Gemini, Ollama…) to translate, explain and ask. ', link);
    this.out.replaceChildren(notice);
  }

  private flash(el: HTMLButtonElement, label: string) {
    const original = [...el.childNodes];
    const done = document.createElement('span');
    done.className = 'done';
    done.append(icon('check'));
    el.replaceChildren(done, label);
    setTimeout(() => el.replaceChildren(...original), 1300);
  }

  open() {
    this.el.toggleAttribute('data-open', true);
  }

  setTranslatePressed(pressed: boolean) {
    this.translateButton.setAttribute('aria-pressed', String(pressed));
  }

  /** Shows the waiting animation for a new answer. */
  begin(showAsk = false) {
    this.open();
    this.askForm.hidden = !showAsk;
    const dots = document.createElement('div');
    dots.className = 'thinking';
    dots.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    this.out.replaceChildren(dots);
  }

  stream(markdown: string) {
    renderMarkdown(markdown, this.out);
    const caret = document.createElement('span');
    caret.className = 'caret';
    (this.out.lastElementChild ?? this.out).append(caret);
    this.out.scrollTop = this.out.scrollHeight;
  }

  finish(markdown: string) {
    renderMarkdown(markdown || '_No answer._', this.out);
  }

  error(message: string) {
    this.open();
    const p = document.createElement('p');
    p.className = 'err';
    p.textContent = message;
    this.out.replaceChildren(p);
  }

  /**
   * Places the panel under the image (or above it, or inside its bottom edge when there is
   * no room). `anchor` is the visible image rect in viewport coordinates.
   */
  place(anchor: Rect, origin: { x: number; y: number }, fixed: boolean) {
    const rect = this.el.getBoundingClientRect();
    if (rect.height) this.height = rect.height;
    const width = rect.width || 320;
    const height = this.height || 44;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 10;
    let top = anchor.y + anchor.h + gap;
    let above = false;
    if (top + height > vh - 8) {
      if (anchor.y - gap - height > 8) {
        top = anchor.y - gap - height;
        above = true;
      } else {
        top = clamp(anchor.y + anchor.h - height - gap, 8, vh - height - 8);
      }
    }
    const left = clamp(anchor.x + anchor.w / 2 - width / 2, 8, Math.max(8, vw - width - 8));
    this.el.classList.toggle('fixed', fixed);
    this.el.classList.toggle('above', above);
    const x = fixed ? left : left - origin.x;
    const y = fixed ? top : top - origin.y;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }
}
