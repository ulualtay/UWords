import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, plain } from './helpers.mjs';

const { get } = loadScripts([
  'editions/en-tr/common/edition.js',
  'src/common/settings.js',
  'editions/en-tr/background/parse-google.js',
  'editions/en-tr/background/sources.js',
]);
const baseForms = word => plain(get('englishBaseForms')(word));

test('base forms of inflected English words, best guess first', () => {
  assert.equal(baseForms('walked')[0], 'walk');
  assert.equal(baseForms('stopped')[0], 'stop');
  assert.equal(baseForms('hoped')[0], 'hope');
  assert.equal(baseForms('studies')[0], 'study');
  assert.equal(baseForms('studied')[0], 'study');
  assert.equal(baseForms('boxes')[0], 'box');
  assert.equal(baseForms('houses')[0], 'house');
  assert.equal(baseForms('running')[0], 'run');
  assert.equal(baseForms('making')[0], 'make');
  assert.equal(baseForms('quickly')[0], 'quick');
  assert.equal(baseForms('happily')[0], 'happy');
});

test('base forms are limited, and only for plain English words', () => {
  assert.ok(baseForms('walked').length <= 3);
  assert.deepEqual(baseForms('run'), []);
  assert.deepEqual(baseForms('koşmak'), []);
  assert.deepEqual(baseForms('give up'), []);
  assert.ok(!baseForms('kisses').includes('kisse') || baseForms('kisses')[0] === 'kiss');
});

const GOOGLE_RESPONSE = {
  sentences: [{ trans: 'koşmak', orig: 'run' }, { src_translit: 'rən' }],
  dict: [{ pos: 'verb', entry: [{ word: 'koşmak', reverse_translation: ['run', 'jog'] }, { word: 'çalıştırmak', reverse_translation: ['run', 'operate'] }] }],
  definitions: [{ pos: 'verb', entry: [{ gloss: 'move fast', example: 'the dog ran' }, { example: 'no gloss, skipped' }] }],
  src: 'en',
};

test('Google: translation, meanings by part of speech, definitions kept for later', () => {
  const parse = get('parseGoogle');
  const [main, definitions] = plain(parse(GOOGLE_RESPONSE, 'run', { audio: 'https://audio.example/run', targetLang: 'tr' }));
  assert.equal(main.headword, 'run');
  assert.deepEqual(main.prons, [{ label: '', text: '/rən/', audio: 'https://audio.example/run' }]);
  assert.equal(main.groups[0].senses[0].def, 'koşmak');
  assert.equal(main.groups[1].title, 'verb');
  assert.equal(main.groups[1].senses[1].def, 'çalıştırmak');
  assert.deepEqual(main.groups[1].senses[1].notes, ['run, operate']);
  assert.equal(main.groups[1].senses[1].lang, 'tr');
  assert.equal(definitions.collapsed, true);
  assert.equal(definitions.groups[0].senses.length, 1);
  assert.equal(definitions.groups[0].senses[0].examples[0].text, 'the dog ran');
});

test('Google: an echoed word counts as no result', () => {
  const hasResult = get('googleHasResult');
  assert.equal(hasResult({ sentences: [{ trans: 'Kitap' }] }, 'kitap'), false);
  assert.equal(hasResult({ sentences: [{ trans: 'book' }] }, 'kitap'), true);
  assert.equal(hasResult({ sentences: [{ trans: 'x' }], dict: [{ pos: 'noun', entry: [] }] }, 'x'), true);
  assert.equal(hasResult({}, 'x'), false);
});

test('Google: spelling corrections become suggestions', () => {
  const spelling = get('googleSpelling');
  assert.deepEqual(plain(spelling({ spell: { spell_res: 'receive' } })), ['receive']);
  assert.deepEqual(plain(spelling({ spell: {} })), []);
  assert.deepEqual(plain(spelling({})), []);
});

test('Google: URLs carry the direction and the escaped word', () => {
  const urls = get('googleUrls')("don't stop", 'en', 'tr');
  assert.match(urls.api, /sl=en&tl=tr/);
  assert.match(urls.api, /q=don't%20stop$/);
  assert.match(urls.page, /^https:\/\/translate\.google\.com\/\?sl=en&tl=tr&text=don't%20stop/);
  assert.match(urls.audio, /tl=en&q=don't%20stop$/);
});
