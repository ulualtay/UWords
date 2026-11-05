'use strict';

/*
 * Turns the JSON of Google Translate's public "gtx" endpoint (dj=1, named fields) into
 * the shared result shape (see docs/ARCHITECTURE.md). No DOM involved.
 */

const GOOGLE_TERMS_PER_POS = 12;

// Whether the response actually translated the word rather than echoing it back.
function googleHasResult(data, query) {
  const translation = googleTranslation(data);
  return (data.dict || []).length > 0 || (!!translation && translation.toLowerCase() !== query.toLowerCase());
}

function googleTranslation(data) {
  return (data.sentences || []).map(s => s.trans || '').join('').trim();
}

function googleSpelling(data) {
  const corrected = data.spell && data.spell.spell_res;
  return corrected ? [corrected] : [];
}

function googleSense(fields) {
  return { num: '', level: '', labels: [], phrase: '', def: '', notes: [], examples: [], subs: [], ...fields };
}

// `audio` is the pronunciation URL; `targetLang` the language of the translations.
function parseGoogle(data, query, { audio, targetLang }) {
  const translit = (data.sentences || []).find(s => s.src_translit)?.src_translit;
  const groups = [{ title: '', senses: [googleSense({ def: googleTranslation(data), lang: targetLang })] }];
  for (const { pos, entry } of data.dict || []) {
    groups.push({
      title: pos,
      senses: (entry || []).slice(0, GOOGLE_TERMS_PER_POS).map(term => googleSense({
        def: term.word,
        lang: targetLang,
        notes: term.reverse_translation?.length ? [term.reverse_translation.slice(0, 5).join(', ')] : [],
      })),
    });
  }

  const entries = [{
    headword: query,
    pos: '',
    inflections: '',
    prons: [{ label: '', text: translit ? `/${translit}/` : '', audio }],
    groups,
  }];

  const definitions = (data.definitions || []).map(({ pos, entry }) => ({
    title: pos,
    senses: (entry || []).filter(d => d.gloss).map(d => googleSense({
      def: d.gloss,
      examples: d.example ? [{ lead: '', text: d.example }] : [],
    })),
  })).filter(g => g.senses.length);
  if (definitions.length) {
    entries.push({
      headword: 'Definitions',
      pos: '',
      inflections: '',
      prons: [],
      groups: definitions,
      collapsed: true,
      moreLabel: 'Show {count} definitions',
    });
  }
  return entries;
}
