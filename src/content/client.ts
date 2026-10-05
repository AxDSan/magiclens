import { type Browser, browser } from 'wxt/browser';
import { CONTENT_PORT, type ContentRequest, type EngineEvent } from '../shared/messages';

type Handler = (event: EngineEvent) => void;

/** Long-lived connection to the background script, shared by every overlay in the frame. */
class EngineClient {
  private port: Browser.runtime.Port | null = null;
  private handlers = new Map<string, Handler>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;

  private connect(): Browser.runtime.Port {
    const port = browser.runtime.connect({ name: CONTENT_PORT });
    port.onMessage.addListener((event: EngineEvent) => {
      const handler = this.handlers.get(event.id);
      if (!handler) return;
      if (event.t === 'result' || event.t === 'error' || event.t === 'done') this.release(event.id);
      handler(event);
    });
    port.onDisconnect.addListener(() => {
      this.port = null;
      // The service worker restarted or the extension was reloaded mid-job.
      for (const [id, handler] of [...this.handlers]) {
        this.release(id);
        handler({ t: 'error', id, code: 'INTERNAL', message: 'Lost connection to MagicLens. Try again.' });
      }
    });
    this.port = port;
    return port;
  }

  private post(message: ContentRequest) {
    try {
      (this.port ?? this.connect()).postMessage(message);
    } catch {
      this.port = null;
      this.connect().postMessage(message);
    }
  }

  private release(id: string) {
    this.handlers.delete(id);
    if (!this.handlers.size) {
      clearInterval(this.heartbeat);
      this.heartbeat = undefined;
    }
  }

  /** Starts a request and returns a cancel function. */
  request(id: string, message: ContentRequest, handler: Handler): () => void {
    this.handlers.set(id, handler);
    this.heartbeat ??= setInterval(() => this.post({ t: 'ping' }), 15_000);
    this.post(message);
    return () => {
      if (!this.handlers.has(id)) return;
      this.release(id);
      this.post({ t: 'cancel', id });
    };
  }

  openOptions() {
    this.post({ t: 'open-options' });
  }

  disconnect() {
    this.port?.disconnect();
    this.port = null;
    this.handlers.clear();
    clearInterval(this.heartbeat);
  }
}

export const engineClient = new EngineClient();
