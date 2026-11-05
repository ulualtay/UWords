'use strict';

/*
 * The lookup pipeline: fetching, caching, inflection fallbacks and pronunciation
 * audio. It needs a DOM (DOMParser, Audio), so it runs in the Firefox background
 * page and in the Chromium offscreen document, never in a service worker.
 *
 * The edition's background/sources.js provides UW_LOOKUPS and UW_AUDIO_HOSTS.
 * Each source is { run(query) } and may add:
 *   resolvesVia  id of a source whose entry this one follows
 *   baseForms    (query) => other forms to try when `run` finds nothing usable
 */

const UW_FETCH_TIMEOUT_MS = 15000;
const UW_CACHE_LIMIT = 150;

// ---------- small LRU of in-flight / finished lookups ----------

const uwCache = new Map();

function uwCached(key, producer) {
  if (uwCache.has(key)) {
    const hit = uwCache.get(key);
    uwCache.delete(key);
    uwCache.set(key, hit);
    return hit;
  }
  const promise = producer();
  uwCache.set(key, promise);
  // Don't remember failures (network hiccups, rate limits...).
  promise.then(r => { if (r.status === 'error') uwCache.delete(key); }, () => uwCache.delete(key));
  while (uwCache.size > UW_CACHE_LIMIT) uwCache.delete(uwCache.keys().next().value);
  return promise;
}

// ---------- fetching ----------

class UWHttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}`);
    this.status = status;
    this.url = url;
  }
}

async function uwFetch(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UW_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Timed out: the site did not respond.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function uwFetchDoc(url, { allow404 = false } = {}) {
  const res = await uwFetch(url, {
    credentials: 'include',
    headers: { Accept: 'text/html,application/xhtml+xml' },
  });
  if (!res.ok && !(allow404 && res.status === 404)) throw new UWHttpError(res.status, url);
  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // Cloudflare / bot-check interstitial
  if (/just a moment|attention required/i.test(doc.title)) throw new UWHttpError(403, url);
  return { status: res.status, url: res.url, doc };
}

async function uwFetchJson(url) {
  const res = await uwFetch(url, { credentials: 'omit', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new UWHttpError(res.status, url);
  return res.json();
}

function uwDescribeError(err) {
  if (err instanceof UWHttpError) {
    if (err.status === 429) return 'The site is limiting requests (HTTP 429). Try again in a while.';
    if (err.status === 403 || err.status === 503) {
      return `The site blocked the request (HTTP ${err.status}). Open it once in a tab, then try again.`;
    }
    return `The site returned an error (HTTP ${err.status}).`;
  }
  if (err instanceof TypeError) return 'Could not connect. Check your internet connection.';
  return err.message || String(err);
}

// ---------- lookup ----------

// "teacher's", "they'll": when the form itself has no entry, fall back to the stem.
function uwApostropheStem(q) {
  const m = /^(.+?)'(s|re|ve|ll|d|m)$/.exec(q);
  return m ? m[1] : null;
}

// Other forms of the word worth trying, given what the query itself returned.
async function uwFallbackForms(impl, q, result) {
  const forms = [];
  const stem = uwApostropheStem(q);
  if (stem) {
    // A search can land on a different entry ("teacher's" -> "teacher's pet").
    const exact = r => r.status === 'ok' && r.entries.some(e => uwNormalizeQuery(e.headword) === q);
    const missing = (result.status !== 'error' && !exact(result) && result.status !== 'unavailable') ||
      (impl.resolvesVia && result.status === 'unavailable' && !exact(await UW_LOOKUPS[impl.resolvesVia].run(q)));
    if (missing) forms.push(stem);
  }
  if (impl.baseForms && (result.partial || result.status === 'notfound')) forms.push(...impl.baseForms(q));
  return forms;
}

async function uwLookup(source, rawQuery) {
  const q = uwNormalizeQuery(rawQuery);
  const impl = UW_LOOKUPS[source];
  if (!impl) return { status: 'error', message: `Unknown source: ${source}` };
  if (!q) return { status: 'error', message: 'Empty query.' };

  let query = q;
  let result = await impl.run(q);
  for (const form of await uwFallbackForms(impl, q, result)) {
    const other = await impl.run(form);
    if (other.status === 'ok' && !other.partial) {
      result = other;
      query = form;
      break;
    }
  }
  // Hand out a copy without internal fields.
  const { internal, partial, ...rest } = result;
  return { ...rest, source, query, resolvedFrom: query !== q ? q : undefined };
}

// ---------- pronunciation audio ----------

let uwCurrentAudio = null;

// UW_AUDIO_HOSTS entries match exactly; a leading dot matches any subdomain.
function uwAudioHostAllowed(hostname) {
  return UW_AUDIO_HOSTS.some(h => (h.startsWith('.') ? hostname.endsWith(h) : hostname === h));
}

async function uwPlayAudio(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !uwAudioHostAllowed(u.hostname)) throw new Error('Audio URL not allowed');
  const res = await fetch(u.href, { credentials: 'include' });
  if (!res.ok) throw new UWHttpError(res.status, u.href);
  const objectUrl = URL.createObjectURL(await res.blob());
  if (uwCurrentAudio) uwCurrentAudio.pause();
  const audio = new Audio(objectUrl);
  uwCurrentAudio = audio;
  const release = () => URL.revokeObjectURL(objectUrl);
  audio.addEventListener('ended', release, { once: true });
  audio.addEventListener('error', release, { once: true });
  await audio.play();
}

// ---------- messaging ----------

// Answers the messages that need a DOM; undefined means "not one of mine".
function uwHandleDictionaryMessage(msg) {
  switch (msg && msg.type) {
    case 'lookup':
      return uwLookup(msg.source, msg.query);
    case 'play':
      return uwPlayAudio(msg.url).then(() => ({ ok: true }), err => ({ ok: false, message: uwDescribeError(err) }));
    default:
      return undefined;
  }
}
