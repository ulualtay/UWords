'use strict';

// Parses a Cambridge Dictionary entry page into the shared result shape:
// [{ headword, pos, inflections, prons: [{label, text, audio}],
//    groups: [{ title, senses: [{ num, level, labels, phrase, def, notes, examples, subs }] }] }]
function parseCambridge(doc, pageUrl) {
  const dicts = [...doc.querySelectorAll('.pr.dictionary')];
  // cald4 = Cambridge Advanced Learner's Dictionary; fall back to whatever comes first
  // (American / Business English) when the word only exists there.
  const dict = dicts.find(d => d.dataset.id === 'cald4') || dicts[0];
  if (!dict) return [];
  return [...dict.querySelectorAll('.entry-body__el')]
    .map(el => cambridgeEntry(el, pageUrl))
    .filter(e => e.groups.length);
}

function cambridgeEntry(el, pageUrl) {
  const header = el.querySelector('.pos-header') || el;
  const headword = uwText(el.querySelector('.headword'));
  // Phrasal verb / idiom blocks have no .posgram, just a bare .pos ("phrasal verb").
  const pos = uwUnique([...header.querySelectorAll('.posgram')].map(uwText)).join(', ')
    || uwText(el.querySelector('.pos'));

  const prons = [];
  const seen = new Set();
  for (const p of header.querySelectorAll('.dpron-i')) {
    const label = uwText(p.querySelector('.region')).toUpperCase();
    const ipa = uwText(p.querySelector('.ipa'));
    const src = p.querySelector('source[type="audio/mpeg"]')?.getAttribute('src');
    const key = label + '|' + ipa;
    if ((!ipa && !src) || seen.has(key)) continue;
    seen.add(key);
    prons.push({
      label,
      text: ipa ? `/${ipa}/` : '',
      audio: src ? new URL(src, pageUrl).href : null,
    });
  }

  const inflections = [...header.querySelectorAll('.inf-group')].map(uwText).join(', ');

  const groups = [];
  let current = null;
  for (const block of el.querySelectorAll('.def-block')) {
    const senseEl = block.closest('.dsense');
    const title = senseEl
      ? uwText(senseEl.querySelector('.guideword')).replace(/^\((.*)\)$/, '$1')
      : '';
    if (!current || current.title !== title) {
      current = { title, senses: [] };
      groups.push(current);
    }
    const sense = cambridgeSense(block);
    if (sense) current.senses.push(sense);
  }

  return { headword, pos, inflections, prons, groups: groups.filter(g => g.senses.length) };
}

function cambridgeSense(block) {
  const def = uwText(block.querySelector('.ddef_h .def')).replace(/\s*:$/, '');
  if (!def) return null;

  const info = block.querySelector('.ddef_h .def-info');
  let level = '';
  const labels = [];
  if (info) {
    level = uwText(info.querySelector('.epp-xref'));
    const rest = info.cloneNode(true);
    rest.querySelectorAll('.epp-xref').forEach(n => n.remove());
    const text = uwText(rest);
    if (text) labels.push(text);
  }

  const phraseBlock = block.closest('.phrase-block');
  const phrase = phraseBlock ? uwText(phraseBlock.querySelector('.phrase-title')) : '';

  const examples = [...block.querySelectorAll(':scope > .def-body > .examp')]
    .map(ex => ({
      lead: uwText(ex.querySelector('.lu')),
      text: [uwText(ex.querySelector(':scope > .gram')), uwText(ex.querySelector('.eg'))]
        .filter(Boolean).join(' '),
    }))
    .filter(ex => ex.text);

  return { num: '', level, labels, phrase, def, notes: [], examples, subs: [] };
}

// Suggestions on Cambridge's /spellcheck/ page.
function cambridgeSuggestions(doc) {
  return uwUnique([...doc.querySelectorAll('a[href*="/search/english/direct/"]')].map(uwText)).slice(0, 12);
}
