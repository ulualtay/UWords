'use strict';

/*
 * The Firefox background page: a persistent page with a DOM, so lookups run right
 * here, and PDF responses can be redirected with blocking webRequest.
 * Loaded after common/*, background/lookup.js and background/core.js.
 */

// ---------- messaging ----------

browser.runtime.onMessage.addListener((msg, sender) => {
  const dictionary = uwHandleDictionaryMessage(msg);
  if (dictionary) return dictionary;
  switch (msg && msg.type) {
    case 'show-in-top':
      return uwShowInTopFrame(msg, sender);
    case 'native-pdf':
      if (/^file:\/\//.test(msg.url)) nativeUntil.set(msg.url, Date.now() + 5000);
      return Promise.resolve({ ok: true });
    default:
      return undefined;
  }
});

// ---------- web PDFs ----------

// Firefox's built-in PDF viewer is off-limits to extensions, so PDFs are redirected
// to a bundled pdf.js viewer that also runs the lookup scripts.

function viewerUrl(src) {
  return src ? `${UW_VIEWER_URL}?src=${encodeURIComponent(src)}` : UW_VIEWER_URL;
}

function headerValue(details, name) {
  const h = details.responseHeaders.find(x => x.name.toLowerCase() === name);
  return (h && h.value) || '';
}

function isPdfResponse(details) {
  const disposition = headerValue(details, 'content-disposition');
  if (/^\s*attachment/i.test(disposition)) return false; // meant to be downloaded
  const type = headerValue(details, 'content-type').split(';')[0].trim().toLowerCase();
  if (type === 'application/pdf' || type === 'application/x-pdf') return true;
  if (type === 'application/octet-stream' || type === 'binary/octet-stream') {
    return /\.pdf\b/i.test(disposition) || /\.pdf$/i.test(new URL(details.url).pathname);
  }
  return false;
}

browser.webRequest.onHeadersReceived.addListener(details => {
  if (!uwSettings.pdfViewer || details.method !== 'GET') return undefined;
  if (details.statusCode < 200 || details.statusCode > 299 || !isPdfResponse(details)) return undefined;
  return { redirectUrl: viewerUrl(details.url) };
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame'] }, ['blocking', 'responseHeaders']);

// ---------- local PDFs ----------

// Extensions can't read file:// URLs (webRequest doesn't even see them), so the tab
// is sent to the viewer, which asks the user to pick the file. "Open in the browser's
// own PDF viewer" goes back in history; that load is let through (for a few seconds,
// since the same URL change can be reported more than once).
const nativeUntil = new Map();

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const url = changeInfo.url;
  if (!url || !uwSettings.pdfViewer || !/^file:\/\/.+\.pdf$/i.test(url.split(/[?#]/)[0])) return;
  if (Date.now() < (nativeUntil.get(url) || 0)) return;
  browser.tabs.update(tabId, { url: `${UW_VIEWER_URL}?local=${encodeURIComponent(url)}` });
}, { urls: ['file:///*'], properties: ['url'] });

// ---------- context menu ----------

browser.contextMenus.create(uwMenuProperties());
browser.contextMenus.onClicked.addListener(uwOnMenuClicked);
