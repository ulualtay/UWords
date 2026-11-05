'use strict';

/*
 * Translation sources of the English-Turkish edition. Loaded with the parsers, in the
 * same context as background/lookup.js.
 */

const UW_AUDIO_HOSTS = ['.tureng.com', 'static.seslisozluk.net', 'translate.googleapis.com'];

const TURKISH_ONLY_LETTERS = /[çğıöşü]/;

// ---------- English base forms ----------

// Tureng and Sesli Sözlük often have no translation for an inflected form ("walked"),
// and clicking running text mostly hits those. Returns likely base forms, best guess
// first. It only has to be good enough: a wrong guess is one more "not found".
function englishBaseForms(word) {
  if (!/^[a-z]{4,}$/.test(word)) return [];
  const forms = [];
  const add = form => { if (form.length >= 2 && form !== word && !forms.includes(form)) forms.push(form); };

  // "stopped" -> stop, "hoped" -> hope, "walked" -> walk
  const addVerbStem = stem => {
    if (/([b-df-hj-np-tv-z])\1$/.test(stem) && !/(ss|ll|zz)$/.test(stem)) add(stem.slice(0, -1));
    if (/[aeiou][b-df-hj-np-tv-z]$/.test(stem) && !/[aeiou]{2}[b-df-hj-np-tv-z]$/.test(stem)) add(`${stem}e`);
    add(stem);
    add(`${stem}e`);
  };

  let m;
  if ((m = /^(.+)ies$/.exec(word))) add(`${m[1]}y`);
  if ((m = /^(.+(?:ss|x|zz|ch|sh|o))es$/.exec(word))) add(m[1]); // boxes -> box
  if ((m = /^(.+[^s])s$/.exec(word))) add(m[1]); // houses -> house
  if ((m = /^(.+[sz])es$/.exec(word))) add(m[1]); // buses -> bus
  if ((m = /^(.+)ied$/.exec(word))) add(`${m[1]}y`);
  if ((m = /^(.+)ed$/.exec(word))) addVerbStem(m[1]);
  if ((m = /^(.+)ing$/.exec(word))) addVerbStem(m[1]);
  if ((m = /^(.+)ier$/.exec(word)) || (m = /^(.+)iest$/.exec(word))) add(`${m[1]}y`);
  if ((m = /^(.+)est$/.exec(word)) || (m = /^(.+)er$/.exec(word))) addVerbStem(m[1]);
  if ((m = /^(.+)ily$/.exec(word))) add(`${m[1]}y`);
  if ((m = /^(.+)ly$/.exec(word))) add(m[1]);
  return forms.slice(0, 3);
}

// ---------- Tureng ----------

async function lookupTureng(q) {
  const page = `https://tureng.com/en/turkish-english/${encodeURIComponent(q)}`;
  try {
    const { url, doc } = await uwFetchDoc(page);
    const { entries, exact } = parseTureng(doc);
    if (!entries.length) return { status: 'notfound', url, suggestions: turengSuggestions(doc) };
    return { status: 'ok', url, entries, partial: !exact };
  } catch (err) {
    return { status: 'error', url: page, message: uwDescribeError(err) };
  }
}

// ---------- Google Translate ----------

function googleUrls(q, from, to) {
  const text = encodeURIComponent(q);
  const fields = ['t', 'bd', 'rm', 'md', 'qca'].map(dt => `dt=${dt}`).join('&');
  return {
    api: `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${from}&tl=${to}&hl=en&dj=1&${fields}&q=${text}`,
    page: `https://translate.google.com/?sl=${from}&tl=${to}&text=${text}&op=translate`,
    audio: `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${from}&q=${text}`,
  };
}

// English to Turkish, unless the word can only be Turkish. A Turkish word without
// telltale letters ("kitap") comes back unchanged, which is the cue to try the other way.
async function lookupGoogle(q) {
  const first = TURKISH_ONLY_LETTERS.test(q) ? ['tr', 'en'] : ['en', 'tr'];
  const second = [...first].reverse();
  const firstUrls = googleUrls(q, ...first);
  try {
    let urls = firstUrls;
    let to = first[1];
    let data = await uwFetchJson(urls.api);
    if (!googleHasResult(data, q)) {
      const otherUrls = googleUrls(q, ...second);
      const other = await uwFetchJson(otherUrls.api);
      if (!googleHasResult(other, q)) {
        return { status: 'notfound', url: firstUrls.page, suggestions: googleSpelling(data) };
      }
      data = other;
      urls = otherUrls;
      to = second[1];
    }
    return {
      status: 'ok',
      url: urls.page,
      entries: parseGoogle(data, q, { audio: urls.audio, targetLang: to }),
      suggestions: googleSpelling(data),
    };
  } catch (err) {
    return { status: 'error', url: firstUrls.page, message: uwDescribeError(err) };
  }
}

// ---------- Sesli Sözlük ----------

async function lookupSesli(q) {
  const page = `https://www.seslisozluk.net/${encodeURIComponent(q)}-nedir-ne-demek/`;
  try {
    const { url, doc } = await uwFetchDoc(page);
    const { entries, exact } = parseSesli(doc);
    if (!entries.length) return { status: 'notfound', url, suggestions: [] };
    return { status: 'ok', url, entries, partial: !exact };
  } catch (err) {
    return { status: 'error', url: page, message: uwDescribeError(err) };
  }
}

const UW_LOOKUPS = {
  tureng: { run: q => uwCached(`tureng:${q}`, () => lookupTureng(q)), baseForms: englishBaseForms },
  google: { run: q => uwCached(`google:${q}`, () => lookupGoogle(q)) },
  sesli: { run: q => uwCached(`sesli:${q}`, () => lookupSesli(q)), baseForms: englishBaseForms },
};
