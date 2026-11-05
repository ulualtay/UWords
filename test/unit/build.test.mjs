import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { crc32, inflateRawSync } from 'node:zlib';
import { assemble, createZip, EDITIONS, fillManifest, PLATFORMS, readEdition, ROOT, version } from '../../scripts/build.mjs';

const temp = mkdtempSync(join(tmpdir(), 'uwords-build-'));
after(() => rmSync(temp, { recursive: true, force: true }));

const COMBINATIONS = EDITIONS.flatMap(edition => Object.keys(PLATFORMS).map(platform => ({ edition, platform })));
const built = new Map();

function assembled(edition, platform) {
  const key = `${edition}-${platform}`;
  if (!built.has(key)) built.set(key, assemble(edition, platform, join(temp, key)));
  return built.get(key);
}

const manifestOf = out => JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));

// Every file a manifest points at.
function referencedFiles(manifest) {
  const files = [...(manifest.content_scripts || []).flatMap(c => c.js)];
  files.push(...(manifest.background.scripts || []));
  if (manifest.background.service_worker) files.push(manifest.background.service_worker);
  files.push(...Object.values(manifest.icons));
  const action = manifest.action || manifest.browser_action;
  files.push(action.default_popup);
  files.push(...(typeof action.default_icon === 'string' ? [action.default_icon] : Object.values(action.default_icon)));
  files.push(...manifest.web_accessible_resources.flatMap(w => (typeof w === 'string' ? [w] : w.resources)));
  return files;
}

for (const { edition, platform } of COMBINATIONS) {
  test(`${edition} on ${platform}: the manifest is complete and everything it names exists`, () => {
    const out = assembled(edition, platform);
    const manifest = manifestOf(out);
    assert.equal(manifest.name, readEdition(edition).name);
    assert.equal(manifest.version, version());
    assert.ok(!JSON.stringify(manifest).includes('{{'), 'no placeholders left');
    assert.ok(manifest.description.length <= 132, `Chrome Web Store limit: ${manifest.description.length}`);
    for (const file of referencedFiles(manifest)) assert.ok(existsSync(join(out, file)), `missing ${file}`);
  });

  test(`${edition} on ${platform}: pages only load scripts that exist`, () => {
    const out = assembled(edition, platform);
    const pages = ['popup/popup.html', 'pdfjs/web/uwords-viewer.html'];
    if (platform === 'chromium') pages.push('offscreen/offscreen.html');
    for (const page of pages) {
      const html = readFileSync(join(out, page), 'utf8');
      assert.ok(!html.includes('{{'), `${page}: no placeholders left`);
      for (const [, src] of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
        assert.ok(existsSync(join(out, page, '..', src)), `${page} loads missing ${src}`);
      }
    }
  });

  test(`${edition} on ${platform}: every source has a lookup and an audio allow-list`, () => {
    const out = assembled(edition, platform);
    const sources = readFileSync(join(out, 'background', 'sources.js'), 'utf8');
    assert.match(sources, /const UW_LOOKUPS\b/);
    assert.match(sources, /const UW_AUDIO_HOSTS\b/);
    const edition_ = readFileSync(join(out, 'common', 'edition.js'), 'utf8');
    for (const [, id] of edition_.matchAll(/\bid: '(\w+)'/g)) assert.match(sources, new RegExp(`\\b${id}: \\{`), id);
  });
}

test('both platforms keep the Chromium and Firefox specifics apart', () => {
  const chromium = manifestOf(assembled('en', 'chromium'));
  const firefox = manifestOf(assembled('en', 'firefox'));
  assert.equal(chromium.manifest_version, 3);
  assert.equal(firefox.manifest_version, 2);
  assert.ok(!chromium.permissions.includes('webRequestBlocking'));
  assert.equal(firefox.browser_specific_settings.gecko.id, readEdition('en').geckoId);
  assert.equal(manifestOf(assembled('en-tr', 'firefox')).browser_specific_settings.gecko.id, readEdition('en-tr').geckoId);
  assert.ok(!existsSync(join(assembled('en', 'firefox'), 'offscreen')));
  assert.ok(!existsSync(join(assembled('en', 'chromium'), 'background', 'firefox.js')));
  assert.ok(!existsSync(join(assembled('en', 'chromium'), 'edition.json')));
});

test('each edition only ships its own sources', () => {
  assert.ok(existsSync(join(assembled('en', 'firefox'), 'background', 'parse-cambridge.js')));
  assert.ok(!existsSync(join(assembled('en', 'firefox'), 'background', 'parse-tureng.js')));
  assert.ok(existsSync(join(assembled('en-tr', 'firefox'), 'background', 'parse-tureng.js')));
  assert.ok(!existsSync(join(assembled('en-tr', 'firefox'), 'background', 'parse-cambridge.js')));
});

test('fillManifest expands the edition script list in place', () => {
  const filled = fillManifest(
    { name: '{{EDITION_NAME}}', list: ['a', '{{EDITION_BACKGROUND_SCRIPTS}}', 'z'] },
    { name: 'N', description: 'D', geckoId: 'G', backgroundScripts: ['b', 'c'] },
    '9.9.9',
  );
  assert.deepEqual(filled, { name: 'N', list: ['a', 'b', 'c', 'z'] });
});

// Reads a zip's central directory, as a browser's extension installer does.
function readZip(zip) {
  const end = zip.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.toString('latin1', at, at + 4), 'PK\x01\x02');
    const method = zip.readUInt16LE(at + 10);
    const crc = zip.readUInt32LE(at + 16);
    const packedSize = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const packed = zip.subarray(dataStart, dataStart + packedSize);
    entries.set(name, { data: method === 8 ? inflateRawSync(packed) : packed, crc });
    at += 46 + nameLength;
  }
  return entries;
}

test('packages are valid zips with forward slashes, and reproducible', () => {
  const out = assembled('en', 'firefox');
  const zip = createZip(out);
  const entries = readZip(zip);
  assert.ok(entries.has('manifest.json'));
  assert.ok(entries.has('pdfjs/web/uwords-viewer.html'));
  assert.ok([...entries.keys()].every(name => !name.includes('\\')));
  for (const [name, { data, crc }] of entries) assert.equal(crc32(data), crc, name);
  assert.deepEqual(JSON.parse(entries.get('manifest.json').data), manifestOf(out));
  assert.ok(createZip(out).equals(zip), 'two builds should be identical');
});

test('the repository keeps no manifest at the root', () => {
  assert.ok(!existsSync(join(ROOT, 'manifest.json')));
});
