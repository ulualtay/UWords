# Decisions

The significant choices made in this project, why, and what else was considered. Newest first. When a decision changes, add a new entry and mark the old one as replaced, rather than rewriting history.

## 14. End-to-end tests run headless, muted and offline

**Why:** a test run must not disturb the person running it: an earlier version opened windows and played real audio during a work session, which is not acceptable. And each double-click means up to three lookups, so test runs were sending hundreds of requests to the dictionary sites, enough to get rate-limited.

So browsers run headless with audio muted (`--mute-audio`; `media.volume_scale`, since Firefox plays sound even when headless), behind a proxy that isn't there unless `--live` is given. The test site is on localhost, which browsers don't send through a proxy.

**With `--live` on Chromium** the headless browser reports the user agent it would have with a window, because the sites' bot protection challenges the headless one, which real users never have. The volume is one person's occasional test run.

**Considered:** a window placed off-screen: still shows up in the taskbar, and can take the focus. Mocking the dictionary sites by intercepting requests: more machinery, and no extra coverage over the parser fixtures.

## 13. Open source under the MIT license

**Why:** the maintainer's other public project (UPlayer) uses it, and it's compatible with everything bundled here. pdf.js and its components keep their own licenses (see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)).

**Considered:** GPL or Apache 2.0. Neither gives anything this project needs.

## 12. One repository for both editions

**Why:** the editions share about 95% of their code: panel, click handling, YouTube, PDF viewer, build, tests. A fix belongs in both, and one repository makes that automatic. Each edition is still its own extension with its own name, icon, ID and package.

**Considered:**
- Two repositories, or a fork. Every fix would have to be made twice, and they would drift apart.
- One extension with a "dictionary set" setting. Simpler to distribute, but it was asked for as a separate version, and this keeps each one's permissions, name and store listing focused.

**Consequence:** with both editions installed in one profile, a double-click opens two panels. Install one per profile, or give them different triggers.

## 11. The EN-TR sources: Tureng, Google Translate and Sesli Sözlük

The brief was Tureng plus the two other most used translation sites.

**Why these:**
- Google Translate is the most used translator by far.
- For the third place, no Turkey-wide traffic ranking was publicly available. Sesli Sözlük is the next dictionary with a public figure (about 2.4 million visits in July 2025 by Semrush; Tureng about 7.3 million in February 2026), and Turkish "best translation sites" lists name these three most consistently.
- All three can actually be read from a browser extension.

**Considered:**
- Yandex Translate: answers automated requests with a captcha page, and its dictionary endpoint rejects requests without a session.
- DeepL: its web API has anti-abuse measures and quickly returns 429. Its official API needs a key.
- Reverso Context: Cloudflare challenges even more readily.
- Zargan, Glosbe, Cambridge's English-Turkish dictionary: reachable and possible future sources, but less used for this purpose.

**About Google:** the `client=gtx` endpoint is public but unofficial. The official API requires a billing account, which can't be asked of extension users. It answers bursts with HTTP 429, as test runs showed, so its tab is only asked when opened (`lazy`), which keeps normal use well below that. If it does limit or stops working, only that one tab is affected.

## 10. English base-form guessing in the EN-TR edition

**Why:** clicking running text mostly hits inflected forms, and Tureng and Sesli Sözlük often have no translation for those (*walked* only gives phrases). The panel already had a way to say "No entry for X. Showing Y".

**Considered:**
- A real lemmatizer: a large dictionary to bundle, for a problem where a wrong guess only costs one more "not found" request.
- Asking Google for the base form: an extra dependency on the unofficial endpoint.

The English edition doesn't need this: Cambridge and Merriam-Webster resolve inflections themselves.

## 9. Double-click on clickable text holds the click for 250 ms

The request: lookups must work on any clickable text. The first click of a double-click would already follow the link or press the button, so it has to wait.

**Why:** the same gesture everywhere is what people expect; they try double-clicking a link and it should just work. The hold applies only to clicks that land on a word in something clickable: no modifier keys, keyboard activation, icons or empty space. It can be turned off with a setting.

**The cost:** clicks on clickable text take 250 ms longer. A replayed click is `isTrusted: false`, which a rare site may ignore; for such a site, a per-site off switch and the setting exist.

**Considered:**
- Press and hold: no delay and no replay, but a gesture nobody would guess, and it collides with dragging links.
- Alt+click only: already existed, and doesn't answer the request by default. It's still there as a trigger.
- Letting the first click through and cancelling the navigation on the second: can't undo a new tab, a client-side route change or a pressed button ("Delete").
- Holding every click: would slow down the whole web, for no gain on plain text.

Single-click mode can't also apply to clickable text, or nothing could be clicked anymore; there, clickable text takes a double-click.

## 8. Find words by geometry, not by selection or caret

**Why:** to work on every site. Selections don't exist on `user-select: none`, in buttons or for text under an overlay. `caretPositionFromPoint` fails on those too and differs between browsers. The YouTube code had already shown that geometry is robust against whatever a site does to its DOM, so `words.js` generalizes it. The browser's selection is still preferred for the word itself when it exists, because it knows boundaries across inline elements.

**Considered:** keeping the selection path and adding special cases per problem. That's how the problems arose.

## 7. Listen at `document_start` on `window`, and use the top layer

**Why:** sites can stop events and can cover anything with a high z-index. Running first in the capture phase means no page listener can come before ours. The top layer is the only place above modal dialogs and fullscreen elements. A modal dialog also makes the rest of the page inert, so the panel goes inside it.

**Cost:** the scripts run on every page and frame from the start. They are small, and do nothing until a click.

**Considered:** `document_idle`, the previous setting: page scripts' window-level listeners came first, and a site could block lookups.

## 6. Chromium: an offscreen document for DOM work

**Why:** a Manifest V3 service worker has no `DOMParser` and no `Audio`. An offscreen document is the sanctioned way to get them. It keeps the parsers identical on both platforms: real DOM, same selectors.

**Considered:**
- A JavaScript HTML parser in the worker (linkedom, parse5): a dependency for the extension, and parsers would run on a different DOM than on Firefox.
- Fetching and parsing in the content script: page CORS forbids the fetch.
- Regular expressions on HTML: no.

**Consequence:** the document stays open once created, using some memory, like Firefox's persistent page. The worker checks for it before every message, so it's fine if the browser closes it.

## 5. Chromium: declarative rules on response headers for PDFs

**Why:** Manifest V3 has no blocking `webRequest`, and only response headers say whether something is a PDF. `declarativeNetRequest` can match on them since Chrome 128, which sets `minimum_chrome_version`. Mozilla's own pdf.js extension does the same.

**Consequence:** a regex substitution can't encode the URL, so the viewer receives it raw and treats everything after `?src=` as the URL. The rules hold the extension's URL, so they're created at runtime (dynamic rules), not listed in the manifest. `declarativeNetRequestWithHostAccess` suffices, which adds no permission warning.

**Considered:** a non-blocking `webRequest` listener calling `tabs.update`: races the built-in viewer, flashes it, and adds a history entry.

## 4. Manifest V2 on Firefox, Manifest V3 on Chromium

**Why:** Chromium has removed V2. Firefox keeps it with no end date, and with V2 the extension gets a persistent background page and blocking `webRequest`, a simpler design. The existing, tested Firefox behavior stays as it was.

**Considered:** V3 everywhere. Firefox's V3 uses event pages rather than service workers, so the two backgrounds would differ anyway, with more work and more risk on Firefox for no user-visible gain.

## 3. Shared `src/` with `platforms/` and `editions/` overlays

**Why:** the differences between browsers and dictionaries are few and sit in whole files. Copying layers keeps all three visible at a glance, with no `if (firefox)` scattered around and no preprocessor. A "build" is a file copy, so what runs is what's in the repository.

**Considered:**
- A bundler (webpack, Vite): no dependencies otherwise, and browser-store reviewers prefer unbundled code.
- Runtime detection in one tree: can't work for the manifests or the permissions, and ships dead code.

## 2. `browser` alias rather than webextension-polyfill

**Why:** in Manifest V3 `chrome.*` already returns promises. The only real difference left is that Chromium's `onMessage` listeners answer through `sendResponse`, handled in the Chromium entry points. A one-line alias does the rest.

**Considered:** webextension-polyfill, whose main job is the promise wrapping that's no longer needed; it would be the project's only runtime dependency.

The alias tests `browser.runtime` rather than `browser`, because a page element with `id="browser"` also appears as a global in content scripts.

## 1. No dependencies: Node's standard library for build and tests

**Why:** the project is small, and contributors should be able to clone it and run it. Node 22 has what's needed: `zlib.crc32` for the zip writer, `node:test`, a `WebSocket` client for BiDi, and pipes for CDP.

**Considered:** Puppeteer or Playwright for the tests, which are friendlier but add large dependencies and a browser download; `web-ext` for packaging, for one zip file.

`scripts/build.mjs` replaced the earlier `build.ps1` because it had to work on Linux and macOS too. Zip timestamps are fixed so builds are reproducible.
