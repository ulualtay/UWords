// A minimal Chrome DevTools Protocol client over --remote-debugging-pipe, using only
// Node's standard library. The pipe also unlocks Extensions.loadUnpacked, the supported
// way to load an extension for automation (branded Chrome ignores --load-extension).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Any Chromium-family browser will do; CHROME_PATH wins.
export function findChromium() {
  const { env } = process;
  const candidates = [
    env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    env.ProgramFiles && join(env.ProgramFiles, 'Google/Chrome/Application/chrome.exe'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Google/Chrome/Application/chrome.exe'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    env.ProgramFiles && join(env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
  ];
  const found = candidates.find(path => path && existsSync(path));
  if (!found) throw new Error('No Chromium-family browser found. Set CHROME_PATH.');
  return found;
}

// Silent and invisible unless asked otherwise: tests must not disturb whoever runs them.
// `headful` opens a real window, off-screen, for debugging only.
export async function launchChromium({ headful = false, args = [], executable = findChromium() } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'uwords-chromium-'));
  const proc = spawn(executable, [
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--mute-audio',
    '--window-size=1280,900',
    ...(process.env.CI ? ['--no-sandbox'] : []),
    ...(headful ? ['--window-position=-2400,0'] : ['--headless=new']),
    ...args,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

  const toBrowser = proc.stdio[3];
  const fromBrowser = proc.stdio[4];
  let nextId = 1;
  let buffer = '';
  const pending = new Map();
  const listeners = new Set();

  fromBrowser.setEncoding('utf8');
  fromBrowser.on('data', chunk => {
    buffer += chunk;
    for (let end = buffer.indexOf('\0'); end >= 0; end = buffer.indexOf('\0')) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      const waiting = msg.id && pending.get(msg.id);
      if (waiting) {
        pending.delete(msg.id);
        if (msg.error) waiting.reject(new Error(`${waiting.method}: ${msg.error.message}`));
        else waiting.resolve(msg.result);
      } else {
        for (const fn of listeners) fn(msg);
      }
    }
  });
  toBrowser.on('error', () => {});
  proc.once('exit', () => {
    for (const { reject, method } of pending.values()) reject(new Error(`Browser exited during ${method}`));
    pending.clear();
  });

  const browser = {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        toBrowser.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async close() {
      try { await Promise.race([browser.send('Browser.close'), new Promise(r => setTimeout(r, 3000))]); } catch { /* already gone */ }
      proc.kill();
      await new Promise(r => setTimeout(r, 500));
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* best effort */ }
    },
  };
  return browser;
}

// Runs an expression and returns its JSON value.
export async function evaluate(browser, sessionId, expression, extra = {}) {
  const r = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...extra }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

export async function attachToTarget(browser, targetId) {
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  return sessionId;
}

export async function waitForTarget(browser, predicate, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { targetInfos } = await browser.send('Target.getTargets');
    const target = targetInfos.find(predicate);
    if (target) return target;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for a target');
}
