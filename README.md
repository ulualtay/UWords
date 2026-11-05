# UWords

A dictionary extension for Zen (and Firefox). Click a word to see its **Cambridge Dictionary**, **Merriam-Webster** and Merriam-Webster **Simple Definition** (Learner's Dictionary) entries in tabs, in a small frosted-glass popup. It works on regular pages, in **YouTube captions** and in **PDFs**.

## Features

- **Three tabs:** Cambridge · Merriam-Webster · MW Simple
- Pronunciation (UK/US IPA) and 🔊 audio
- CEFR levels (A1–C2), example sentences, inflections, phrasal verbs
- Suggestions for words that aren't found. Words without a Simple Definition say so clearly.
- Words with apostrophes: *what's*, *don't*, *they'll* are looked up directly. A possessive (*teacher's*) without its own entry shows the base word (*teacher*).
- Move to another word inside the popup: click a suggestion chip, or double-click a word in a definition
- Right-click → **Look up “…” with UWords** (for selected phrases, e.g. *give up*)
- Toolbar button: search box, on/off switch, per-site off switch and settings
- Settings: trigger (double-click / Alt+click / single click), opening tab, number of examples, theme (system/light/dark)
- The popup lives in a Shadow DOM, so site CSS can't affect it. Esc or a click outside closes it. Typing in the popup doesn't trigger the site's keyboard shortcuts.

### YouTube captions

- Hovering a caption word draws a **yellow underline** that grows from its middle outwards; **clicking** opens the dictionary popup.
- The video stops **the moment a word is pressed**. It stays paused while the popup is open and resumes when it closes.
- Hovering never pauses the video; only clicking does.
- While the popup is open, clicking the video only closes the popup; it doesn't toggle playback or (on double-click) fullscreen.
- Also works in fullscreen and on other sites that embed YouTube.
- Caption support and pause-on-click can be turned off separately in the settings.

### PDF

- PDFs you open from the web open in a bundled copy of Mozilla's pdf.js viewer, the same interface as Firefox's own viewer. Double-click a word there to open the dictionary popup.
- PDFs sent as downloads (`Content-Disposition: attachment`) are left alone.
- **PDFs on your computer:** Zen doesn't let extensions read `file://` files. When you open a local PDF, the tab switches to the UWords viewer and you choose the file once with the **Choose “file.pdf”…** button (or drop it onto the window). The **Open in Zen’s own PDF viewer instead** link takes you back to Zen's own viewer. The **Open PDF…** button in the toolbar popup opens a PDF too.
- This redirect can be turned off in the settings; PDFs then open in Firefox's own viewer again.

## Installation (Zen)

### Permanent install (recommended)

Zen doesn't enforce Mozilla's signing requirement, so an unsigned extension can be installed:

1. `about:config` → `xpinstall.signatures.required` → **false**
2. Build the package (or use a ready-made `dist/uwords-<version>.xpi`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\build.ps1
   ```
3. `about:addons` → ⚙️ → **Install Add-on From File…** → `dist/uwords-<version>.xpi`

After changing the code, run `build.ps1` again and reinstall the same way.

### Temporary install (for development)

`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → `manifest.json`.
It's removed when the browser closes. Press **Reload** after code changes.

## How it works

| File | Role |
|---|---|
| `background/background.js` | Downloads dictionary pages, caches them, plays audio, manages the context menu, redirects PDFs to the viewer |
| `background/parse-cambridge.js` | Parses the `dictionary.cambridge.org/search/english/direct/?q=…` page |
| `background/parse-merriam.js` | Parses the `merriam-webster.com/dictionary/…` and `/simple/…` pages |
| `ui/panel.js`, `ui/panel.css` | The result panel (shared by the in-page popup, the toolbar popup and the PDF viewer) |
| `content/content.js` | Catches clicks and finds the clicked word |
| `content/youtube.js` | Hover, underline, click and video pausing in YouTube captions |
| `pdf/viewer-glue.js` | Connects the pdf.js viewer to UWords (opens documents via `?src=`) |
| `pdfjs/` | Mozilla pdf.js v6.4.299 (Apache 2.0, `pdfjs/LICENSE`); source maps and the sample PDF removed, en-US locale only |
| `popup/` | The toolbar popup (search and settings) |

The Simple Definition comes from `/simple/<word>` when MW's full definition page has a "Simple Definition" button. That button only exists for words in the Learner's Dictionary.

On YouTube, the word is found without relying on YouTube's mouse events, by checking whether the pointer is inside the caption box and the word rectangles. That's why it rarely breaks when the player's internals change.

The extension doesn't use an official API; it parses the sites' HTML. If the sites change their design, the parsers (`parse-*.js`) may need updating.

## Limitations

- Content scripts don't run on the browser's internal pages (`about:`), the add-on store or reader view. Use the search box in the toolbar popup there.
- Extensions can't read `file://` URLs, so you choose a local PDF once each time you open it (see above).
- Cambridge's firewall blocks requests with an apostrophe in the query. The extension therefore turns it into a hyphen, the site's own convention (`what's` → `what-s`).
- PDFs embedded in pages (iframe/embed) aren't redirected, only PDFs opened directly in a tab.
- Double-clicking in text fields is ignored on purpose.
