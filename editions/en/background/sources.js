'use strict';

/*
 * Dictionary sources of the English edition. Loaded with the parsers, in the same
 * context as background/lookup.js.
 */

const CAMBRIDGE = 'https://dictionary.cambridge.org';
const MW = 'https://www.merriam-webster.com';

const UW_AUDIO_HOSTS = ['dictionary.cambridge.org', 'media.merriam-webster.com'];

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
    const { url, doc } = await uwFetchDoc(page);
    if (url.includes('/spellcheck/')) {
      return { status: 'notfound', url, suggestions: cambridgeSuggestions(doc) };
    }
    const entries = parseCambridge(doc, url);
    if (!entries.length) return { status: 'notfound', url: page, suggestions: [] };
    return { status: 'ok', url, entries };
  } catch (err) {
    return { status: 'error', url: page, message: uwDescribeError(err) };
  }
}

// Full MW page; also reports whether a "Simple Definition" page exists.
function lookupMerriam(q) {
  return uwCached(`mw:${q}`, async () => {
    const page = mwUrl(q);
    try {
      const { status, url, doc } = await uwFetchDoc(page, { allow404: true });
      if (status === 404) {
        return { status: 'notfound', url, suggestions: merriamSuggestions(doc) };
      }
      const entries = parseMerriam(doc);
      if (!entries.length) return { status: 'notfound', url, suggestions: [] };
      const simpleHref = merriamSimpleHref(doc);
      return { status: 'ok', url, entries, internal: { simpleUrl: simpleHref ? new URL(simpleHref, MW).href : null } };
    } catch (err) {
      return { status: 'error', url: page, message: uwDescribeError(err) };
    }
  });
}

async function lookupMerriamSimple(q) {
  const full = await lookupMerriam(q);
  if (full.status === 'error') return full;
  const simpleUrl = full.internal && full.internal.simpleUrl;
  if (full.status !== 'ok' || !simpleUrl) {
    return { status: 'unavailable', url: full.url };
  }
  try {
    const { url, doc } = await uwFetchDoc(simpleUrl);
    // /simple/<word> redirects back to /dictionary/<word> when there is no simple entry.
    if (!url.includes('/simple/')) return { status: 'unavailable', url };
    const entries = parseMerriam(doc);
    if (!entries.length) return { status: 'unavailable', url };
    return { status: 'ok', url, entries };
  } catch (err) {
    return { status: 'error', url: simpleUrl, message: uwDescribeError(err) };
  }
}

const UW_LOOKUPS = {
  cambridge: { run: q => uwCached(`cambridge:${q}`, () => lookupCambridge(q)) },
  mw: { run: lookupMerriam },
  // Whether a Simple Definition applies depends on what the full MW lookup resolved to.
  mwSimple: { run: q => uwCached(`mwSimple:${q}`, () => lookupMerriamSimple(q)), resolvesVia: 'mw' },
};
