---
title: Changelog
---

# Changelog

Notable changes to MagicLens, newest first. A build is identified by the `version` in
`package.json`; the date is the day it was cut. Every tagged build also has its packages on the
[GitHub releases page](https://github.com/AxDSan/magiclens/releases).

## 0.2.0 — 17 October 2026

### Added

- **Links in the recognized text.** URLs, `www.` hosts, bare domains (`example.com/path`),
  email addresses and IPv4 addresses now become real links laid over the image. Hovering
  highlights the clickable words and previews the destination; clicking opens it in a new tab,
  and `mailto:` hands off to the mail application.
  Trailing sentence punctuation and unmatched brackets stay outside the link, and file names
  such as `main.ts`, `setup.py`, `build.sh` or `README.md` are not mistaken for host names.
- The panel reports how many links a read found next to the line count.
- A changelog page on the site, `/changelog/`, and this section on the landing page.

## 0.1.0 — 10 October 2026

First packaged build.

### Added

- In-place text layer over images: every word is positioned on its baseline and stretched to
  the width of the original glyphs, so it can be selected and copied with clean spacing.
- Targets: `<img>` (including `srcset`, `object-fit`, `object-position`, padding, borders and
  rounded corners), `<video>` frames, `<canvas>`, inline SVG, CSS background images, or any
  element picked on the page. Elements the engine cannot download fall back to a screenshot.
- Local OCR with Tesseract (30 languages, English built in) and PaddleOCR PP-OCRv5, both
  running inside the browser with no network access.
- Optional AI: Hybrid mode corrects local OCR text while keeping exact word boxes, or reads
  the image alone. Translate in place, explain, summarize, or ask questions about the image.
  OpenAI, Claude, Gemini, OpenRouter, Groq, Mistral, xAI, Together, and Ollama / LM Studio /
  any OpenAI-compatible server.
- Triggers: hover button, right-click menu, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd> for
  the main image, <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> to pick an element.
- Processing effects that animate only `transform` and `opacity`, so the page stays responsive
  while a read runs.
- Downloaded updates are applied as soon as no read is running.
- Privacy policy and terms pages, a store kit, and the landing page with a live demo.
