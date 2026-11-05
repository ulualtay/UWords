'use strict';

const UW_DEFAULTS = Object.freeze({
  enabled: true,
  trigger: 'dblclick',     // 'dblclick' | 'alt-click' | 'click'
  defaultTab: 'last',      // 'cambridge' | 'mw' | 'mwSimple' | 'last'
  lastTab: 'cambridge',
  maxExamples: 2,
  theme: 'auto',           // 'auto' | 'light' | 'dark'
  disabledSites: [],
  ytCaptions: true,        // hover/click words in YouTube captions
  ytPauseOnLookup: true,   // pause the video while the panel is open
  pdfViewer: true,         // open PDFs in the UWords viewer
});

const UW_SOURCES = Object.freeze([
  { id: 'cambridge', label: 'Cambridge' },
  { id: 'mw', label: 'Merriam-Webster' },
  { id: 'mwSimple', label: 'MW Simple' },
]);

async function uwLoadSettings() {
  const stored = await browser.storage.local.get(Object.keys(UW_DEFAULTS));
  return { ...UW_DEFAULTS, ...stored };
}

function uwSaveSettings(patch) {
  return browser.storage.local.set(patch);
}

// Normalizes what the user clicked/typed into a lookup key.
function uwNormalizeQuery(text) {
  return String(text || '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')
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
