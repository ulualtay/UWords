import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts } from './helpers.mjs';

const { get } = loadScripts(['editions/en/common/edition.js', 'src/common/settings.js']);
const normalize = get('uwNormalizeQuery');
const isWord = get('uwIsWord');
const isPhrase = get('uwIsPhrase');

test('queries are trimmed to letters and lowercased', () => {
  assert.equal(normalize('  “Running,”  '), 'running');
  assert.equal(normalize('(Hello)'), 'hello');
  assert.equal(normalize('give   up'), 'give up');
  assert.equal(normalize(null), '');
  assert.equal(normalize('123'), '');
});

test('typographic apostrophes become plain ones', () => {
  assert.equal(normalize('don’t'), "don't");
  assert.equal(normalize('teacherʼs'), "teacher's");
});

test('Turkish letters survive, and the dotted capital I lowercases cleanly', () => {
  assert.equal(normalize('Koşmak'), 'koşmak');
  assert.equal(normalize('İstanbul'), 'istanbul');
  assert.equal(normalize('İstanbul').length, 'istanbul'.length);
});

test('words are single Latin-script tokens', () => {
  for (const word of ['run', "don't", 'well-known', 'koşmak', 'café']) assert.ok(isWord(word), word);
  for (const word of ['', 'two words', 'слово', '单词', '3d', 'x'.repeat(41)]) assert.ok(!isWord(word), word);
});

test('phrases are a few words', () => {
  assert.ok(isPhrase('give up'));
  assert.ok(!isPhrase('one two three four five six seven'));
  assert.ok(!isPhrase(''));
});

test('the default tab is the first source of the edition', () => {
  assert.equal(get('UW_DEFAULTS').lastTab, 'cambridge');
  const tr = loadScripts(['editions/en-tr/common/edition.js', 'src/common/settings.js']);
  assert.equal(tr.get('UW_DEFAULTS').lastTab, 'tureng');
});

test('the API alias survives a page element named "browser"', () => {
  const chrome = { runtime: { id: 'x' } };
  const clobbered = loadScripts(['editions/en/common/edition.js', 'src/common/settings.js'], { browser: { nodeName: 'DIV' }, chrome });
  assert.equal(clobbered.get('browser'), chrome);
  const real = { runtime: { id: 'firefox' } };
  const firefox = loadScripts(['editions/en/common/edition.js', 'src/common/settings.js'], { browser: real, chrome });
  assert.equal(firefox.get('browser'), real);
});
