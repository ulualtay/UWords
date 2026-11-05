'use strict';

/*
 * Background logic shared by the Firefox background page and the Chromium service
 * worker. No DOM in here: a service worker has none.
 */

const UW_VIEWER_URL = browser.runtime.getURL('pdfjs/web/uwords-viewer.html');
const UW_MENU_ID = 'uwords-lookup';

// ---------- settings ----------

let uwSettings = { ...UW_DEFAULTS };
// A service worker wakes up for an event with nothing loaded: wait for this before reading uwSettings.
const uwSettingsLoaded = uwLoadSettings().then(s => { uwSettings = s; });

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    uwSettings[key] = newValue === undefined ? UW_DEFAULTS[key] : newValue;
  }
});

// ---------- context menu ----------

function uwMenuProperties() {
  return {
    id: UW_MENU_ID,
    title: `Look up “%s” with ${browser.runtime.getManifest().name}`,
    contexts: ['selection'],
  };
}

function uwOnMenuClicked(info, tab) {
  if (info.menuItemId !== UW_MENU_ID || !tab) return;
  const msg = { type: 'show', query: info.selectionText };
  if ((info.pageUrl || tab.url || '').startsWith(UW_VIEWER_URL)) {
    // Our own PDF viewer is an extension page: no content script to message.
    browser.runtime.sendMessage({ ...msg, targetTabId: tab.id }).catch(() => {});
    return;
  }
  browser.tabs.sendMessage(tab.id, msg, { frameId: info.frameId || 0 })
    .catch(() => { /* page without our content script (internal pages, web stores...) */ });
}

// ---------- frames too small for the panel ----------

// A word in a tiny iframe opens the panel in the top frame instead.
async function uwShowInTopFrame(msg, sender) {
  if (!sender.tab) return { ok: false };
  try {
    await browser.tabs.sendMessage(sender.tab.id,
      { type: 'show', query: msg.query, screen: msg.screen }, { frameId: 0 });
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
}
