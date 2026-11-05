'use strict';

/* Loaded after common/edition.js (UW_SOURCES). */

// Chromium exposes the WebExtension API only as `chrome.*`, which returns promises
// in Manifest V3 just like Firefox's `browser.*`. Tested through `.runtime` because
// a page element with id="browser" also shows up as a global in content scripts.
if (!globalThis.browser?.runtime) globalThis.browser = globalThis.chrome;

const UW_DEFAULTS = Object.freeze({
  enabled: true,
  trigger: 'dblclick',     // 'dblclick' | 'alt-click' | 'click'
  clickableText: true,     // double-click also works on links, buttons and other clickable text
  defaultTab: 'last',      // a source id from UW_SOURCES, or 'last'
  lastTab: UW_SOURCES[0].id,
  maxExamples: 2,
  theme: 'auto',           // 'auto' | 'light' | 'dark'
  disabledSites: [],
  ytCaptions: true,        // hover/click words in YouTube captions
  ytPauseOnLookup: true,   // pause the video while the panel is open
  pdfViewer: true,         // open PDFs in the UWords viewer
});

async function uwLoadSettings() {
  const stored = await browser.storage.local.get(Object.keys(UW_DEFAULTS));
  return { ...UW_DEFAULTS, ...stored };
}

function uwSaveSettings(patch) {
  return browser.storage.local.set(patch);
}

// runtime.sendMessage throws instead of rejecting in a content script that an
// extension update left behind (Chromium keeps those running).
function uwSend(message) {
  try {
    return browser.runtime.sendMessage(message);
  } catch (err) {
    return Promise.reject(err);
  }
}

// Normalizes what the user clicked/typed into a lookup key.
function uwNormalizeQuery(text) {
  return String(text || '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
    .replace(/İ/g, 'i') // plain toLowerCase() would leave a combining dot behind
    .toLowerCase();
}

// A single Latin-script word (allowing inner apostrophes/hyphens).
function uwIsWord(text) {
  return text.length > 0 && text.length <= 40 && /^\p{Script=Latin}[\p{Script=Latin}\p{M}'\-]*$/u.test(text);
}

// A short phrase for explicit lookups (context menu, search box).
function uwIsPhrase(text) {
  return text.length > 0 && text.length <= 60 && text.split(' ').length <= 6 &&
    text.split(' ').every(uwIsWord);
}
