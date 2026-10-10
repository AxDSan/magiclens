# MagicLens Privacy Policy

Effective October 9, 2026

MagicLens is a browser extension that reads the text inside images on the web pages you visit. This policy explains what happens to your data when you use it.

**Short version:** the developer of MagicLens collects nothing. There is no MagicLens server, no account, no analytics, no telemetry, and no ads. Everything you read stays in your browser unless you connect an AI provider of your own, and then it goes only to that provider.

## What the developer collects

Nothing. MagicLens has no backend. The developer never receives, stores, sells, or shares your images, the text read from them, your settings, your API keys, your browsing history, or any identifier.

## What stays on your device

- **Images and recognized text.** With the Local OCR engine (Tesseract or PaddleOCR), images are read entirely inside your browser.
- **Screenshots.** To read a canvas, a video frame, a CSS background, or an image the page will not let it download, MagicLens takes a screenshot of the visible tab with the browser's own screenshot API. The screenshot is used only for that read.
- **Settings and API keys.** They are saved in your browser's local extension storage on this device. They are not synced to other devices and never leave the browser except as described below.
- **OCR language data.** Downloaded language files are cached in your browser so they download only once.

Removing the extension deletes its settings, keys, and cached data.

## When MagicLens connects to the network

MagicLens makes network requests only in these cases, and only to the destinations listed:

1. **Downloading the image you asked it to read.** When the image itself cannot be read in the page, MagicLens downloads it again from the same address the page loaded it from, with the same cookies your browser already sends to that site.
2. **Extra OCR languages.** English and PaddleOCR are bundled. If you turn on another Tesseract language, its data file is downloaded once from the jsDelivr CDN (`cdn.jsdelivr.net`). Only the file is requested; no image or text is sent.
3. **The AI provider you configure (bring your own key).** If you choose the Hybrid or AI engine, or use Translate, Explain, Summarize, or Ask, MagicLens sends the image you are reading, the text recognized in it, and your question directly from your browser to the provider you selected, using your own API key. Nothing is sent until you start a read or ask something. Supported providers include OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, xAI, Together AI, a local server such as Ollama or LM Studio, or any address you enter. That provider's own privacy policy and terms govern what it does with the data. The developer of MagicLens has no access to these requests or your account with the provider.

Local OCR alone makes none of the requests in item 3.

On Firefox, choosing a cloud AI provider asks for the browser's built-in consent to share website content before anything is sent.

## Permissions

- **Access to all websites:** show the lens button on images, read images and page elements where you ask, and download images the page will not share.
- **`activeTab` and `scripting`:** start MagicLens in a tab when you use the toolbar button, keyboard shortcut, or context menu.
- **`contextMenus`:** add "Read text in image" to the right-click menu.
- **`storage`:** save your settings and API keys on this device.
- **`declarativeNetRequestWithHostAccess`:** remove the `Origin` header only from MagicLens's own requests to the local AI server address you configure (such as Ollama), so it works without server changes. Other sites and web pages are not affected.
- **`offscreen` (Chromium browsers):** run the OCR engine in a background document.

## Support links

The extension contains a link to the developer's Ko-fi page. Ko-fi is a separate service that MagicLens never contacts. If you open the link or donate, Ko-fi's own privacy policy applies.

## Children

MagicLens is not directed at children and collects no data from anyone.

## Changes

If this policy changes, the new version will be published with the effective date updated. Because MagicLens collects nothing, a change cannot apply to data collected earlier.

## Contact

Questions about this policy: send the developer a message through [Ko-fi](https://ko-fi.com/axdsan).
