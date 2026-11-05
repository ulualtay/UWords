'use strict';

/*
 * The Chromium service worker. It has no DOM, so lookups and audio are forwarded to
 * an offscreen document; everything else happens here. It can be stopped between any
 * two events, so listeners are registered at the top level and nothing important
 * lives only in memory.
 */

importScripts('../common/edition.js', '../common/settings.js', 'core.js', 'pdf-rules.js');

// ---------- offscreen document ----------

const OFFSCREEN_PATH = 'offscreen/offscreen.html';
let offscreenCheck = null;

// Checking and creating are one step: a profile may only have one such document.
function ensureOffscreen() {
  offscreenCheck ??= (async () => {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['DOM_PARSER', 'AUDIO_PLAYBACK'],
      justification: 'Parses dictionary pages into entries and plays pronunciation audio.',
    });
  })().finally(() => { offscreenCheck = null; });
  return offscreenCheck;
}

async function askOffscreen(msg) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
}

// ---------- messaging ----------

function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'lookup':
    case 'play':
      return askOffscreen(msg);
    case 'show-in-top':
      return uwShowInTopFrame(msg, sender);
    case 'native-pdf':
      // Nothing to prepare: going back in history is recognized in onCommitted below.
      return Promise.resolve({ ok: true });
    default:
      return undefined;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target === 'offscreen') return undefined;
  const pending = handleMessage(msg, sender);
  if (!pending) return undefined;
  pending.then(sendResponse, err => sendResponse({ status: 'error', ok: false, message: String(err?.message || err) }));
  return true; // the answer comes asynchronously
});

// ---------- web PDFs ----------

async function syncPdfRules() {
  await uwSettingsLoaded;
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: UW_PDF_RULE_IDS,
    addRules: uwSettings.pdfViewer ? uwPdfRedirectRules(UW_VIEWER_URL) : [],
  });
}

syncPdfRules();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.pdfViewer) syncPdfRules();
});

// ---------- local PDFs ----------

// Network rules don't see file:// URLs, so the tab is sent to the viewer once the
// navigation commits. Back/forward and reload are left alone: that keeps the back
// button working, and it is how the viewer's "browser's own viewer" link gets through.
chrome.webNavigation.onCommitted.addListener(async details => {
  if (details.frameId !== 0) return;
  if (details.transitionQualifiers.includes('forward_back') || details.transitionType === 'reload') return;
  await uwSettingsLoaded;
  if (!uwSettings.pdfViewer) return;
  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  const url = encodeURIComponent(details.url);
  chrome.tabs.update(details.tabId, { url: `${UW_VIEWER_URL}?${allowed ? 'src' : 'local'}=${url}` });
}, { url: [{ schemes: ['file'], originAndPathMatches: '(?i)\\.pdf$' }] });

// ---------- context menu ----------

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create(uwMenuProperties(), () => void chrome.runtime.lastError);
});
chrome.contextMenus.onClicked.addListener(uwOnMenuClicked);
