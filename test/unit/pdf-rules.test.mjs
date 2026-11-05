import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, plain } from './helpers.mjs';

const { get } = loadScripts(['platforms/chromium/background/pdf-rules.js']);
const VIEWER = 'chrome-extension://abc/pdfjs/web/uwords-viewer.html';
const rules = plain(get('uwPdfRedirectRules')(VIEWER));

test('one rule per id, all redirecting to the viewer with the whole URL', () => {
  assert.deepEqual(rules.map(r => r.id), plain(get('UW_PDF_RULE_IDS')));
  for (const rule of rules) {
    assert.equal(rule.action.redirect.regexSubstitution, `${VIEWER}?src=\\0`);
    assert.deepEqual(rule.condition.requestMethods, ['get']);
    assert.ok(rule.condition.resourceTypes.includes('main_frame'));
    assert.ok(rule.condition.excludedResponseHeaders.some(h => h.header === 'content-disposition' && h.values[0] === 'attachment*'));
  }
});

test('the regular expressions match what they claim', () => {
  const [declared, byUrl] = rules.map(r => new RegExp(r.condition.regexFilter, 'i'));
  assert.ok(declared.test('https://example.com/any/path?x=1'));
  assert.ok(!declared.test('ftp://example.com/a.pdf'));
  assert.ok(byUrl.test('https://example.com/a.pdf'));
  assert.ok(byUrl.test('https://example.com/a.PDF?download=0&x=1'));
  assert.ok(!byUrl.test('https://example.com/a.pdf.zip'));
  assert.ok(!byUrl.test('https://example.com/page?file=a.pdf'));
});

test('a generic-binary response named .pdf is matched only if the type is generic', () => {
  const named = rules[2].condition;
  assert.deepEqual(named.responseHeaders, [{ header: 'content-disposition', values: ['*.pdf*'] }]);
  const typeCondition = named.excludedResponseHeaders.find(h => h.header === 'content-type');
  assert.ok(typeCondition.excludedValues.includes('application/octet-stream*'));
});
