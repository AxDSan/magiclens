# MagicLens

A browser extension that reads the text inside images and lays it back over the image, at
the exact position of the original glyphs, so you can select, copy, translate and ask about
it as if it were normal page text.

- **Any image-like element**: `<img>` (including `srcset`, `object-fit`, `object-position`,
  padding, borders, rounded corners), `<video>` frames, `<canvas>`, inline SVG, CSS
  background images, or any element you pick.
- **Local OCR, AI, or both**: Tesseract runs fully offline inside the browser. Bring your own
  key for OpenAI, Claude, Gemini, OpenRouter, Groq, Mistral, xAI, Together, or run a small
  vision model locally with Ollama / LM Studio / any OpenAI-compatible server.
- **Selectable text in place**: every word is positioned on its baseline and stretched to the
  exact width of the word in the image. Copy gives clean text with spaces and line breaks.
- **Clickable links**: URLs, bare domains, email addresses and IPv4 hosts found in the text
  become real links laid over the image — hover to see where they are, click to open them in a
  new tab. `www.` and scheme-less hosts are normalized to `https://`, addresses to `mailto:`.
- **Analysis**: explain, summarize, ask questions about the image, or translate it, with the
  translation painted over the original paragraphs, like a printed page in your language.
- **Smooth**: the processing effects (a faint spectrum ring with a highlight running clockwise
  around the frame, a soft inner glow, a light sweep, and squares pulsing outward in Game of
  Life generations) animate only `transform` and `opacity`, so they run on the compositor and
  stay fluid while the page is busy. The page's main thread sees no long tasks during a read.

Chrome, Edge, Brave, Opera, Vivaldi, Arc and other Chromium browsers, Firefox, and Safari
(through Apple's converter) are supported from one code base (Manifest V3, built with
[WXT](https://wxt.dev)).

## Install from source

Requires Node.js 20+.

```bash
npm install
```

Then download the PaddleOCR models once. Every build and `npm run dev` reads them from `.cache/`:

```bash
npm run fetch:ocr
```

| Browser | Build | Load it |
| --- | --- | --- |
| Chrome, Brave, Vivaldi, Arc | `npm run build:chrome` | `chrome://extensions` → Developer mode → **Load unpacked** → `.output/chrome-mv3` |
| Edge | `npm run build:edge` | `edge://extensions` → Developer mode → **Load unpacked** → `.output/edge-mv3` |
| Opera | `npx wxt build -b opera` | `opera://extensions` → Developer mode → **Load unpacked** → `.output/opera-mv3` |
| Firefox (140+) | `npm run build:firefox` | `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `.output/firefox-mv3/manifest.json` |
| Safari (macOS) | `npm run build:safari` | `xcrun safari-web-extension-converter .output/safari-mv3`, then build and run the generated Xcode project |

Store packages: `npm run zip:all` writes the Chrome, Edge, Opera and Firefox zips plus the
sources archive AMO reviewers ask for. Publishing is described under [Releasing](#releasing).

Development with live reload: `npm run dev` (Chrome) or `npm run dev:firefox`.

## Using it

- **Hover an image** and click the lens button in its corner. Shift-click forces AI reading,
  Alt-click forces local OCR.
- **Right-click** an image → *Read text in image*, or anywhere → *Read text here with
  MagicLens*.
- **Keyboard**: <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> reads the most prominent image in
  view; <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> lets you pick an element (hold
  <kbd>Alt</kbd> to pick any element, not just images).
- **Toolbar popup**: read the main image, pick an element, read every image in view, and
  switch engines.

Once the text is in place: drag to select, double-click a word, <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>A</kbd>
over the image selects all of it, <kbd>Esc</kbd> closes the lens. The panel under the image
has **Copy**, **Select all**, **Show text** (redraws the recognized text over the image so you
can check it), **Translate**, **Explain**, **Summarize** and **Ask**.

## Engines

| Engine | What happens | Needs |
| --- | --- | --- |
| **Local OCR** | Tesseract (WebAssembly) or PaddleOCR PP-OCRv5 mobile (ONNX Runtime Web) finds and reads every word. Choose one in the options. English ships with the extension for Tesseract; 29 other languages download once (2–15 MB each) and are cached. PaddleOCR's models are bundled, so it downloads nothing. | Nothing |
| **Hybrid** (default when a provider is set) | Local OCR finds the exact word positions; the model re-reads every line from the image and corrects the text, and adds lines OCR missed. | AI provider |
| **AI vision** | The model reads the image and returns line boxes itself. | AI provider |

Only some models are trained to report text positions. Gemini (`box_2d`) and Qwen-VL are the
most precise; Claude works in pixel coordinates; most others are approximate, which is why
Hybrid is the default. The options page has a **Test with a sample image** button that
reports how precisely the configured model places text.

### Providers

| Provider | Notes |
| --- | --- |
| Anthropic (Claude) | Uses the official SDK; default model `claude-opus-5`. |
| OpenAI | Chat Completions with image input. |
| Google Gemini | Native API; default `gemini-flash-latest`. Best text placement. |
| OpenRouter, Groq, Mistral, xAI, Together | OpenAI-compatible; pick any model with image input (**Load models** lists them). |
| Ollama (local) | `ollama pull qwen2.5vl:3b` (or `gemma3`, `minicpm-v`, `granite3.2-vision`). Works without setting `OLLAMA_ORIGINS`: MagicLens removes the `Origin` header only on its own requests to the configured Ollama host, so web pages keep Ollama's protection. |
| LM Studio (local) | Load a vision model and start the server. |
| Custom | Any OpenAI-compatible endpoint with image input. |

Keys are stored in the browser's local extension storage on this device and are never synced.

## How it works

```
content script ──port──▶ background ──▶ engine host ──▶ Tesseract worker (WASM)
  find target              routes jobs     │             └▶ LLM provider (fetch / SDK)
  plan pixels              screenshots     │
  overlay + text layer ◀── events ◀────────┘
```

- **Engine host**: Chrome's service worker cannot start the Web Worker Tesseract needs, so
  on Chromium the engine runs in an offscreen document; Firefox and Safari run it in their
  background page. Settings travel with each job (offscreen documents have no storage API).
- **Getting pixels**, cheapest first: read the already-loaded image in the page when it is
  same-origin or `blob:`; let the engine download the URL (extension pages bypass CORS); fall
  back to a screenshot of the element (`tabs.captureVisibleTab`, taken with the MagicLens UI
  hidden). Canvas, SVG, CSS backgrounds and arbitrary elements always use the screenshot, so
  what you see is exactly what gets read.
- **Geometry**: results are normalized to 0..1 of the decoded image (EXIF-oriented), then
  mapped through the element's `object-fit` / `object-position`, padding, border and CSS
  transform scale. Overlays live in one shadow root, follow the element every frame, and clip
  to scroll containers and carousels.
- **Text layer**: like PDF.js, each word is an absolutely positioned transparent span. Its
  font size comes from Tesseract's row height, its top from the detected baseline, and a
  `scaleX` makes it exactly as wide as the word in the image. Lengths are multiples of three
  CSS variables (frame width, height, aspect), so a resize updates three values and keeps the
  selection. Stretched spaces between words keep the selection highlight continuous, and a
  copy handler serializes words with real spaces and line breaks.
- **Updates**: the stores deliver them; the browser downloads them on its own schedule (the
  extension never fetches code). The background applies a downloaded update as soon as no read
  or answer is in flight, and after an install or update it injects the content script into
  tabs that were already open, so their lens button keeps working without a page reload.

## Privacy

- Local OCR runs entirely in your browser. Nothing leaves the device.
- Hybrid and AI modes send the image, and the recognized text, only to the provider you
  configured, only when you read an image or ask something.
- On Firefox, choosing a cloud provider asks for the browser's data-collection consent.

Full text: [PRIVACY.md](PRIVACY.md) and [TERMS.md](TERMS.md). The extension ships the same
files (Settings → About) on its `legal.html` page.

## Support

MagicLens is free. If it saves you time: [ko-fi.com/axdsan](https://ko-fi.com/axdsan).

## Tests

```bash
npm run typecheck
npm test              # unit: object-fit math, model-output parsing, SSE, hybrid merge
npm run test:e2e      # builds Chrome, runs Playwright with the extension loaded
npm run test:firefox  # builds Firefox, runs a headless Firefox smoke test (WebDriver BiDi)
```

The end-to-end suites render fixture images with known text at known pixel positions and
assert that every overlay word covers its ground-truth glyphs (horizontal IoU ≥ 0.6 and
vertical containment), across same-origin, cross-origin, `object-fit: contain/cover`,
canvas-by-screenshot, dark images, clipboard output, the keyboard trigger, a tab that stays
open across an extension update, and the AI paths against a mock OpenAI-compatible server
(including an Ollama-like one that refuses extension origins). They also check that the
page's main thread sees no long tasks during a read.

`VISUAL_DIR=/some/dir npx playwright test visual` saves screenshots of the animation, the
panel and the options page for a human look.

Playwright needs its own Chromium (`npx playwright install chromium`): branded Chrome no
longer loads unpacked extensions from the command line. The Firefox test uses the system
Firefox (`FIREFOX_BIN` overrides the path).

## Releasing

The stores deliver updates; browsers install them on their own, and MagicLens applies a
downloaded update as soon as no read is running. To ship a version:

1. Bump `version` in `package.json`, move the `Unreleased` section of
   [CHANGELOG.md](CHANGELOG.md) under the new version, commit, and push a matching tag
   (`v0.2.0`).
2. The `Release` workflow tests, zips, attaches the packages to a GitHub release and submits
   them to the Chrome Web Store (API v2), Edge Add-ons and AMO with `npm run submit`.
   Secrets are listed in `store/submit.env.example`; the same file, saved as `.env.submit`,
   drives `npm run zip:all && npm run submit` locally (`npm run submit:dry` checks the keys).
3. Upload the Opera zip from the release by hand: Opera has no supported publishing API.

The store APIs only update listings that exist. The first version of each listing is created
by hand from `store/listing.md` (text, permission justifications, privacy answers); Firefox's
can be created from the command line with `npm run submit:firefox:first`. `npm run
store:assets` renders the screenshots, promo tiles and logo into `store/assets/`.

The site at https://axdsan.github.io/magiclens/ is GitHub Pages: `index.html` and `web/` are
the landing page with a live demo of the lens, `_layouts/legal.html` renders
[PRIVACY.md](PRIVACY.md) at `/privacy/` and [TERMS.md](TERMS.md) at `/terms/`, and
[CHANGELOG.md](CHANGELOG.md) at `/changelog/`. The landing page also summarizes the newest
builds in its changelog section.

## Known limits

- Heavily rotated or curved text is read, but the overlay is axis-aligned per word (small
  rotations follow the baseline).
- Screenshot-based reads cover the visible part of the element; long elements are scrolled
  into view first. Elements inside cross-origin iframes can be read when they are images, not
  by screenshot.
- Vertical CJK text works best with an AI engine.
- PaddleOCR's models and runtime add about 36 MB to every build (measured: 35.7 MB of a 51.3 MB
  build). Its sessions stay loaded for the lifetime of the page; Tesseract's worker is released
  when idle.
- PaddleOCR drops lines it reads with confidence below 0.5.
- `web-ext lint` reports warnings that come from dependencies: regenerator-runtime's
  unreachable `Function()` fallback inside tesseract.js, and Preact's `innerHTML` support.

Ideas not built yet: an in-browser vision model (Florence-2 on WebGPU) and Chrome's built-in
Prompt and Translator APIs.
