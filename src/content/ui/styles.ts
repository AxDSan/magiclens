/*
 * Every running animation below animates only `transform` and `opacity`, so it runs on the
 * compositor and stays smooth even while the page's main thread is busy.
 */
export const STYLES = /* css */ `
:host {
  all: initial !important;
  position: absolute !important;
  inset: 0 auto auto 0 !important;
  width: 0 !important;
  height: 0 !important;
  overflow: visible !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
  display: block !important;
  contain: none !important;
}
*, *::before, *::after { box-sizing: border-box; }

.root {
  --ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --text-font: Arial, "Liberation Sans", "Helvetica Neue", Helvetica, sans-serif;
  --glass: rgba(18, 20, 30, 0.74);
  --glass-strong: rgba(18, 20, 30, 0.86);
  --hairline: rgba(255, 255, 255, 0.12);
  --accent: #7c9bff;
  --spectrum: conic-gradient(from 0deg, #4f8cff, #8b5cff, #e04fff, #ff5f9e, #ffab4f, #ffd84f, #4fe0c8, #4fb3ff, #4f8cff);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-spring: cubic-bezier(0.2, 0.9, 0.25, 1.25);
  font: 500 13px/1.35 var(--ui);
  color: #f3f5ff;
  -webkit-font-smoothing: antialiased;
}

/* ───────────────────────── overlay ───────────────────────── */
.ov {
  position: absolute;
  left: 0;
  top: 0;
  pointer-events: none;
  --r: 0px;
}
.ov.fixed { position: fixed; }
.ov.closing { opacity: 0; transition: opacity 260ms ease; }

.clip {
  position: absolute;
  overflow: hidden;
  border-radius: var(--r);
  isolation: isolate;
}

.veil {
  position: absolute;
  inset: 0;
  background: radial-gradient(140% 110% at 50% 45%, rgba(18, 22, 48, 0.16), rgba(6, 8, 22, 0.46));
  opacity: 0;
  transition: opacity 700ms var(--ease-out);
}
.ov[data-state='scan'] .veil,
.ov[data-state='refine'] .veil { opacity: 1; }
.ov[data-state='ready'] .veil { opacity: 0.5; }
.ov[data-state='ready'][data-quiet] .veil { opacity: 0; }

.fx {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 650ms var(--ease-out);
}
.ov[data-state='scan'] .fx,
.ov[data-state='refine'] .fx { opacity: 1; }
.ov[data-state='refine'] .fx { opacity: 0.55; }

/* Light sweeping down the image. */
.beam {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    rgba(110, 150, 255, 0) 38%,
    rgba(110, 150, 255, 0.06) 44%,
    rgba(190, 210, 255, 0.22) 49.4%,
    rgba(255, 255, 255, 0.46) 50%,
    rgba(215, 180, 255, 0.22) 50.6%,
    rgba(170, 120, 255, 0.06) 56%,
    rgba(170, 120, 255, 0) 62%
  );
  mix-blend-mode: screen;
  transform: translate3d(0, -62%, 0);
  animation: ml-beam 3.2s cubic-bezier(0.45, 0.05, 0.35, 1) infinite;
  will-change: transform;
}
@keyframes ml-beam {
  0% { transform: translate3d(0, -62%, 0); }
  100% { transform: translate3d(0, 62%, 0); }
}

/* Iridescent glow hugging the inner edges, turning slowly clockwise. */
.edge {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: var(--r);
  mix-blend-mode: screen;
  opacity: 0.24;
  -webkit-mask:
    linear-gradient(90deg, #000, transparent var(--edge), transparent calc(100% - var(--edge)), #000),
    linear-gradient(180deg, #000, transparent var(--edge), transparent calc(100% - var(--edge)), #000);
  mask:
    linear-gradient(90deg, #000, transparent var(--edge), transparent calc(100% - var(--edge)), #000),
    linear-gradient(180deg, #000, transparent var(--edge), transparent calc(100% - var(--edge)), #000);
}
.spin {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--diag);
  height: var(--diag);
  margin: calc(var(--diag) / -2) 0 0 calc(var(--diag) / -2);
  background: var(--spectrum);
  animation: ml-spin 9s linear infinite;
  will-change: transform;
}
.edge .spin { animation-duration: 12s; }
@keyframes ml-spin { to { transform: rotate(1turn); } }

/* Faint spectrum ring around the element and a soft bloom outside it, each carrying a
   highlight that runs clockwise around the frame (see Comet). */
.ring, .bloom {
  position: absolute;
  overflow: hidden;
  border-radius: calc(var(--r) + 2px);
  opacity: 0;
  transition: opacity 600ms var(--ease-out), transform 900ms var(--ease-out);
}
.ring {
  padding: 2px;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
.ring .spin { opacity: 0.3; }
.bloom .spin { opacity: 0.2; }
.bloom-wrap {
  position: absolute;
  inset: 0;
  filter: blur(var(--bloom));
}
.bloom {
  padding: 5px;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
.ov[data-state='scan'] .ring,
.ov[data-state='scan'] .bloom,
.ov[data-state='refine'] .ring,
.ov[data-state='refine'] .bloom { opacity: 1; }
.ov[data-state='ready'] .ring,
.ov[data-state='ready'] .bloom,
.ov[data-state='error'] .bloom { opacity: 0; transform: scale(1.025); }
.ov[data-state='error'] .ring { opacity: 1; }
.ov[data-state='error'] .spin { opacity: 1; background: conic-gradient(from 0deg, #ff4f6d, #ff9f4f, #ff4f6d); }
.ov[data-state='error'] .comet { display: none; }

.comet { position: absolute; inset: 0; }
.comet .side {
  position: absolute;
  height: 12px;
  overflow: hidden;
  transform-origin: 0 0;
}
.comet .tail {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(
      90deg,
      rgba(79, 140, 255, 0) calc(100% - var(--tail)),
      rgba(108, 130, 255, 0.35) calc(100% - var(--tail) * 0.6),
      rgba(176, 102, 255, 0.7) calc(100% - var(--tail) * 0.3),
      rgba(255, 112, 190, 0.92) calc(100% - var(--tail) * 0.08),
      #fff 100%
    )
    0 0 / var(--lap) 100% repeat-x;
  will-change: transform;
}

/* Squares pulsing outward from the centre in rings (see buildCells). Pulses alternate between
   two Game of Life generations, each crossing the element in about a second. */
.cells { position: absolute; inset: 0; opacity: 0.7; }
.cell-band {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  image-rendering: pixelated;
  opacity: 0;
  animation: ml-cells 2.6s cubic-bezier(0.35, 0, 0.25, 1) infinite;
  animation-delay: calc(var(--band) * 0.17s + var(--gen) * 1.3s);
  will-change: transform, opacity;
}
@keyframes ml-cells {
  0% { opacity: 0; transform: scale(0.985); }
  9% { opacity: 1; }
  30% { opacity: 0; transform: scale(1.012); }
  100% { opacity: 0; transform: scale(1.012); }
}

/* Faded-out effects stop animating (see Overlay.setState). */
.ov[data-idle] .fx,
.ov[data-idle] .bloom-wrap,
.ov[data-idle] .ring { display: none; }

/* One bright flash when the result lands. */
.flash {
  position: absolute;
  inset: 0;
  background: radial-gradient(70% 60% at 50% 50%, rgba(255, 255, 255, 0.55), rgba(160, 180, 255, 0) 70%);
  opacity: 0;
  pointer-events: none;
}
.ov[data-state='ready'] .flash { animation: ml-flash 900ms var(--ease-out) both; }
@keyframes ml-flash {
  0% { opacity: 0; transform: scale(0.85); }
  25% { opacity: 1; }
  100% { opacity: 0; transform: scale(1.15); }
}

/* ───────────────────────── recognized text ───────────────────────── */
.frame { position: absolute; }
.hls, .bgs, .trs, .txt { position: absolute; inset: 0; }

.hl {
  position: absolute;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.24);
  opacity: 0;
}
.hl::after {
  content: '';
  position: absolute;
  inset: -2px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 0 14px 3px rgba(140, 170, 255, 0.65);
  opacity: 0;
}
.ov[data-state='refine'] .hl,
.ov[data-state='ready'] .hl {
  animation: ml-hl-in 680ms var(--ease-spring) both;
  animation-delay: var(--d);
}
.ov[data-state='refine'] .hl::after,
.ov[data-state='ready'] .hl::after {
  animation: ml-hl-flash 1000ms var(--ease-out) both;
  animation-delay: var(--d);
}
.ov[data-revealed] .hl,
.ov[data-revealed] .hl::after { animation: none; }
.ov[data-revealed] .hl { opacity: 1; }
@keyframes ml-hl-in {
  0% { opacity: 0; transform: scale(0.55); }
  100% { opacity: 1; transform: none; }
}
@keyframes ml-hl-flash {
  0% { opacity: 0; }
  22% { opacity: 1; }
  100% { opacity: 0; }
}
.ov[data-state='ready'] .frame:hover .hl { background: rgba(255, 255, 255, 0.28); }
.ov[data-state='ready'][data-quiet] .hl { background: transparent; box-shadow: none; }
.ov[data-state='ready'][data-quiet] .frame:hover .hl { background: rgba(120, 160, 255, 0.16); }
.hl.approx { border-radius: 5px; }

/* Hybrid mode: the local text shimmers while the model double-checks it. */
.ov[data-state='refine'] .hls { animation: ml-pulse 1.4s ease-in-out infinite; }
@keyframes ml-pulse { 50% { opacity: 0.55; } }

.txt {
  pointer-events: auto;
  cursor: default;
  user-select: text;
  -webkit-user-select: text;
}
.ov[data-state='scan'] .txt { pointer-events: none; }
.w, .g {
  position: absolute;
  white-space: pre;
  color: transparent;
  font-family: var(--text-font);
  font-weight: 400;
  line-height: var(--lh);
  transform-origin: 0 0;
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
}
.w::selection, .g::selection { background: rgba(70, 135, 255, 0.45); color: transparent; }

/* Hyperlinks found in the recognized text. Each link is one <a> around its word spans, so
   the browser treats it as a native link; these rules only restore the affordances the
   absolute positioning would otherwise hide. */
.txt a { color: inherit; text-decoration: none; }
.txt a .w { cursor: pointer; }
.txt a:hover .w,
.txt a:focus-visible .w {
  background: rgba(70, 135, 255, 0.26);
  border-radius: 2px;
}
.txt a:focus-visible { outline: none; }
.txt a:focus-visible .w { outline: 2px solid #4a9eff; outline-offset: 2px; }
.ov[data-show] .txt a .w {
  color: #1d4ed8;
  text-decoration: underline;
  text-decoration-thickness: 1px;
}
.ov[data-show] .txt a:hover .w { color: #1740b0; }

/* "Show text": the recognized text drawn back onto the image. */
.lbg {
  position: absolute;
  border-radius: 2px;
  background: var(--bg);
  opacity: 0;
  transition: opacity 280ms ease;
}
.ov[data-show] .lbg { opacity: 1; }
.ov[data-show] .w { color: var(--fg); }
.ov[data-show] .w::selection { color: #fff; }
.ov[data-show] .hl { opacity: 0 !important; }

/* Translations painted over the original paragraphs. */
.tr {
  position: absolute;
  display: flex;
  align-items: center;
  overflow: hidden;
  padding: 0 0.15em;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
  color: var(--fg);
  font-family: var(--text-font);
  line-height: 1.18;
  white-space: normal;
  overflow-wrap: anywhere;
  pointer-events: auto;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
  opacity: 0;
  transform: translateY(3px);
  animation: ml-tr-in 520ms var(--ease-out) both;
  animation-delay: var(--d);
}
.tr::selection, .tr *::selection { background: rgba(70, 135, 255, 0.45); }
@keyframes ml-tr-in { to { opacity: 1; transform: none; } }
.ov[data-translated] .hl { opacity: 0 !important; }

/* ───────────────────────── status pill ───────────────────────── */
.status {
  position: absolute;
  left: 50%;
  top: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 92%;
  padding: 6px 12px 6px 7px;
  border-radius: 999px;
  background: var(--glass);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.28), inset 0 0 0 1px var(--hairline);
  color: #fff;
  font: 600 12px/1.2 var(--ui);
  letter-spacing: 0.01em;
  white-space: nowrap;
  opacity: 0;
  transform: translate(-50%, 6px) scale(0.94);
  transition: opacity 280ms ease, transform 520ms var(--ease-spring);
  overflow: hidden;
}
.ov[data-state='scan'] .status,
.ov[data-state='refine'] .status,
.ov[data-state='error'] .status { opacity: 1; transform: translate(-50%, 0) scale(1); }
.status .label { overflow: hidden; text-overflow: ellipsis; }
.status .pct { font-variant-numeric: tabular-nums; opacity: 0.7; }
.status .pct:empty { display: none; }
.status .label.swap { animation: ml-swap 320ms var(--ease-out); }
@keyframes ml-swap { from { opacity: 0; transform: translateY(5px); } }
.orb {
  position: relative;
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  overflow: hidden;
  -webkit-mask: radial-gradient(circle, transparent 4px, #000 4.5px);
  mask: radial-gradient(circle, transparent 4px, #000 4.5px);
}
.orb::before {
  content: '';
  position: absolute;
  inset: -2px;
  background: var(--spectrum);
  animation: ml-spin 1.1s linear infinite;
}
.ov[data-state='error'] .orb::before { background: #ff5a6e; animation: none; }
.progress {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 2px;
  height: 2px;
  border-radius: 2px;
  overflow: hidden;
  opacity: 0;
  transition: opacity 200ms ease;
}
.progress.on { opacity: 1; }
.progress i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #6aa1ff, #b77bff, #ff7ab8);
  transform-origin: 0 50%;
  transform: scaleX(var(--p, 0));
  transition: transform 400ms var(--ease-out);
}
.status button {
  appearance: none;
  border: 0;
  margin: 0 -4px 0 2px;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
  font: inherit;
  cursor: pointer;
  pointer-events: auto;
}

/* ───────────────────────── panel ───────────────────────── */
.panel {
  position: absolute;
  left: 0;
  top: 0;
  width: max-content;
  max-width: min(480px, calc(100vw - 24px));
  pointer-events: auto;
  color: #f3f5ff;
  font: 500 13px/1.4 var(--ui);
  opacity: 0;
  transform: translateY(-6px) scale(0.97);
  transform-origin: 50% 0;
  transition: opacity 260ms ease, transform 460ms var(--ease-spring);
}
.panel.fixed { position: fixed; }
.panel.above { transform-origin: 50% 100%; }
.panel.in { opacity: 1; transform: none; }
.bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 14px;
  background: var(--glass);
  -webkit-backdrop-filter: blur(22px) saturate(190%);
  backdrop-filter: blur(22px) saturate(190%);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.3), inset 0 0 0 1px var(--hairline);
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 6px;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  white-space: nowrap;
}
.meta .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--spectrum);
}
.btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: nowrap;
  cursor: pointer;
  transition: background 160ms ease, transform 160ms ease, color 160ms ease;
}
.btn:hover { background: rgba(255, 255, 255, 0.1); }
.btn:active { transform: scale(0.95); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.btn[aria-pressed='true'] { background: rgba(124, 155, 255, 0.28); color: #fff; }
.btn.icon { width: 30px; padding: 0; justify-content: center; }
.btn svg { width: 16px; height: 16px; flex: none; }
.btn .done { color: #7dffb2; }
.sep { flex: none; width: 1px; height: 18px; margin: 0 3px; background: rgba(255, 255, 255, 0.14); }

.sheet {
  display: grid;
  grid-template-rows: 0fr;
  margin-top: 8px;
  transition: grid-template-rows 420ms var(--ease-out), opacity 300ms ease;
  opacity: 0;
}
.panel[data-open] .sheet { grid-template-rows: 1fr; opacity: 1; }
.sheet > div { overflow: hidden; min-height: 0; }
.card {
  border-radius: 14px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: blur(22px) saturate(190%);
  backdrop-filter: blur(22px) saturate(190%);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.32), inset 0 0 0 1px var(--hairline);
  width: min(480px, calc(100vw - 24px));
}
.out {
  max-height: min(340px, 46vh);
  overflow: auto;
  padding: 12px 14px 4px;
  font-weight: 450;
  line-height: 1.5;
  user-select: text;
  -webkit-user-select: text;
  scrollbar-width: thin;
}
.out:empty { display: none; }
.out h1, .out h2, .out h3 { font-size: 13.5px; margin: 10px 0 4px; }
.out p { margin: 0 0 8px; }
.out ul, .out ol { margin: 0 0 8px; padding-left: 20px; }
.out li { margin: 2px 0; }
.out code { padding: 1px 5px; border-radius: 5px; background: rgba(255, 255, 255, 0.1); font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
.out pre { padding: 8px 10px; border-radius: 8px; background: rgba(0, 0, 0, 0.3); overflow: auto; }
.out pre code { padding: 0; background: none; }
.out a { color: #9db7ff; }
.out .err { color: #ff9aa8; }
.out .caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  margin-left: 2px;
  vertical-align: -2px;
  border-radius: 2px;
  background: linear-gradient(180deg, #8fb0ff, #c08bff);
  animation: ml-caret 1s steps(2) infinite;
}
@keyframes ml-caret { 50% { opacity: 0; } }
.thinking { display: flex; gap: 5px; padding: 4px 0 10px; }
.thinking i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #a9bcff;
  animation: ml-bounce 1.1s var(--ease-out) infinite;
}
.thinking i:nth-child(2) { animation-delay: 0.14s; }
.thinking i:nth-child(3) { animation-delay: 0.28s; }
@keyframes ml-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: 0.5; } 30% { transform: translateY(-5px); opacity: 1; } }
.ask {
  position: relative;
  display: flex;
  padding: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.ask input {
  flex: 1;
  min-width: 0;
  height: 34px;
  padding: 0 40px 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.07);
  color: #fff;
  font: inherit;
  outline: none;
  transition: border-color 160ms ease, background 160ms ease;
}
.ask input::placeholder { color: rgba(255, 255, 255, 0.45); }
.ask input:focus { border-color: rgba(124, 155, 255, 0.7); background: rgba(255, 255, 255, 0.1); }
.ask .send {
  position: absolute;
  right: 12px;
  top: 12px;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 8px;
  background: linear-gradient(135deg, #6f8dff, #a66bff);
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.ask .send svg { width: 14px; height: 14px; }
.notice { padding: 10px 14px; color: rgba(255, 255, 255, 0.78); }
.notice a { color: #9db7ff; cursor: pointer; text-decoration: underline; }

/* ───────────────────────── hover button ───────────────────────── */
.hbtn {
  position: absolute;
  left: 0;
  top: 0;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--glass);
  -webkit-backdrop-filter: blur(14px) saturate(180%);
  backdrop-filter: blur(14px) saturate(180%);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3), inset 0 0 0 1px rgba(255, 255, 255, 0.18);
  color: #fff;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0;
  scale: 0.6;
  transition: opacity 180ms ease, scale 340ms var(--ease-spring), background 160ms ease;
}
.hbtn.fixed { position: fixed; }
.hbtn[data-show] { opacity: 1; scale: 1; }
.hbtn:hover { background: rgba(36, 40, 60, 0.88); }
.hbtn:active { scale: 0.9; }
.hbtn svg { width: 18px; height: 18px; position: relative; }
.hbtn::before {
  content: '';
  position: absolute;
  inset: -1.5px;
  border-radius: 50%;
  background: var(--spectrum);
  -webkit-mask: radial-gradient(circle, transparent calc(50% - 1.5px), #000 calc(50% - 1px));
  mask: radial-gradient(circle, transparent calc(50% - 1.5px), #000 calc(50% - 1px));
  opacity: 0;
  transition: opacity 200ms ease;
  animation: ml-spin 2.4s linear infinite;
}
.hbtn:hover::before, .hbtn[data-busy]::before { opacity: 1; }

/* ───────────────────────── picker ───────────────────────── */
.pick {
  position: fixed;
  left: 0;
  top: 0;
  border-radius: 8px;
  box-shadow: 0 0 0 2px rgba(130, 160, 255, 0.95), 0 0 0 6px rgba(130, 160, 255, 0.22), 0 0 34px rgba(130, 160, 255, 0.4);
  background: rgba(130, 160, 255, 0.08);
  pointer-events: none;
  opacity: 0;
  transition:
    transform 180ms var(--ease-out),
    width 180ms var(--ease-out),
    height 180ms var(--ease-out),
    opacity 160ms ease;
}
.pick.on { opacity: 1; }
.pick.any { box-shadow: 0 0 0 2px rgba(255, 190, 90, 0.95), 0 0 0 6px rgba(255, 190, 90, 0.22), 0 0 34px rgba(255, 190, 90, 0.35); }
.pick-label {
  position: absolute;
  left: -2px;
  bottom: calc(100% + 8px);
  padding: 4px 8px;
  border-radius: 7px;
  background: var(--glass-strong);
  color: #fff;
  font: 600 11px/1.2 var(--ui);
  white-space: nowrap;
}
.hint {
  position: fixed;
  left: 50%;
  top: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-radius: 999px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), inset 0 0 0 1px var(--hairline);
  color: #fff;
  font: 600 12.5px/1.2 var(--ui);
  white-space: nowrap;
  opacity: 0;
  transform: translate(-50%, -12px);
  transition: opacity 220ms ease, transform 420ms var(--ease-spring);
  pointer-events: none;
}
.hint.on { opacity: 1; transform: translate(-50%, 0); }
.hint kbd {
  padding: 1px 6px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.14);
  font: 600 11px/1.4 var(--ui);
}

/* ───────────────────────── toast ───────────────────────── */
.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  max-width: min(440px, calc(100vw - 32px));
  padding: 10px 16px;
  border-radius: 14px;
  background: var(--glass-strong);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.32), inset 0 0 0 1px var(--hairline);
  color: #fff;
  font: 500 13px/1.4 var(--ui);
  opacity: 0;
  transform: translate(-50%, 12px) scale(0.96);
  transition: opacity 220ms ease, transform 460ms var(--ease-spring);
  pointer-events: auto;
}
.toast.on { opacity: 1; transform: translate(-50%, 0) scale(1); }

/* ───────────────────────── reduced motion ───────────────────────── */
.root.reduced .beam,
.root.reduced .cells,
.root.reduced .comet,
.root.reduced .flash,
.root.reduced .hl::after { display: none; }
.root.reduced .spin,
.root.reduced .orb::before,
.root.reduced .hbtn::before { animation: none; }
.root.reduced .hl { animation: ml-fade 200ms ease both !important; }
@keyframes ml-fade { from { opacity: 0; } to { opacity: 1; } }
`;
