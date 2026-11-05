// End-to-end scenarios. Each runs against a real browser with the built extension, on the
// local test site in lib/server.mjs. `only` limits a scenario to one browser family.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { samplePdf } from './lib/server.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const AFTER_HOLD_MS = 450; // long enough for a held click to be replayed

async function waitFor(check, what, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await check();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(60);
  }
  throw new Error(`Timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

const expectPanel = (d, word) => waitFor(async () => {
  const panel = await d.panel();
  return panel && panel.title === word ? panel : null;
}, `the panel for "${word}"`);

async function expectNoPanel(d, afterMs = 500) {
  await sleep(afterMs);
  assert.equal(await d.panel(), null, 'no panel should be open');
}

const locate = (d, id, fx = 0.5, fy = 0.5) => d.eval(`locate(${JSON.stringify(id)}, ${fx}, ${fy})`);

async function doubleClickWord(d, id, word) {
  const point = await locate(d, id);
  await d.dblclick(point);
  const panel = await expectPanel(d, word);
  return { point, panel };
}

const pathname = d => d.eval('location.pathname');

// Nothing else in the page may be painted above the panel.
async function expectOnTop(d, { x, y }) {
  await waitFor(async () => {
    const hits = await d.eval(`[[${x + 20}, ${y + 70}], [${x + 20}, ${y - 70}]].map(([x, y]) => document.elementFromPoint(x, y)?.localName)`);
    return hits.includes('uwords-panel');
  }, 'the panel to be on top of the page');
}

async function withSettings(d, settings, body) {
  await d.setSettings(settings);
  try {
    await body();
  } finally {
    await d.clearSettings();
  }
}

const WORDS = site => `${site}/words.html`;

function viewerOf(d) {
  return waitFor(async () => {
    const url = await d.url();
    return url.startsWith(d.viewerUrl) ? url : null;
  }, 'the PDF viewer');
}

// Viewport position of a word in the viewer's rendered text layer.
const pdfWordPoint = (d, word) => waitFor(() => d.eval(`(() => {
  const walker = document.createTreeWalker(document.querySelector('.textLayer') || document.createElement('div'), NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const i = node.data.indexOf(${JSON.stringify(word)});
    if (i < 0) continue;
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + ${word.length});
    const r = range.getBoundingClientRect();
    if (r.width) return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  return null;
})()`), `"${word}" in the PDF text layer`, 15000);

const redirectedToViewer = (path, expected) => async ({ d, site }) => {
  await d.open(`${site}${path}`);
  const url = await viewerOf(d);
  assert.ok(decodeURIComponent(url).includes(path), `viewer should open ${path}, got ${url}`);
  if (expected) await expected(d);
};

const notRedirected = path => async ({ d, site }) => {
  await d.open(`${site}/link-target.html`);
  await d.open(`${site}${path}`);
  await sleep(300);
  const url = await d.url();
  assert.ok(!url.startsWith(d.viewerUrl), `should not be redirected, got ${url}`);
};

export const SCENARIOS = [
  // ---------- ordinary text ----------
  ['plain text', async ({ d, site }) => {
    await d.open(WORDS(site));
    const { point } = await doubleClickWord(d, 'plain', 'serendipity');
    await waitFor(async () => (await d.panel()).styled, 'the panel styles to load');
    await expectOnTop(d, point);
  }],
  ['Esc closes the panel', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'plain', 'serendipity');
    await d.key('Escape');
    await expectNoPanel(d, 200);
  }],
  ['a click outside closes the panel', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'plain', 'serendipity');
    await d.click(await locate(d, 'hostile'));
    await expectNoPanel(d, 200);
  }],
  ['text fields are left alone', async ({ d, site }) => {
    await d.open(WORDS(site));
    await d.dblclick(await locate(d, 'field'));
    await expectNoPanel(d);
  }],
  ['text that cannot be selected', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'unselectable', 'select');
  }],
  ['a site that stops events at window level', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'hostile', 'fortress');
  }],

  // ---------- clickable text ----------
  ['link: double-click looks up, does not follow', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'link', 'rainbow');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await pathname(d), '/words.html');
  }],
  ['link: a single click still follows it', async ({ d, site }) => {
    await d.open(WORDS(site));
    await d.click(await locate(d, 'link'));
    await waitFor(async () => (await pathname(d)) === '/link-target.html', 'the link to be followed');
  }],
  ['link: a single click still opens a new tab', async ({ d, site }) => {
    await d.open(WORDS(site));
    const before = await d.tabCount();
    await d.click(await locate(d, 'link-blank'));
    await waitFor(async () => (await d.tabCount()) === before + 1, 'a new tab');
    await d.closeOtherTabs();
  }],
  ['button: double-click looks up, does not press', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'button', 'harvest');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await d.eval('counters.button'), 0);
  }],
  ['button: a single click presses it once', async ({ d, site }) => {
    await d.open(WORDS(site));
    await d.click(await locate(d, 'button'));
    await waitFor(async () => (await d.eval('counters.button')) === 1, 'the button press');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await d.eval('counters.button'), 1);
    await expectNoPanel(d, 0);
  }],
  ['button with pointer-events: none text', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'button-wrapped', 'lantern');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await d.eval('counters.wrapped'), 0);
  }],
  ['input button: the word under the pointer', async ({ d, site }) => {
    await d.open(WORDS(site));
    await d.dblclick(await locate(d, 'submit', 0.72));
    await expectPanel(d, 'order');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await d.eval('counters.submit'), 0);
  }],
  ['input button: a single click submits', async ({ d, site }) => {
    await d.open(WORDS(site));
    await d.click(await locate(d, 'submit', 0.72));
    await waitFor(async () => (await d.eval('counters.submit')) === 1, 'the form submission');
  }],
  ['summary: double-click does not toggle, a click does', async ({ d, site }) => {
    await d.open(WORDS(site));
    const open = () => d.eval("document.querySelector('details').open");
    await doubleClickWord(d, 'summary', 'meadow');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await open(), false);
    await d.key('Escape');
    await d.click(await locate(d, 'summary'));
    await waitFor(open, 'the details to open');
  }],
  ['label: double-click does not toggle, a click does', async ({ d, site }) => {
    await d.open(WORDS(site));
    const checked = () => d.eval("document.getElementById('checkbox').checked");
    const point = await d.eval(`(() => {
      const range = document.createRange();
      range.selectNode(document.getElementById('label').lastChild);
      const r = range.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await d.dblclick(point);
    await expectPanel(d, 'orchard');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await checked(), false);
    await d.key('Escape');
    await d.click(point);
    await waitFor(checked, 'the checkbox to toggle');
  }],
  ['role=button element', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'role-button', 'compass');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await d.eval('counters.role'), 0);
    await d.key('Escape');
    await d.click(await locate(d, 'role-button'));
    await waitFor(async () => (await d.eval('counters.role')) === 1, 'the click to arrive');
  }],
  ['clickable only by its pointer cursor', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'pointer', 'glacier');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await d.eval('counters.pointer'), 0);
    await d.key('Escape');
    await d.click(await locate(d, 'pointer'));
    await waitFor(async () => (await d.eval('counters.pointer')) === 1, 'the click to arrive');
  }],
  ['text under a transparent link overlay', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'under-overlay', 'volcano');
    await sleep(AFTER_HOLD_MS);
    assert.equal(await pathname(d), '/words.html');
  }],

  // ---------- any site ----------
  ['open shadow DOM', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'in-open', 'lighthouse');
  }],
  ['closed shadow DOM', async ({ d, site }) => {
    await d.open(WORDS(site));
    await doubleClickWord(d, 'in-closed', 'waterfall');
  }],
  ['modal dialog: usable above it, Esc leaves the dialog open', async ({ d, site }) => {
    await d.open(WORDS(site));
    await d.click(await locate(d, 'open-dialog', 0.5));
    await waitFor(() => d.eval("document.getElementById('dialog').open"), 'the dialog');
    const { point } = await doubleClickWord(d, 'in-dialog', 'tapestry');
    await expectOnTop(d, point);
    await d.key('Escape');
    await expectNoPanel(d, 200);
    assert.equal(await d.eval("document.getElementById('dialog').open"), true, 'Esc should only close the panel');
  }],
  ['the strictest Content-Security-Policy', async ({ d, site }) => {
    await d.open(`${site}/csp.html`);
    // Inline scripts can't run here: compute the point from the browser side.
    const point = await d.eval(`(() => {
      const r = document.getElementById('word').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    await d.dblclick(point);
    await expectPanel(d, 'citadel');
    await waitFor(async () => (await d.panel()).styled, 'the panel styles to load under CSP');
    await expectOnTop(d, point);
  }],
  ['frame without a URL (srcdoc)', async ({ d, site }) => {
    await d.open(`${site}/frames.html`);
    await d.dblclick(await d.eval("locateIn('big')"));
    await expectPanel(d, 'almanac');
  }],
  ['a frame too small for the panel uses the top frame', async ({ d, site }) => {
    await d.open(`${site}/frames.html`);
    await d.dblclick(await d.eval("locateIn('tiny')"));
    const panel = await expectPanel(d, 'pebble');
    assert.equal(panel.frameId, await d.topFrameId(), 'panel should be in the top frame');
  }],

  // ---------- settings ----------
  ['setting: single-click trigger', async ({ d, site }) => {
    await withSettings(d, { trigger: 'click' }, async () => {
      await d.open(WORDS(site));
      await d.click(await locate(d, 'plain'));
      await expectPanel(d, 'serendipity');
      await d.key('Escape');
      // Clickable text keeps working as clickable: lookups there take a double-click.
      await doubleClickWord(d, 'link', 'rainbow');
      await d.key('Escape');
      await d.click(await locate(d, 'link'));
      await waitFor(async () => (await pathname(d)) === '/link-target.html', 'the link to be followed');
    });
  }],
  ['setting: Alt+click trigger', async ({ d, site }) => {
    await withSettings(d, { trigger: 'alt-click' }, async () => {
      await d.open(WORDS(site));
      await d.dblclick(await locate(d, 'plain'));
      await expectNoPanel(d);
      await d.click(await locate(d, 'link'), { alt: true });
      await expectPanel(d, 'rainbow');
      await sleep(AFTER_HOLD_MS);
      assert.equal(await pathname(d), '/words.html');
    });
  }],
  ['setting: clickable text off leaves clicks untouched', async ({ d, site }) => {
    await withSettings(d, { clickableText: false }, async () => {
      await d.open(WORDS(site));
      await d.dblclick(await locate(d, 'link'));
      await waitFor(async () => (await pathname(d)) === '/link-target.html', 'the link to be followed');
    });
  }],
  ['setting: switched off everywhere', async ({ d, site }) => {
    await withSettings(d, { enabled: false }, async () => {
      await d.open(WORDS(site));
      await d.dblclick(await locate(d, 'plain'));
      await expectNoPanel(d);
    });
  }],
  ['setting: switched off on this site', async ({ d, site }) => {
    await withSettings(d, { disabledSites: [new URL(site).hostname] }, async () => {
      await d.open(WORDS(site));
      await d.dblclick(await locate(d, 'plain'));
      await expectNoPanel(d);
    });
  }],

  // ---------- YouTube captions (mock player) ----------
  ['captions: hover underlines, press pauses, closing resumes', async ({ d, site }) => {
    await d.open(`${site}/youtube.html`);
    await waitFor(() => d.eval('!video.paused'), 'the video to play');
    const point = await locate(d, 'caption-word');
    await d.move(point);
    await waitFor(() => d.eval("document.querySelector('uwords-underline')?.isConnected"), 'the underline');
    assert.equal(await d.eval('video.paused'), false, 'hovering must not pause');
    await d.press(point);
    await waitFor(() => d.eval('video.paused'), 'the video to pause on press');
    await d.release(point);
    await expectPanel(d, 'mysterious');
    await d.key('Escape');
    await waitFor(() => d.eval('!video.paused'), 'the video to resume');
  }],
  ['captions: a click on the video only closes the panel', async ({ d, site }) => {
    await d.open(`${site}/youtube.html`);
    await waitFor(() => d.eval('!video.paused'), 'the video to play');
    const point = await locate(d, 'caption-word');
    await d.move(point);
    await d.click(point);
    await expectPanel(d, 'mysterious');
    await d.click({ x: 400, y: 120 });
    await expectNoPanel(d, 200);
    assert.ok(!(await d.eval('window.playerClicks')), 'the player must not see the click');
    await waitFor(() => d.eval('!video.paused'), 'the video to resume');
  }],

  // ---------- PDFs ----------
  ['PDF: opens in the viewer, words can be looked up', async ({ d, site, server }) => {
    await d.open(`${site}/pdf/inline.pdf?a=1&b=2`);
    const url = decodeURIComponent(await viewerOf(d));
    assert.ok(url.includes('a=1&b=2'), `query should survive: ${url}`);
    const point = await pdfWordPoint(d, 'quick');
    assert.ok(server.requests.some(r => r.path === '/pdf/inline.pdf' && r.search === '?a=1&b=2'));
    await d.dblclick(point);
    await expectPanel(d, 'quick');
  }],
  ['PDF: type with parameters', redirectedToViewer('/pdf/no-extension')],
  ['PDF: generic binary with a .pdf URL', redirectedToViewer('/pdf/generic.pdf')],
  ['PDF: generic binary with a .pdf file name', redirectedToViewer('/pdf/named')],
  ['PDF: downloads are left alone', notRedirected('/pdf/attachment.pdf')],
  ['PDF: an HTML page named .pdf is left alone', notRedirected('/not-a-pdf')],
  ['PDF: in an iframe', async ({ d, site }) => {
    await d.open(`${site}/embedded-pdf.html`);
    await waitFor(async () => (await d.frameUrls()).some(u => u.startsWith(d.viewerUrl)), 'the viewer in the frame');
  }],
  ['PDF: setting off leaves them to the browser', async ({ d, site }) => {
    await withSettings(d, { pdfViewer: false }, async () => {
      await d.open(`${site}/pdf/inline.pdf`);
      await sleep(400);
      assert.ok(!(await d.url()).startsWith(d.viewerUrl));
    });
    // and the redirect comes back
    await d.open(`${site}/pdf/inline.pdf`);
    await viewerOf(d);
  }],
  ['PDF: a local file without access asks for the file', async ({ d, localPdf }) => {
    await d.allowFileAccess(false);
    await d.open(localPdf);
    const url = await viewerOf(d);
    assert.ok(url.includes('local='), `should ask for the file: ${url}`);
    await waitFor(() => d.eval("document.body.innerText.includes('sample.pdf')"), 'the file prompt');
    // The prompt's way out goes back to the browser's own viewer, and stays there.
    await d.eval("[...document.querySelectorAll('button')].find(b => b.textContent.includes('own PDF viewer')).click()");
    await waitFor(async () => (await d.url()).startsWith('file:'), 'the browser viewer');
    await sleep(600);
    assert.ok((await d.url()).startsWith('file:'), 'should stay in the browser viewer');
  }],
  ['PDF: a local file with access opens directly', async ({ d, localPdf }) => {
    await d.allowFileAccess(true);
    await d.open(localPdf);
    const url = await viewerOf(d);
    assert.ok(url.includes('src='), `should open directly: ${url}`);
    const point = await pdfWordPoint(d, 'lazy');
    await d.dblclick(point);
    await expectPanel(d, 'lazy');
  }, { only: 'chromium' }],

  // ---------- toolbar popup ----------
  ['popup page: edition name, tabs, settings', async ({ d, edition }) => {
    await d.open(`${d.extensionOrigin}popup/popup.html`);
    assert.equal(await d.eval("document.getElementById('productName').textContent"), edition.name);
    const options = await d.eval("[...document.getElementById('defaultTab').options].map(o => o.value)");
    assert.ok(options.length === 4 && options[0] === 'last', `tab options: ${options}`);
    await d.eval("document.querySelector('[data-setting=clickableText]').click()");
    await sleep(100);
    const stored = await d.eval("browser.storage.local.get('clickableText').then(s => s.clickableText)");
    assert.equal(stored, false);
    await d.clearSettings();
  }],

  // ---------- Chromium's service worker life cycle ----------
  ['service worker: survives being stopped', async ({ d, site }) => {
    await d.open(WORDS(site));
    await d.stopServiceWorker();
    await doubleClickWord(d, 'plain', 'serendipity');
    // The tab gets an answer ("could not connect": the test browser has no internet).
    await waitFor(async () => Object.values((await d.panel()).panes)[0].trim(), 'the first tab to get an answer', 20000);
  }, { only: 'chromium' }],
  ['lazy tabs ask their source only when opened', async ({ d, site, edition }) => {
    if (!edition.backgroundScripts.some(s => s.includes('parse-google'))) return; // UWords TR only
    await d.open(WORDS(site));
    await doubleClickWord(d, 'plain', 'serendipity');
    await waitFor(async () => (await d.panel()).panes.Tureng.trim(), "the Tureng tab's answer");
    await sleep(300);
    let panel = await d.panel();
    assert.equal(panel.panes['Google Translate'].trim(), '', 'Google should not be asked yet');
    await d.click(panel.tabs['Google Translate']);
    await waitFor(async () => (await d.panel()).panes['Google Translate'].trim(), "the Google tab's answer");
    panel = await d.panel();
    assert.equal(panel.title, 'serendipity');
  }, { only: 'chromium' }],
  ['context menu: looks up the selected phrase', async ({ d, site }) => {
    await d.open(WORDS(site));
    await d.clickContextMenu('give up');
    await expectPanel(d, 'give up');
  }, { only: 'chromium' }],
  ['PDF rules are installed and removed', async ({ d }) => {
    assert.equal((await d.pdfRules()).length, 3);
    await withSettings(d, { pdfViewer: false }, async () => {
      await waitFor(async () => (await d.pdfRules()).length === 0, 'the rules to go away');
    });
    await waitFor(async () => (await d.pdfRules()).length === 3, 'the rules to come back');
  }, { only: 'chromium' }],
];

// ---------- parsers, against small hand-written pages shaped like the real ones ----------

async function loadParsers(d, site, edition) {
  await d.open(`${site}/link-target.html`);
  const scripts = ['common/edition.js', 'common/settings.js', 'background/dom-utils.js', ...edition.backgroundScripts, 'background/lookup.js'];
  await d.eval(`(async () => {
    for (const src of ${JSON.stringify(scripts)}) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = '/built/' + src;
        script.onload = resolve;
        script.onerror = () => reject(new Error('could not load ' + src));
        document.head.append(script);
      });
    }
    return true;
  })()`);
}

const parse = (d, fixture, call) => {
  const html = readFileSync(join(FIXTURES, 'parsers', fixture), 'utf8');
  return d.eval(`(() => {
    const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
    return ${call};
  })()`);
};

const firstSense = entry => entry.groups[0].senses[0];

export const PARSER_SCENARIOS = {
  en: [
    ['parser: Cambridge', async ({ d, site, edition }) => {
      await loadParsers(d, site, edition);
      const [entry, phrasal] = await parse(d, 'cambridge.html', "parseCambridge(doc, 'https://dictionary.cambridge.org/dictionary/english/sample')");
      assert.equal(entry.headword, 'sample');
      assert.equal(entry.pos, 'noun');
      assert.deepEqual(entry.prons[0], { label: 'UK', text: '/sɑːm.pəl/', audio: 'https://dictionary.cambridge.org/media/english/uk_pron/sample.mp3' });
      assert.equal(entry.groups[0].title, 'SMALL AMOUNT');
      assert.equal(firstSense(entry).def, 'a small amount of something');
      assert.equal(firstSense(entry).level, 'B2');
      assert.equal(firstSense(entry).examples[0].text, 'Take a sample of the soil.');
      assert.equal(phrasal.pos, 'phrasal verb');
    }],
    ['parser: Merriam-Webster', async ({ d, site, edition }) => {
      await loadParsers(d, site, edition);
      const [entry, inflected] = await parse(d, 'merriam.html', 'parseMerriam(doc)');
      assert.equal(entry.headword, 'sample');
      assert.equal(entry.pos, 'noun');
      assert.equal(entry.prons[0].audio, 'https://media.merriam-webster.com/audio/prons/en/us/mp3/s/sample01.mp3');
      assert.equal(firstSense(entry).num, '1 a');
      assert.equal(firstSense(entry).def, 'a part of something');
      assert.equal(firstSense(entry).examples[0].text, 'a sample of her work');
      assert.deepEqual(firstSense(inflected).refs, ['sample']);
      assert.equal(await parse(d, 'merriam.html', 'merriamSimpleHref(doc)'), '/simple/sample');
    }],
  ],
  'en-tr': [
    ['parser: Tureng', async ({ d, site, edition }) => {
      await loadParsers(d, site, edition);
      const { entries, exact } = await parse(d, 'tureng.html', 'parseTureng(doc)');
      assert.equal(exact, true);
      const [main, phrases] = entries;
      assert.equal(main.headword, 'sample');
      assert.equal(main.inflections, 'noun: sample (samples); verb: sample (samples – sampled – sampling)');
      assert.deepEqual(main.prons[0], { label: 'US', text: '/ˈsæmpəl/', audio: 'https://voices.tureng.com/en-US/sample.mp3' });
      assert.equal(main.prons[2].label, 'AU');
      assert.equal(main.groups[0].title, 'Common Usage');
      assert.equal(firstSense(main).def, 'örnek, numune');
      assert.deepEqual(firstSense(main).labels, ['n.']);
      assert.equal(firstSense(main).lang, 'tr');
      assert.equal(firstSense(main).examples[0].text, 'This is a sample. — Bu bir örnektir.');
      assert.equal(phrases.collapsed, true);
      assert.equal(firstSense(phrases).phrase, 'free sample');
    }],
    ['parser: Tureng in the Turkish direction', async ({ d, site, edition }) => {
      await loadParsers(d, site, edition);
      const { entries } = await parse(d, 'tureng-turkish.html', 'parseTureng(doc)');
      assert.equal(entries[0].headword, 'örnek');
      assert.equal(firstSense(entries[0]).def, 'sample');
      assert.equal(firstSense(entries[0]).phrase, '');
      assert.equal(firstSense(entries[0]).lang, 'en');
    }],
    ['parser: Tureng without results', async ({ d, site, edition }) => {
      await loadParsers(d, site, edition);
      const { entries } = await parse(d, 'tureng-suggestions.html', 'parseTureng(doc)');
      assert.equal(entries.length, 0);
      assert.deepEqual(await parse(d, 'tureng-suggestions.html', 'turengSuggestions(doc)'), ['sample', 'sampler']);
    }],
    ['parser: Sesli Sözlük', async ({ d, site, edition }) => {
      await loadParsers(d, site, edition);
      const { entries, exact } = await parse(d, 'sesli.html', 'parseSesli(doc)');
      assert.equal(exact, true);
      const [translation, definitions] = entries;
      assert.equal(translation.pos, 'English → Turkish');
      assert.equal(translation.headword, 'sample');
      assert.deepEqual(translation.prons[0], { label: 'UK', text: '', audio: 'https://static.seslisozluk.net/pronunciation/en/uk/s/sample.mp3' });
      const [first, second] = translation.groups[0].senses;
      assert.equal(first.def, 'örnek');
      assert.equal(first.examples[0].text, 'This is a sample. — Bu bir örnektir.');
      assert.deepEqual(second.labels, ['v.', 'Bilgisayar']);
      assert.equal(definitions.pos, 'English definitions');
      assert.equal(definitions.collapsed, true);
      assert.equal(firstSense(definitions).def, 'A small part of something.');
    }],
  ],
};

// ---------- live sites (network, and sites that may change) ----------

const hasEntries = result => {
  assert.equal(result.status, 'ok', `status: ${JSON.stringify(result).slice(0, 300)}`);
  assert.ok(result.entries.length > 0);
};

export const LIVE_SCENARIOS = {
  en: [
    ['live: Cambridge', async ({ d }) => {
      const r = await d.lookup('cambridge', 'serendipity');
      hasEntries(r);
      assert.match(r.entries[0].headword, /serendipity/);
    }],
    ['live: Merriam-Webster', async ({ d }) => {
      const r = await d.lookup('mw', 'water');
      hasEntries(r);
      assert.ok(r.entries[0].prons.length > 0, 'should have a pronunciation');
    }],
    ['live: MW Simple', async ({ d }) => {
      hasEntries(await d.lookup('mwSimple', 'water'));
      assert.equal((await d.lookup('mwSimple', 'serendipity')).status, 'unavailable');
    }],
    ['live: apostrophe words', async ({ d }) => {
      const r = await d.lookup('cambridge', "teacher's");
      hasEntries(r);
      assert.equal(r.query, 'teacher');
    }],
    ['live: unknown word has suggestions', async ({ d }) => {
      const r = await d.lookup('mw', 'recieve');
      assert.equal(r.status, 'notfound');
      assert.ok(r.suggestions.includes('receive'));
    }],
    ['live: audio plays', async ({ d }) => {
      const { entries } = await d.lookup('mw', 'water');
      const { audio } = entries[0].prons.find(p => p.audio);
      assert.deepEqual(await d.playAudio(audio), { ok: true });
    }],
    ['live: the whole flow on a page', async ({ d, site }) => {
      await d.open(WORDS(site));
      await doubleClickWord(d, 'plain', 'serendipity');
      await waitFor(async () => /luck|chance|valuable/i.test((await d.panel()).panes.Cambridge), 'the Cambridge definition', 20000);
    }],
  ],
  'en-tr': [
    ['live: Tureng', async ({ d }) => {
      const r = await d.lookup('tureng', 'run');
      hasEntries(r);
      assert.equal(r.entries[0].headword, 'run');
      assert.ok(r.entries[0].groups.some(g => g.senses.some(s => s.def.includes('koşmak'))));
      assert.ok(r.entries[0].prons.some(p => p.audio));
    }],
    ['live: Google Translate', async ({ d }) => {
      const r = await d.lookup('google', 'run');
      hasEntries(r);
      assert.ok(r.entries[0].groups.some(g => g.senses.some(s => s.def.includes('koş'))));
    }],
    ['live: Sesli Sözlük', async ({ d }) => {
      const r = await d.lookup('sesli', 'run');
      hasEntries(r);
      assert.equal(r.entries[0].pos, 'English → Turkish');
      assert.ok(r.entries[0].groups[0].senses.some(s => s.def.includes('koşmak')));
    }],
    ['live: inflected forms fall back to the base form', async ({ d }) => {
      for (const source of ['tureng', 'sesli']) {
        const r = await d.lookup(source, 'walked');
        hasEntries(r);
        assert.equal(r.query, 'walk', source);
        assert.equal(r.resolvedFrom, 'walked', source);
      }
    }],
    ['live: Turkish words go the other way', async ({ d }) => {
      for (const source of ['tureng', 'google', 'sesli']) {
        const r = await d.lookup(source, 'kitap');
        hasEntries(r);
        const text = JSON.stringify(r.entries);
        assert.match(text, /book/i, source);
      }
    }],
    ['live: unknown words', async ({ d }) => {
      for (const source of ['tureng', 'google', 'sesli']) {
        assert.equal((await d.lookup(source, 'asdfqwerzx')).status, 'notfound', source);
      }
      assert.deepEqual((await d.lookup('google', 'recieve')).suggestions, ['receive']);
    }],
    ['live: audio plays', async ({ d }) => {
      for (const source of ['tureng', 'google', 'sesli']) {
        const { entries } = await d.lookup(source, 'water');
        const { audio } = entries[0].prons.find(p => p.audio);
        assert.deepEqual(await d.playAudio(audio), { ok: true }, source);
      }
    }],
    ['live: the whole flow on a page', async ({ d, site }) => {
      await d.open(WORDS(site));
      await doubleClickWord(d, 'link', 'rainbow');
      await waitFor(async () => /gökkuşağı/i.test((await d.panel()).panes.Tureng), 'the Tureng meaning', 20000);
    }],
  ],
};

// A PDF on disk for the file:// scenarios.
export function writeLocalPdf() {
  const dir = join(tmpdir(), `uwords-e2e-${process.pid}`);
  const file = join(dir, 'sample.pdf');
  return {
    dir,
    url: () => pathToFileURL(file).href,
    write: mkdir => {
      mkdir(dir, { recursive: true });
      writeFileSync(file, samplePdf());
    },
  };
}
