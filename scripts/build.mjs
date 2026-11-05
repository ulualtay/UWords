// Builds the extension packages. No dependencies: Node's standard library only.
//
//   node scripts/build.mjs                                  everything
//   node scripts/build.mjs --edition en-tr --platform chromium
//
// A build is three layers copied on top of each other (src/, platforms/<platform>/,
// editions/<edition>/), plus a manifest filled in from package.json and edition.json.
// Output for each combination:
//   dist/<package>-<platform>/                 unpacked, for development
//   dist/<package>-<version>-<platform>.<ext>  the package to install or release

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const EDITIONS = ['en', 'en-tr'];
export const PLATFORMS = { firefox: 'xpi', chromium: 'zip' };

const SCRIPTS_PLACEHOLDER = '{{EDITION_BACKGROUND_SCRIPTS}}';

function readJson(...path) {
  return JSON.parse(readFileSync(join(ROOT, ...path), 'utf8'));
}

export function readEdition(edition) {
  return readJson('editions', edition, 'edition.json');
}

export function version() {
  return readJson('package.json').version;
}

export function unpackedDir(edition, platform) {
  return join(ROOT, 'dist', `${readEdition(edition).packageName}-${platform}`);
}

// Replaces the {{…}} placeholders of a platform's manifest template.
export function fillManifest(template, edition, packageVersion) {
  const fill = value => {
    if (Array.isArray(value)) {
      return value.flatMap(item => (item === SCRIPTS_PLACEHOLDER ? edition.backgroundScripts : [fill(item)]));
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
    }
    if (typeof value !== 'string') return value;
    return value
      .replaceAll('{{EDITION_NAME}}', edition.name)
      .replaceAll('{{EDITION_DESCRIPTION}}', edition.description)
      .replaceAll('{{EDITION_GECKO_ID}}', edition.geckoId)
      .replaceAll('{{VERSION}}', packageVersion);
  };
  return fill(template);
}

function listFiles(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

// The offscreen document lists the edition's scripts like the Firefox manifest does.
function fillOffscreenPage(out, edition) {
  const page = join(out, 'offscreen', 'offscreen.html');
  if (!existsSync(page)) return;
  const tags = edition.backgroundScripts.map(script => `<script src="../${script}"></script>`).join('\n');
  writeFileSync(page, readFileSync(page, 'utf8').replace(`<!-- ${SCRIPTS_PLACEHOLDER} -->`, tags));
}

export function assemble(editionId, platform, out = unpackedDir(editionId, platform)) {
  const edition = readEdition(editionId);
  const skip = source => !['manifest.json', 'edition.json'].includes(relative(ROOT, source).split(sep).at(-1));
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(join(ROOT, 'src'), out, { recursive: true });
  cpSync(join(ROOT, 'platforms', platform), out, { recursive: true, filter: skip });
  cpSync(join(ROOT, 'editions', editionId), out, { recursive: true, filter: skip });
  const manifest = fillManifest(readJson('platforms', platform, 'manifest.json'), edition, version());
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  fillOffscreenPage(out, edition);
  return out;
}

// A plain zip with forward-slash paths (Firefox requires them) and fixed timestamps,
// so the same sources always give byte-identical packages.
export function createZip(dir) {
  const DOS_DATE_1980_01_01 = 0x0021;
  const UTF8_NAMES = 0x0800;
  const DEFLATE = 8;
  const STORE = 0;
  const locals = [];
  const centrals = [];
  let offset = 0;
  const paths = listFiles(dir).map(path => relative(dir, path).split(sep).join('/')).sort();
  for (const path of paths) {
    const data = readFileSync(join(dir, path));
    const packed = deflateRawSync(data, { level: 9 });
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data;
    const name = Buffer.from(path, 'utf8');
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0); // version needed
    common.writeUInt16LE(UTF8_NAMES, 2);
    common.writeUInt16LE(useDeflate ? DEFLATE : STORE, 4);
    common.writeUInt16LE(0, 6); // time
    common.writeUInt16LE(DOS_DATE_1980_01_01, 8);
    common.writeUInt32LE(crc32(data), 10);
    common.writeUInt32LE(body.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(name.length, 22);
    common.writeUInt16LE(0, 24); // extra length
    const local = Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), common, name, body]);
    const central = Buffer.concat([
      Buffer.from('PK\x01\x02', 'latin1'),
      Buffer.from([20, 0]), // version made by
      common,
      Buffer.alloc(10), // comment length, disk, attributes
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(offset, 0); return b; })(),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = Buffer.alloc(22);
  end.write('PK\x05\x06', 0, 'latin1');
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function build(editionId, platform) {
  const out = assemble(editionId, platform);
  const name = `${readEdition(editionId).packageName}-${version()}-${platform}.${PLATFORMS[platform]}`;
  const packagePath = join(ROOT, 'dist', name);
  writeFileSync(packagePath, createZip(out));
  return { out, packagePath };
}

function optionValues(args, flag, all) {
  const i = args.indexOf(flag);
  if (i < 0) return all;
  const value = args[i + 1];
  if (!all.includes(value)) throw new Error(`${flag} must be one of: ${all.join(', ')}`);
  return [value];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  for (const edition of optionValues(args, '--edition', EDITIONS)) {
    for (const platform of optionValues(args, '--platform', Object.keys(PLATFORMS))) {
      const { packagePath } = build(edition, platform);
      console.log(`Built ${relative(ROOT, packagePath)}`);
    }
  }
}
