'use strict';

/*
 * Parses a Sesli Sözlük page (seslisozluk.net/<word>-nedir-ne-demek/) into the shared
 * result shape (see docs/ARCHITECTURE.md). Every dictionary on the page is a panel
 * titled with its language pair, holding a list of <dd class="ordered-list">.
 */

const SESLI_MEDIA = 'https://static.seslisozluk.net/';

// Translations first, whatever order the page uses.
const SESLI_DICTIONARIES = {
  'İngilizce - Türkçe': { title: 'English → Turkish', rank: 0, lang: 'tr', translates: true },
  'Türkçe - İngilizce': { title: 'Turkish → English', rank: 1, lang: 'en', translates: true },
  'Türkçe - Türkçe': { title: 'Turkish definitions', rank: 2, lang: 'tr', translates: false },
  'İngilizce - İngilizce': { title: 'English definitions', rank: 3, lang: 'en', translates: false },
};

// Grammar marks like {f}, in the abbreviations the other sources use.
const SESLI_POS = { i: 'n.', f: 'v.', s: 'adj.', z: 'adv.', e: 'prep.', b: 'conj.', k: 'abbr.' };

function parseSesli(doc) {
  const dictionaries = [];
  for (const body of doc.querySelectorAll('.panel-body.sozluk')) {
    const info = SESLI_DICTIONARIES[uwText(body.closest('.panel')?.querySelector('.panel-title'))];
    if (!info) continue;
    const senses = [...body.querySelectorAll('dd.ordered-list')].map(dd => sesliSense(dd, info.lang)).filter(Boolean);
    if (senses.length) dictionaries.push({ info, senses, headword: uwText(body.querySelector('dfn')) });
  }
  dictionaries.sort((a, b) => a.info.rank - b.info.rank);

  const entries = dictionaries.map(({ info, senses, headword }, i) => ({
    headword,
    pos: info.title,
    inflections: '',
    prons: i === 0 ? sesliProns(doc) : [],
    groups: [{ title: '', senses }],
    collapsed: i > 0,
    moreLabel: `Show {count} from ${info.title}`,
  }));
  return { entries, exact: dictionaries.some(d => d.info.translates) };
}

function sesliSense(dd, lang) {
  const clone = dd.cloneNode(true);
  clone.querySelectorAll('var, p').forEach(n => n.remove());
  const def = uwText(clone);
  if (!def) return null;

  const labels = [...dd.querySelectorAll(':scope > var.pos')]
    .map(v => uwText(v).replace(/[{}]/g, ''))
    .map(mark => SESLI_POS[mark] || mark);
  labels.push(...[...dd.querySelectorAll(':scope > var.category')].map(v => uwText(v).replace(/^\((.*)\)$/, '$1')));

  // Each <p> holds a sentence pair; the English side comes first, as in the other tabs.
  const examples = [...dd.querySelectorAll(':scope > p')].map(p => {
    const sides = [...p.querySelectorAll('q')];
    sides.sort((a, b) => (a.getAttribute('lang') === 'en' ? 0 : 1) - (b.getAttribute('lang') === 'en' ? 0 : 1));
    return { lead: '', text: sides.map(uwText).filter(Boolean).join(' — ') };
  }).filter(e => e.text);

  return { num: '', level: '', labels, phrase: '', def, lang, notes: [], examples, subs: [] };
}

// listen_word('uk','pronunciation/en/uk/e/ead8….mp3','pronunciation_en_uk')
function sesliProns(doc) {
  const prons = [];
  for (const a of doc.querySelectorAll('#pronun-buttons a[onclick]')) {
    const m = /listen_word\('(\w+)','([^']+\.mp3)'/.exec(a.getAttribute('onclick'));
    if (m) prons.push({ label: m[1].toUpperCase(), text: '', audio: SESLI_MEDIA + m[2] });
  }
  return prons;
}
