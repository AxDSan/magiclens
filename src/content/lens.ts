import type { EngineEvent } from '../shared/messages';
import { providerReady, type Settings } from '../shared/settings';
import type { AnalysisKind, EngineKind, ImageSource } from '../shared/types';
import { uid } from '../shared/util';
import { engineClient } from './client';
import { visibleRect } from './geometry';
import { captureMapper, deepElementsFromPoint, findMainImage, imageAt, type Mapper, planSource, targetKind, visibleImages } from './targets';
import { Overlay } from './ui/overlay';
import type { UiRoot } from './ui/root';

const frames = (n = 2) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
    step(n);
  });

interface CaptureRequest {
  source: ImageSource;
  mapper: Mapper;
}

/** Orchestrates reading an element: pixels → engine → overlay → analysis. */
export class Lens {
  private analysisCancel = new WeakMap<Overlay, () => void>();
  private lastContext: { el: Element | null; x: number; y: number } = { el: null, x: 0, y: 0 };

  constructor(
    private root: UiRoot,
    private settings: Settings,
  ) {
    window.addEventListener(
      'contextmenu',
      (event) => {
        this.lastContext = { el: event.target as Element, x: event.clientX, y: event.clientY };
      },
      true,
    );
  }

  updateSettings(settings: Settings) {
    this.settings = settings;
    this.root.setReducedMotion(settings.reducedMotion);
  }

  private get aiReady() {
    return providerReady(this.settings);
  }

  // ───────────────────────── triggers ─────────────────────────

  readMain(engine?: EngineKind): boolean {
    const target = findMainImage(this.settings.minImageSize * 0.6);
    if (!target) return false;
    void this.read(target, engine);
    return true;
  }

  readAll(engine?: EngineKind): number {
    const targets = visibleImages(this.settings.minImageSize * 0.6);
    targets.forEach((target, i) => setTimeout(() => void this.read(target, engine), i * 160));
    return targets.length;
  }

  /** Resolves what the user right-clicked. */
  contextTarget(srcUrl?: string): Element | null {
    const { el, x, y } = this.lastContext;
    if (el && targetKind(el) && targetKind(el) !== 'element') return el;
    const under = imageAt(x, y, 24);
    if (under) return under;
    if (srcUrl) {
      const match = [...document.images].find((img) => img.currentSrc === srcUrl || img.src === srcUrl);
      if (match) return match;
    }
    return el ?? deepElementsFromPoint(x, y)[0] ?? null;
  }

  // ───────────────────────── reading ─────────────────────────

  async read(target: Element, engine?: EngineKind) {
    const existing = this.root.overlayFor(target);
    if (existing) {
      if (existing.state !== 'error') return;
      existing.close();
    }
    let plan;
    try {
      plan = await planSource(target);
    } catch (error) {
      this.root.toast(`MagicLens: ${(error as Error).message}`);
      return;
    }
    if (plan.source) {
      const overlay = this.createOverlay(target, plan.mapper);
      this.runJob(overlay, plan.source, engine, plan.readback);
      return;
    }
    const capture = await this.prepareCapture(target);
    if (!capture) return;
    this.runCaptureJob(target, capture, engine);
  }

  private createOverlay(target: Element, mapper: Mapper): Overlay {
    const overlay: Overlay = new Overlay(
      target,
      mapper,
      {
        copy: () => this.copy(overlay),
        selectAll: () => overlay.selectAll(),
        toggleShow: () => overlay.toggleShowText(),
        translate: () => this.translate(overlay),
        explain: () => this.analyze(overlay, 'explain'),
        summarize: () => this.analyze(overlay, 'summarize'),
        ask: (question) => this.analyze(overlay, 'ask', question),
        close: () => overlay.close(),
        openSettings: () => engineClient.openOptions(),
      },
      this.aiReady,
    );
    this.root.addOverlay(overlay);
    return overlay;
  }

  /** Scrolls the element into view, hides our UI and computes the screenshot region. */
  private async prepareCapture(target: Element): Promise<CaptureRequest | null> {
    const full = target.getBoundingClientRect();
    let visible = visibleRect(target);
    if (!visible || visible.w * visible.h < full.width * full.height * 0.6) {
      target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      await frames(2);
      visible = visibleRect(target);
    }
    if (!visible || visible.w < 8 || visible.h < 8) {
      this.root.toast('MagicLens: that element is not visible on screen.');
      return null;
    }
    // Screenshots cover the whole tab: shift the rect by this frame's position in it.
    let offsetX = 0;
    let offsetY = 0;
    let viewport = { w: window.innerWidth, h: window.innerHeight };
    try {
      let win: Window = window;
      while (win !== win.top) {
        const frameEl = win.frameElement;
        if (!frameEl) throw new Error('cross-origin');
        const r = frameEl.getBoundingClientRect();
        const style = getComputedStyle(frameEl);
        offsetX += r.left + (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.paddingLeft) || 0);
        offsetY += r.top + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.paddingTop) || 0);
        win = win.parent;
      }
      viewport = { w: win.innerWidth, h: win.innerHeight };
    } catch {
      this.root.toast('MagicLens cannot screenshot inside this embedded frame. Try the image itself.');
      return null;
    }
    return {
      source: {
        kind: 'capture',
        rect: { x: visible.x + offsetX, y: visible.y + offsetY, w: visible.w, h: visible.h },
        viewport,
      },
      mapper: captureMapper(target, visible),
    };
  }

  private async hideUi<T>(run: () => Promise<T>): Promise<T> {
    this.root.host.style.setProperty('visibility', 'hidden', 'important');
    await frames(2);
    return run();
  }

  private showUi() {
    this.root.host.style.removeProperty('visibility');
  }

  /** Screenshot-based read: the overlay appears once the pixels are captured. */
  private runCaptureJob(target: Element, capture: CaptureRequest, engine?: EngineKind, overlay?: Overlay) {
    void this.hideUi(async () => {
      const jobId = uid('job');
      let current = overlay;
      const handler = (event: EngineEvent) => {
        if (event.t === 'captured') {
          this.showUi();
          if (!current) current = this.createOverlay(target, capture.mapper);
          else current.mapper = capture.mapper;
          this.bindClose(current, cancel);
          return;
        }
        if (!current) {
          this.showUi();
          if (event.t === 'error') this.root.toast(`MagicLens: ${event.message}`, 4200);
          return;
        }
        this.handleOcrEvent(current, event, () => this.retry(current!, target, engine), undefined);
      };
      const cancel = engineClient.request(jobId, { t: 'ocr', jobId, source: capture.source, engine }, handler);
      // Never leave the UI hidden if the capture stalls.
      setTimeout(() => this.showUi(), 4000);
    });
  }

  private bindClose(overlay: Overlay, cancel: () => void) {
    overlay.onClose = () => {
      cancel();
      this.analysisCancel.get(overlay)?.();
      this.root.removeOverlay(overlay);
    };
  }

  private runJob(overlay: Overlay, source: ImageSource, engine?: EngineKind, readback?: () => Promise<string | null>) {
    const jobId = uid('job');
    overlay.restart();
    const cancel = engineClient.request(jobId, { t: 'ocr', jobId, source, engine }, (event) =>
      this.handleOcrEvent(overlay, event, () => this.retry(overlay, overlay.target, engine), async () => {
        // The engine could not download the image (auth, hotlink protection): read the
        // pixels here if the image allows it, else fall back to a screenshot.
        const dataUrl = readback ? await readback() : null;
        if (dataUrl) return this.runJob(overlay, { kind: 'data', dataUrl }, engine);
        const capture = await this.prepareCapture(overlay.target);
        if (!capture) return overlay.fail('Could not read this image');
        this.runCaptureJob(overlay.target, capture, engine, overlay);
      }),
    );
    this.bindClose(overlay, cancel);
  }

  private retry(overlay: Overlay, target: Element, engine?: EngineKind) {
    overlay.close();
    setTimeout(() => void this.read(target, engine), 320);
  }

  private handleOcrEvent(
    overlay: Overlay,
    event: EngineEvent,
    retry: () => void,
    onFetchFailed?: () => void,
  ) {
    if (overlay.isClosed) return;
    switch (event.t) {
      case 'progress':
        overlay.progress(event.info);
        break;
      case 'partial':
        overlay.present(event.result, false);
        break;
      case 'result':
        overlay.present(event.result, true, event.image);
        if (event.result.notes?.length) this.root.toast(event.result.notes[0], 5000);
        break;
      case 'error':
        if (event.code === 'CANCELLED') return;
        if (event.code === 'FETCH_FAILED' && onFetchFailed) return onFetchFailed();
        if (event.code === 'NO_PROVIDER') {
          overlay.fail('Set up an AI provider first');
          engineClient.openOptions();
          return;
        }
        overlay.fail(event.message, retry);
        break;
    }
  }

  // ───────────────────────── actions ─────────────────────────

  private async copy(overlay: Overlay): Promise<boolean> {
    const text = overlay.result?.text;
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      let copied = false;
      const listener = (event: ClipboardEvent) => {
        event.clipboardData?.setData('text/plain', text);
        event.preventDefault();
        copied = true;
      };
      document.addEventListener('copy', listener, { capture: true, once: true });
      document.execCommand('copy');
      document.removeEventListener('copy', listener, { capture: true });
      return copied;
    }
  }

  private translate(overlay: Overlay) {
    if (overlay.translations) {
      overlay.clearTranslations();
      overlay.panel?.setTranslatePressed(false);
      return;
    }
    this.analyze(overlay, 'translate');
  }

  private analyze(overlay: Overlay, kind: AnalysisKind, question?: string) {
    const result = overlay.result;
    const image = overlay.image;
    if (!result || !image) return;
    const panel = overlay.ensurePanel();
    this.analysisCancel.get(overlay)?.();
    panel.begin(kind === 'ask');
    const prefix = kind === 'ask' && question ? `*${question.replace(/\*/g, '')}*\n\n` : '';
    const reqId = uid('req');
    const cancel = engineClient.request(
      reqId,
      { t: 'analyze', reqId, kind, question, image, result },
      (event) => {
        if (event.t === 'delta') panel.stream(prefix + event.text);
        else if (event.t === 'done') {
          panel.finish(prefix + event.text);
          if (kind === 'translate' && event.translations && Object.keys(event.translations).length) {
            overlay.showTranslations(event.translations);
            panel.setTranslatePressed(true);
          }
        } else if (event.t === 'error' && event.code !== 'CANCELLED') {
          panel.error(event.message);
        }
      },
    );
    this.analysisCancel.set(overlay, cancel);
  }

  refreshAi() {
    for (const overlay of this.root.overlays) overlay.panel?.setAiReady(this.aiReady);
  }
}
