# Changelog

## 1.3.0 (2026-11-05)

First public release.

- **Chromium version.** Works in Chrome, Edge and other Chromium browsers (Manifest V3), next to the Firefox and Zen version (Manifest V2).
- **UWords TR, an English-Turkish edition.** Same extension, with Tureng, Google Translate and Sesli Sözlük as its tabs. Inflected words fall back to their base form (*walked* → *walk*), and Turkish words get English meanings.
- **Clickable text.** A double-click now also works on links, buttons, labels, tabs, menu items and anything else with a pointer cursor, without activating them. Their single clicks wait ¼ second to tell the two apart; this can be turned off in the settings.
- **Works on more sites:**
  - words are found from layout geometry, so `user-select: none`, shadow DOM (open and closed), `<input type="submit">` buttons and text under transparent overlays all work
  - listeners run before any page script, so a site can't hide its clicks
  - the panel uses the top layer, so it appears above modal dialogs and fullscreen video
  - frames without a URL (`srcdoc`, `about:blank`) run the extension; a frame too small for the panel opens it in the top frame
  - PDFs in iframes open in the viewer too
- Alt+click works on links in Firefox, which fires no `click` event for it.
- Esc in the panel no longer also closes a dialog behind it. Clicks inside the panel no longer reach the page.
- Project: English docs and code, MIT license, a cross-platform build (`scripts/build.mjs` replaces `build.ps1`), unit and end-to-end tests, CI. Packages are now named `uwords-<version>-<platform>`.

## 1.2.1 (2026-10-18)

- Hovering captions no longer pauses the video; only pressing a word does. The "pause while the pointer is on the captions" setting is gone.

## 1.2.0 (2026-10-17)

- Frosted-glass panel.
- A click on the video while the panel is open only closes the panel.
- PDFs on your computer: the viewer asks for the file once, and offers a way back to the browser's own viewer. "Open PDF…" button in the toolbar popup.

## 1.1.0 (2026-10-17)

- YouTube captions: hover underline, click to look up, video pauses until the panel closes.
- PDFs open in a bundled pdf.js viewer with lookups.

## 1.0.0 (2026-10-17)

- Click a word on a page to see its Cambridge Dictionary, Merriam-Webster and MW Simple entries in a popup. Toolbar popup with search and settings, context menu for phrases.
