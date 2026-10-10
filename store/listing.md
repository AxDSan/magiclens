# Store listings

Everything the four store dashboards ask for, in one place. Images: `npm run store:assets`
writes them to `store/assets/`. Firefox metadata for the API lives in `amo-metadata.json`.

| | URL |
| --- | --- |
| Homepage | https://axdsan.github.io/magiclens/ |
| Privacy policy | https://axdsan.github.io/magiclens/privacy/ |
| Terms of use | https://axdsan.github.io/magiclens/terms/ |
| Support | https://github.com/AxDSan/magiclens/issues |
| Donations | https://ko-fi.com/axdsan |
| Source | https://github.com/AxDSan/magiclens (Apache-2.0) |

## Text

**Name:** MagicLens

**Summary** (Chrome 132 chars max; this is the manifest description, 88 chars):
Read, select, translate and explain the text inside any image, right where it appears.

**Description** (plain text for Chrome, Edge and Opera; AMO takes the Markdown in
`amo-metadata.json`):

```text
MagicLens reads the text inside images on any web page and lays it back over the image, exactly where the original letters are, so you can select it, copy it, translate it or ask about it like normal page text.

HOW TO USE IT
• Hover an image and click the lens button, or right-click it and choose "Read text in image".
• Alt+Shift+L reads the main image on the page; Alt+Shift+K lets you pick any element.
• Drag to select, double-click a word, or copy everything with clean spaces and line breaks.

LOCAL FIRST
• Tesseract and PaddleOCR run entirely in your browser. Nothing leaves your device and no account is needed.
• English and PaddleOCR are built in; 29 more Tesseract languages download once when you turn them on.

OPTIONAL AI, YOUR OWN KEY
• Translate the text in place, painted over the original like a printed page in your language.
• Explain, summarize or ask questions about the image.
• Hybrid mode lets a vision model correct the OCR while keeping exact word positions.
• Works with OpenAI, Claude, Gemini, OpenRouter, Groq, Mistral, xAI, Together, or a local model through Ollama or LM Studio. Images go only to the provider you choose, only when you ask.

PRIVACY
The developer collects nothing: no server, no account, no analytics, no ads.
Full policy: https://axdsan.github.io/magiclens/privacy/

MagicLens is free and open source (Apache-2.0). Support it on Ko-fi: https://ko-fi.com/axdsan
```

**Category:** Chrome: Tools · Edge: Productivity · Opera: Productivity · AMO: Language
Support, Photos, Music & Videos.

**Language:** English.

## Images

| File | Chrome | Edge | AMO | Opera |
| --- | --- | --- | --- | --- |
| `1-reading.png` … `5-settings.png` (1280x800) | Screenshots (1-5) | Screenshots | Screenshots | Screenshots |
| `promo-small-440x280.png` | Small promo tile (required) | Small promotional tile | | |
| `promo-marquee-1400x560.png` | Marquee promo tile | Large promotional tile | | |
| `logo-300x300.png` | | Extension logo (required) | | |

The 128px store icon comes from the package on every store.

## Chrome Web Store: Privacy tab

**Single purpose:**
MagicLens makes the text inside images on web pages usable: it recognizes the text and lays it
over the image so the user can select, copy, translate or ask about it.

**Permission justifications:**

| Permission | Justification |
| --- | --- |
| `storage` | Saves the user's settings and the API key they enter, locally on the device. |
| `contextMenus` | Adds "Read text in image" and "Read text here with MagicLens" to the right-click menu. |
| `activeTab` | Starts MagicLens on the current tab from the toolbar popup, keyboard shortcut or context menu, and takes a screenshot of the visible tab to read canvases, videos and images the page will not let the extension download. |
| `scripting` | Injects the content script into tabs that were open before MagicLens was installed or updated, so the lens works there without a page reload. |
| `offscreen` | Runs the OCR engine (WebAssembly in a Web Worker), which a service worker cannot start. |
| `declarativeNetRequestWithHostAccess` | Removes the Origin header only from MagicLens's own requests to the local AI server address the user configures (for example Ollama on localhost), so local models work without server changes. It changes no other requests. |
| Host permission `<all_urls>` | Shows the lens button on images on any site the user visits and downloads the image the user asked to read from its original address when the page does not expose its pixels. |

**Remote code:** No, I am not using remote code. (All code, WebAssembly and the English and
PaddleOCR models ship in the package. Optional Tesseract language files downloaded later are
model data, not code.)

**Data usage:** tick **Website content** (the image being read and its text, sent only to the
AI provider the user configures, only when they ask) and **Authentication information** (the
user's own API key, stored locally and sent only to that provider). Tick all three
certifications: not sold to third parties, not used for purposes unrelated to the single
purpose, not used for creditworthiness or lending.

**Privacy policy URL:** https://axdsan.github.io/magiclens/privacy/

## Edge Add-ons

Same package as Chrome (`magiclens-<version>-edge.zip`), same description and privacy URL.
Edge asks whether the extension uses personal information: yes, with the same explanation as
the Chrome data usage above.

**Notes for certification:**

```text
No account or key is needed to test. Open any page with an image, hover the image and click the round lens button in its corner: local OCR (Tesseract, bundled) reads the text and makes it selectable in place. AI features (Translate, Explain, Ask) need the user's own provider key or a local model and are optional. Source: https://github.com/AxDSan/magiclens
```

## Opera Add-ons

Upload `magiclens-<version>-opera.zip`. Opera reviewers ask for readable sources of bundled or
minified code: link https://github.com/AxDSan/magiclens and attach
`magiclens-<version>-sources.zip`, with the build steps from `amo-metadata.json`
(`version.approval_notes`). Use the same certification note as Edge.

## Firefox Add-ons (AMO)

`npm run submit:firefox:first` creates the listing through the API with `amo-metadata.json`
and uploads the sources archive. Afterwards, on the AMO edit page, set:
- **Support site:** https://github.com/AxDSan/magiclens/issues (not settable through the API)
- **Privacy policy:** paste `PRIVACY.md`
- **Screenshots:** `store/assets/1-5`
