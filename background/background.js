'use strict';

/* Loaded after common/settings.js, dom-utils.js, parse-cambridge.js, parse-merriam.js */

const CAMBRIDGE = 'https://dictionary.cambridge.org';
const MW = 'https://www.merriam-webster.com';
const FETCH_TIMEOUT_MS = 15000;
const CACHE_LIMIT = 150;

// ---------- small LRU of in-flight / finished lookups ----------

const cache = new Map();

function cached(key, producer) {
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const promise = producer();
  cache.set(key, promise);
  // Don't remember failures (network hiccups, rate limits...).
  promise.then(r => { if (r.status === 'error') cache.delete(key); }, () => cache.delete(key));
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return promise;
}

// ---------- fetching ----------

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
  }
}

async function fetchDoc(url, { allow404 = false } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      credentials: 'include',
      signal: ctrl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    if (!res.ok && !(allow404 && res.status === 404)) throw new HttpError(res.status, url);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Cloudflare / bot-check interstitial
    if (/just a moment|attention required/i.test(doc.title)) throw new HttpError(403, url);
    return { status: res.status, url: res.url, doc };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timed out: the site did not respond.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function describeError(err) {
  if (err instanceof HttpError) {
    if (err.status === 403 || err.status === 429 || err.status === 503) {
      return `The site blocked the request (HTTP ${err.status}). Open it once in a tab, then try again.`;
    }
    return `The site returned an error (HTTP ${err.status}).`;
  }
  if (err instanceof TypeError) return 'Could not connect. Check your internet connection.';
  return err.message || String(err);
}

// ---------- sources ----------

function cambridgeUrl(q) {
  // Cambridge's firewall answers 403 to any apostrophe in the query; the site
  // itself spells them as hyphens (what's -> /what-s, don't -> /don-t).
  const slug = q.replace(/'/g, '-');
  return `${CAMBRIDGE}/search/english/direct/?q=${encodeURIComponent(slug).replace(/%20/g, '+')}`;
}

function mwUrl(q) {
  return `${MW}/dictionary/${encodeURIComponent(q)}`;
}

async function lookupCambridge(q) {
  const page = cambridgeUrl(q);
  try {
    const { url, doc } = await fetchDoc(page);
    if (url.includes('/spellcheck/')) {
      return { status: 'notfound', url, suggestions: cambridgeSuggestions(doc) };
    }
    const entries = parseCambridge(doc, url);
    if (!entries.length) return { status: 'notfound', url: page, suggestions: [] };
    return { status: 'ok', url, entries };
  } catch (err) {
    return { status: 'error', url: page, message: describeError(err) };
  }
}

// Full MW page; also reports whether a "Simple Definition" page exists.
function lookupMerriam(q) {
  return cached(`mw:${q}`, async () => {
    const page = mwUrl(q);
    try {
      const { status, url, doc } = await fetchDoc(page, { allow404: true });
      if (status === 404) {
        return { status: 'notfound', url, suggestions: merriamSuggestions(doc) };
      }
      const entries = parseMerriam(doc);
      if (!entries.length) return { status: 'notfound', url, suggestions: [] };
      const simpleHref = merriamSimpleHref(doc);
      return { status: 'ok', url, entries, simpleUrl: simpleHref ? new URL(simpleHref, MW).href : null };
    } catch (err) {
      return { status: 'error', url: page, message: describeError(err) };
    }
  });
}

async function lookupMerriamSimple(q) {
  const full = await lookupMerriam(q);
  if (full.status === 'error') return full;
  if (full.status !== 'ok' || !full.simpleUrl) {
    return { status: 'unavailable', url: full.url };
  }
  try {
    const { url, doc } = await fetchDoc(full.simpleUrl);
    // /simple/<word> redirects back to /dictionary/<word> when there is no simple entry.
    if (!url.includes('/simple/')) return { status: 'unavailable', url };
    const entries = parseMerriam(doc);
    if (!entries.length) return { status: 'unavailable', url };
    return { status: 'ok', url, entries };
  } catch (err) {
    return { status: 'error', url: full.simpleUrl, message: describeError(err) };
  }
}

const LOOKUPS = {
  cambridge: q => cached(`cambridge:${q}`, () => lookupCambridge(q)),
  mw: lookupMerriam,
  mwSimple: q => cached(`mwSimple:${q}`, () => lookupMerriamSimple(q)),
};

// "teacher's", "they'll": when the form itself has no entry, fall back to the stem.
function stemOf(q) {
  const m = /^(.+?)'(s|re|ve|ll|d|m)$/.exec(q);
  return m ? m[1] : null;
}

async function lookup(source, rawQuery) {
  const q = uwNormalizeQuery(rawQuery);
  if (!LOOKUPS[source]) return { status: 'error', message: `Unknown source: ${source}` };
  if (!q) return { status: 'error', message: 'Empty query.' };
  let query = q;
  let result = await LOOKUPS[source](q);
  const stem = stemOf(q);
  if (stem) {
    // A search can land on a different entry ("teacher's" -> "teacher's pet").
    const exact = r => r.status === 'ok' && r.entries.some(e => uwNormalizeQuery(e.headword) === q);
    // For Simple Definition, follow what the full MW lookup resolved to.
    const missing = (result.status !== 'error' && !exact(result) && result.status !== 'unavailable') ||
      (source === 'mwSimple' && result.status === 'unavailable' && !exact(await LOOKUPS.mw(q)));
    if (missing) {
      const fallback = await LOOKUPS[source](stem);
      if (fallback.status === 'ok') {
        result = fallback;
        query = stem;
      }
    }
  }
  // Hand out a copy without internal fields.
  const { simpleUrl, ...rest } = result;
  return { ...rest, source, query, resolvedFrom: query !== q ? q : undefined };
}

// ---------- pronunciation audio ----------

const AUDIO_HOSTS = ['dictionary.cambridge.org', 'media.merriam-webster.com'];
let currentAudio = null;

async function playAudio(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !AUDIO_HOSTS.includes(u.hostname)) throw new Error('Audio URL not allowed');
  const res = await fetch(u.href, { credentials: 'include' });
  if (!res.ok) throw new HttpError(res.status, u.href);
  const objectUrl = URL.createObjectURL(await res.blob());
  if (currentAudio) currentAudio.pause();
  const audio = new Audio(objectUrl);
  currentAudio = audio;
  const release = () => URL.revokeObjectURL(objectUrl);
  audio.addEventListener('ended', release, { once: true });
  audio.addEventListener('error', release, { once: true });
  await audio.play();
}

// ---------- messaging ----------

browser.runtime.onMessage.addListener(msg => {
  switch (msg && msg.type) {
    case 'lookup':
      return lookup(msg.source, msg.query);
    case 'play':
      return playAudio(msg.url).then(() => ({ ok: true }), err => ({ ok: false, message: describeError(err) }));
    case 'native-pdf':
      if (/^file:\/\//.test(msg.url)) nativeUntil.set(msg.url, Date.now() + 5000);
      return Promise.resolve({ ok: true });
    default:
      return undefined;
  }
});

// ---------- settings ----------

let settings = { ...UW_DEFAULTS };
uwLoadSettings().then(s => { settings = s; });
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const [key, { newValue }] of Object.entries(changes)) {
    settings[key] = newValue === undefined ? UW_DEFAULTS[key] : newValue;
  }
});

// ---------- PDF viewer ----------

// Firefox's built-in PDF viewer is off-limits to extensions, so web PDFs are
// redirected to a bundled pdf.js viewer that also runs the UWords content script.
const VIEWER_URL = browser.runtime.getURL('pdfjs/web/uwords-viewer.html');

function viewerUrl(src) {
  return src ? `${VIEWER_URL}?src=${encodeURIComponent(src)}` : VIEWER_URL;
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
  if (!settings.pdfViewer || details.method !== 'GET') return undefined;
  if (details.statusCode < 200 || details.statusCode > 299 || !isPdfResponse(details)) return undefined;
  return { redirectUrl: viewerUrl(details.url) };
}, { urls: ['http://*/*', 'https://*/*'], types: ['main_frame'] }, ['blocking', 'responseHeaders']);

// Local PDFs: extensions can't read file:// URLs (webRequest doesn't even see
// them), so the tab is sent to the viewer, which asks the user to pick the file.
// "Open in Zen's viewer" goes back in history; that load is let through (for a
// few seconds, since Zen reports the same URL change more than once).
const nativeUntil = new Map();

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const url = changeInfo.url;
  if (!url || !settings.pdfViewer || !/^file:\/\/.+\.pdf$/i.test(url.split(/[?#]/)[0])) return;
  if (Date.now() < (nativeUntil.get(url) || 0)) return;
  browser.tabs.update(tabId, { url: `${VIEWER_URL}?local=${encodeURIComponent(url)}` });
}, { urls: ['file:///*'], properties: ['url'] });

// ---------- context menu ----------

browser.contextMenus.create({
  id: 'uwords-lookup',
  title: 'Look up “%s” with UWords',
  contexts: ['selection'],
});

browser.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'uwords-lookup' || !tab) return;
  const msg = { type: 'show', query: info.selectionText };
  if (tab.url && tab.url.startsWith(VIEWER_URL)) {
    // Our own PDF viewer is an extension page: no content script to message.
    browser.runtime.sendMessage({ ...msg, targetTabId: tab.id }).catch(() => {});
    return;
  }
  browser.tabs.sendMessage(tab.id, msg, { frameId: info.frameId || 0 })
    .catch(() => { /* page without our content script (about:, add-ons store...) */ });
});
