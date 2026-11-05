'use strict';

const MW_AUDIO_BASE = 'https://media.merriam-webster.com/audio/prons';

// Parses a Merriam-Webster /dictionary/ or /simple/ page (both share the same markup)
// into the shared result shape (see parse-cambridge.js).
function parseMerriam(doc) {
  return [...doc.querySelectorAll('[id^="dictionary-entry-"]')]
    // Only main entries; kids/medical/legal sections use other id prefixes.
    .filter(el => /^dictionary-entry-\d+$/.test(el.id))
    .map(merriamEntry)
    .filter(e => e.groups.length);
}

function merriamEntry(el) {
  const header = el.querySelector('.entry-header') || el;
  const headword = uwText(header.querySelector('.hword'));
  const pos = uwText(header.querySelector('.parts-of-speech') || header.querySelector('.important-blue-link'));

  const prons = [];
  const seen = new Set();
  for (const a of el.querySelectorAll('.entry-attr .prons-entry-list-item')) {
    const text = uwText(a).replace(/[,;]$/, '');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const { file, dir, lang } = a.dataset;
    prons.push({
      label: '',
      text,
      audio: file && dir
        ? `${MW_AUDIO_BASE}/${(lang || 'en_us').replace('_', '/')}/mp3/${dir}/${file}.mp3`
        : null,
    });
  }

  const inflections = uwUnique([...el.querySelectorAll('.header-ins .if')].map(uwText)).join('; ');

  const groups = [];
  for (const vg of el.querySelectorAll('.vg')) {
    const title = uwText(vg.querySelector(':scope > .vd'));
    let items = [...vg.querySelectorAll('.vg-sseq-entry-item')];
    if (!items.length) items = [vg];
    const senses = [];
    for (const item of items) {
      const label = item === vg ? '' : uwText(item.querySelector(':scope > .vg-sseq-entry-item-label'));
      item.querySelectorAll('.sense').forEach((s, i) => {
        const sense = merriamSense(s, i === 0 ? label : '');
        if (sense) senses.push(sense);
      });
    }
    if (senses.length) groups.push({ title, senses });
  }

  // Inflected-form entries ("ran": past tense of RUN) have no senses, only a cross-reference.
  if (!groups.length) {
    const senses = [...el.querySelectorAll('.cxl-ref')].map(ref => ({
      num: '', level: '', labels: [], phrase: '', notes: [], examples: [], subs: [],
      def: uwText(ref),
      refs: uwUnique([...ref.querySelectorAll('.cxt')].map(uwText)),
    })).filter(s => s.def);
    if (senses.length) groups.push({ title: '', senses });
  }

  return { headword, pos, inflections, prons, groups };
}

function merriamSense(sense, itemLabel) {
  const sn = sense.querySelector(':scope > .sn');
  const num = [itemLabel, uwText(sn?.querySelector('.letter')), uwText(sn?.querySelector('.sub-num'))]
    .filter(Boolean).join(' ');
  const content = sense.querySelector(':scope > .sense-content') || sense;
  const labels = [...content.children]
    .filter(c => c.matches('.badge, .lb, .sl, .sgram, .sls'))
    .map(uwText).filter(Boolean);

  const dt = content.querySelector(':scope > .dt');
  const def = mwDefText(dt);
  const examples = mwExamples(dt);
  const notes = dt ? [...dt.querySelectorAll('.unText')].map(uwText).filter(Boolean) : [];

  // "specifically: ..." / "also: ..." divided senses
  const subs = [...content.querySelectorAll(':scope > .sdsense')]
    .map(sd => ({ label: uwText(sd.querySelector('.sd')), def: mwDefText(sd), examples: mwExamples(sd) }))
    .filter(s => s.def);

  if (!def && !notes.length && !subs.length) return null;
  return { num, level: '', labels, phrase: '', def, notes, examples, subs };
}

function mwDefText(scope) {
  if (!scope) return '';
  return [...scope.querySelectorAll(':scope > .dtText')]
    .map(p => uwText(p).replace(/^:\s*/, ''))
    .filter(Boolean)
    .join('; ');
}

function mwExamples(scope) {
  if (!scope) return [];
  return [...scope.querySelectorAll('.ex-sent')]
    .map(e => ({ lead: '', text: uwText(e) }))
    .filter(e => e.text);
}

// "The word you've entered isn't in the dictionary" page (HTTP 404).
function merriamSuggestions(doc) {
  return uwUnique([...doc.querySelectorAll('.spelling-suggestion-col a')].map(uwText)).slice(0, 12);
}

// The full-definition page carries a "Simple Definition" switch only when the
// Learner's Dictionary has the word; its data-href points at /simple/<word>.
function merriamSimpleHref(doc) {
  return doc.querySelector('.simple-definitions-toggle-btn[data-href^="/simple/"]')?.dataset.href || null;
}
