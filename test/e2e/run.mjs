// Runs the end-to-end scenarios against real browsers.
//
//   node test/e2e/run.mjs [--browser chromium|firefox] [--edition en|en-tr] [--only text]
//                         [--live] [--headful]
//
// Without --browser, Chromium only. CHROME_PATH and FIREFOX_PATH choose the binaries.
//
// Browsers run headless and muted, so a test run disturbs nobody; --headful opens a
// window for debugging (on Firefox a visible one).
//
// By default the browser has no internet: everything runs on the local test site, and
// the dictionary sites don't get hundreds of requests from a test run. --live runs the
// lookups on the real sites instead.

import { mkdirSync, rmSync } from 'node:fs';
import { assemble, EDITIONS, readEdition, unpackedDir } from '../../scripts/build.mjs';
import { createChromiumDriver } from './lib/chromium-driver.mjs';
import { createFirefoxDriver } from './lib/firefox-driver.mjs';
import { startServer } from './lib/server.mjs';
import { LIVE_SCENARIOS, PARSER_SCENARIOS, SCENARIOS, writeLocalPdf } from './scenarios.mjs';

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
}
const flag = name => process.argv.includes(`--${name}`);

const browser = option('browser', 'chromium');
const editions = option('edition') ? [option('edition')] : EDITIONS;
const only = option('only');
const live = flag('live');
const headful = flag('headful');

const SCENARIO_TIMEOUT_MS = 45000;

async function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Scenario timed out after ${SCENARIO_TIMEOUT_MS / 1000} s`)), SCENARIO_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const local = writeLocalPdf();
local.write(mkdirSync);

let failed = 0;
let passed = 0;
for (const editionId of editions) {
  const edition = readEdition(editionId);
  const extensionDir = assemble(editionId, browser, unpackedDir(editionId, browser));
  const server = await startServer({ distDir: extensionDir });
  const d = browser === 'firefox'
    ? await createFirefoxDriver({ extensionDir, geckoId: edition.geckoId, headful, offline: !live })
    : await createChromiumDriver({ extensionDir, headful, offline: !live });
  const scenarios = (live ? LIVE_SCENARIOS[editionId] : [...SCENARIOS, ...PARSER_SCENARIOS[editionId]])
    .filter(([name, , opts]) => (!opts || !opts.only || opts.only === browser) && (!only || name.includes(only)));

  console.log(`\n${edition.name} on ${browser}: ${scenarios.length} scenarios`);
  const context = { d, edition, site: server.origin, server, localPdf: local.url() };
  try {
    for (const [name, run] of scenarios) {
      const started = Date.now();
      try {
        await withTimeout(run(context));
        passed++;
        console.log(`  ok    ${name} (${Date.now() - started} ms)`);
      } catch (err) {
        failed++;
        console.log(`  FAIL  ${name}\n        ${String(err.message).split('\n').join('\n        ')}`);
      }
    }
  } finally {
    await d.close();
    await server.close();
  }
}

rmSync(local.dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
