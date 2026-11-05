'use strict';

/*
 * Parses a Tureng result page (tureng.com/en/turkish-english/<term>) into the shared
 * result shape (see docs/ARCHITECTURE.md). The page has one table per kind of result,
 * each below a heading: "Meanings of "x" in Turkish English Dictionary", or
 * "... with other terms ..." for longer phrases containing the word. In every row the
 * first language-tagged cell is the searched side and the second one the meaning.
 */

// The part-of-speech box is in Turkish even on the English site.
const TURENG_POS_NAMES = [
  ['Düzensiz Fiil', 'irregular verb'],
  ['Yardımcı Fiil', 'auxiliary verb'],
  ['Fiil', 'verb'],
  ['İsim', 'noun'],
  ['Sıfat', 'adjective'],
  ['Zarf', 'adverb'],
  ['Zamir', 'pronoun'],
  ['Edat', 'preposition'],
  ['Bağlaç', 'conjunction'],
  ['Ünlem', 'interjection'],
];

function parseTureng(doc) {
  const exact = [];
  const phrases = [];
  for (const table of doc.querySelectorAll('table.searchResultsTable')) {
    const isPhrases = /with other terms/i.test(turengHeading(table));
    (isPhrases ? phrases : exact).push(...turengRows(table));
  }
  const headword = uwText(doc.querySelector('h1'));
  const entries = [];
  if (exact.length) {
    entries.push({
      headword,
      pos: '',
      inflections: turengInflections(doc),
      prons: turengProns(doc),
      groups: turengGroups(exact, headword),
    });
  }
  if (phrases.length) {
    entries.push({
      headword: `Phrases with “${headword}”`,
      pos: '',
      inflections: '',
      prons: [],
      groups: turengGroups(phrases, headword),
      collapsed: exact.length > 0,
      moreLabel: 'Show {count} phrases',
    });
  }
  return { entries, exact: exact.length > 0 };
}

function turengHeading(table) {
  let el = table.previousElementSibling;
  while (el && el.tagName !== 'H2') el = el.previousElementSibling;
  return uwText(el);
}

function turengRows(table) {
  const rows = [];
  for (const tr of table.rows) {
    if (tr.classList.contains('example-sentences-row')) {
      if (rows.length) rows[rows.length - 1].examples.push(...turengExamples(tr));
      continue;
    }
    const [term, meaning] = tr.querySelectorAll('td[lang]');
    if (!term || !meaning) continue;
    rows.push({
      category: uwText(tr.cells[1]),
      term: uwText(term.querySelector('a')),
      meaning: uwText(meaning.querySelector('a')),
      pos: uwText(term.querySelector('i')) || uwText(meaning.querySelector('i')),
      lang: meaning.getAttribute('lang'),
      examples: [],
    });
  }
  return rows;
}

// A sentence and its translation, separated by <br>, then a "More Sentences" link.
function turengExamples(tr) {
  const lines = [''];
  for (const node of tr.cells[0].childNodes) {
    if (node.nodeName === 'BR') lines.push('');
    else if (node.nodeName !== 'A') lines[lines.length - 1] += node.textContent;
  }
  const text = lines.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' — ');
  return text ? [{ lead: '', text }] : [];
}

// One group per category; rows that only differ in meaning become one line.
function turengGroups(rows, headword) {
  const key = uwNormalizeQuery(headword);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.category)) groups.set(row.category, { title: row.category, senses: [] });
    const { senses } = groups.get(row.category);
    const phrase = uwNormalizeQuery(row.term) === key ? '' : row.term;
    let sense = senses.find(s => s.phrase === phrase && (s.labels[0] || '') === row.pos);
    if (sense) {
      sense.def += `, ${row.meaning}`;
    } else {
      sense = { num: '', level: '', labels: row.pos ? [row.pos] : [], phrase, def: row.meaning, lang: row.lang, notes: [], examples: [], subs: [] };
      senses.push(sense);
    }
    sense.examples.push(...row.examples);
  }
  return [...groups.values()];
}

function turengInflections(doc) {
  let text = uwText(doc.querySelector('.td-type dd'));
  for (const [turkish, english] of TURENG_POS_NAMES) text = text.replaceAll(`${turkish}:`, `${english}:`);
  return text;
}

function turengProns(doc) {
  const ipa = uwText(doc.querySelector('.td-ipa dd'));
  const ipaOf = name => (name && (new RegExp(`${name}\\s*(/[^/]+/)`).exec(ipa) || [])[1]) || '';
  const prons = [];
  for (const [accent, region] of [['us', 'AmE'], ['uk', 'BrE'], ['au', null]]) {
    const src = doc.querySelector(`audio[id^="turengVoice"][id$="${accent}"] source`)?.getAttribute('src');
    const text = ipaOf(region);
    if (src || text) prons.push({ label: accent.toUpperCase(), text, audio: src || null });
  }
  return prons;
}

// The "Maybe the correct one is..." list on a page without results.
function turengSuggestions(doc) {
  return uwUnique([...doc.querySelectorAll('.suggestion-list a')].map(uwText)).slice(0, 12);
}
