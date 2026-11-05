// Drives Firefox or Zen with the extension installed, over WebDriver BiDi. Uses Node's
// built-in WebSocket client, which sends no keep-alives (Zen drops the socket on them).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function findFirefox() {
  const { env } = process;
  const candidates = [
    env.FIREFOX_PATH,
    env.ProgramFiles && join(env.ProgramFiles, 'Zen Browser/zen.exe'),
    env.ProgramFiles && join(env.ProgramFiles, 'Mozilla Firefox/firefox.exe'),
    '/usr/bin/firefox',
    '/snap/bin/firefox',
    '/Applications/Firefox.app/Contents/MacOS/firefox',
  ];
  const found = candidates.find(path => path && existsSync(path));
  if (!found) throw new Error('No Firefox-family browser found. Set FIREFOX_PATH.');
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Plain text and useful bits of a serialized DOM node, shadow trees included.
function walkNode(node, visit) {
  if (!node || node.type !== 'node') return;
  visit(node);
  for (const child of node.value.children || []) walkNode(child, visit);
  if (node.value.shadowRoot) walkNode(node.value.shadowRoot, visit);
}

function textOf(node) {
  let text = '';
  walkNode(node, n => { if (n.value.nodeType === 3) text += n.value.nodeValue; });
  return text;
}

export async function createFirefoxDriver({ extensionDir, geckoId, headful = false, offline = false }) {
  const profile = mkdtempSync(join(tmpdir(), 'uwords-firefox-'));
  const uuid = randomUUID();
  // A proxy that isn't there: every site fails fast, except localhost, which browsers
  // never send through a proxy.
  const noInternet = offline ? {
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': 9,
    'network.proxy.ssl': '127.0.0.1',
    'network.proxy.ssl_port': 9,
  } : {};
  // A pinned internal UUID makes moz-extension:// URLs predictable.
  const prefs = {
    ...noInternet,
    // Firefox plays sound even when headless.
    'media.volume_scale': '0.0',
    'extensions.webextensions.uuids': JSON.stringify({ [geckoId]: uuid }),
    'xpinstall.signatures.required': false,
    'browser.shell.checkDefaultBrowser': false,
    'browser.aboutwelcome.enabled': false,
    'datareporting.policy.dataSubmissionEnabled': false,
    'toolkit.telemetry.reportingpolicy.firstRun': false,
    'browser.tabs.warnOnClose': false,
    'dom.disable_open_during_load': true,
    'media.autoplay.default': 0,
  };
  writeFileSync(join(profile, 'user.js'), Object.entries(prefs)
    .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n'));

  const port = await freePort();
  const proc = spawn(findFirefox(), [
    ...(headful ? [] : ['--headless']),
    '--no-remote',
    '--profile', profile,
    `--remote-debugging-port=${port}`,
    '--width=1280', '--height=900',
    'about:blank',
  ], {
    stdio: 'ignore',
    // Needed to run scripts in moz-extension:// pages over BiDi.
    env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
  });

  let socket;
  for (let attempt = 0; ; attempt++) {
    try {
      socket = await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
        ws.addEventListener('open', () => resolve(ws), { once: true });
        ws.addEventListener('error', () => reject(new Error('connect failed')), { once: true });
      });
      break;
    } catch (err) {
      if (attempt > 60) throw err;
      await sleep(500);
    }
  }

  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.type === 'error') reject(new Error(`${method}: ${msg.error}: ${msg.message}`));
      else resolve(msg.result);
    } else {
      for (const fn of listeners) fn(msg);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params }));
  });

  const { capabilities } = await send('session.new', { capabilities: { alwaysMatch: { acceptInsecureCerts: true } } });
  await send('webExtension.install', { extensionData: { type: 'path', path: extensionDir } });
  const extensionOrigin = `moz-extension://${uuid}/`;

  const contexts = async () => (await send('browsingContext.getTree', {})).contexts;
  let context = (await send('browsingContext.create', { type: 'tab' })).context;

  async function run(expression, target = context) {
    const r = await send('script.evaluate', {
      expression,
      target: { context: target },
      awaitPromise: true,
      resultOwnership: 'none',
      serializationOptions: { maxDomDepth: null, maxObjectDepth: 12, includeShadowTree: 'all' },
    });
    if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
    return r.result;
  }

  // Plain values out of BiDi's serialization.
  function value(remote) {
    if (!remote) return undefined;
    switch (remote.type) {
      case 'undefined': return undefined;
      case 'null': return null;
      case 'array': return remote.value.map(value);
      case 'object': return Object.fromEntries(remote.value.map(([k, v]) => [typeof k === 'string' ? k : value(k), value(v)]));
      default: return remote.value;
    }
  }

  const pointer = actions => send('input.performActions', {
    context,
    actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions }],
  });

  const framesOf = list => list.flatMap(c => [c.context, ...framesOf(c.children || [])]);

  const driver = {
    name: 'firefox',
    extensionOrigin,
    viewerUrl: `${extensionOrigin}pdfjs/web/uwords-viewer.html`,

    async open(url) {
      try {
        await send('browsingContext.navigate', { context, url, wait: 'complete' });
      } catch (err) {
        if (!/NS_BINDING_ABORTED|aborted|download/i.test(err.message)) throw err;
      }
      await sleep(200);
    },

    url: async () => value(await run('location.href')),
    eval: async expression => value(await run(expression)),

    async click({ x, y }, { alt = false } = {}) {
      const mouse = [{ type: 'pointerMove', x, y }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 30 }, { type: 'pointerUp', button: 0 }];
      if (!alt) {
        await pointer(mouse);
        return;
      }
      const ALT = '';
      await send('input.performActions', {
        context,
        actions: [
          { type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: ALT }, { type: 'pause' }, { type: 'pause' }, { type: 'pause' }, { type: 'pause' }, { type: 'keyUp', value: ALT }] },
          { type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [{ type: 'pause' }, ...mouse] },
        ],
      });
    },
    async dblclick({ x, y }) {
      await pointer([
        { type: 'pointerMove', x, y },
        { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
        { type: 'pause', duration: 70 },
        { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
      ]);
    },
    move: ({ x, y }) => pointer([{ type: 'pointerMove', x, y }]),
    press: ({ x, y }) => pointer([{ type: 'pointerMove', x, y }, { type: 'pointerDown', button: 0 }]),
    release: () => pointer([{ type: 'pointerUp', button: 0 }]),

    async key(key) {
      const k = key === 'Escape' ? '' : key;
      await send('input.performActions', {
        context,
        actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: k }, { type: 'keyUp', value: k }] }],
      });
    },

    async panel() {
      const tree = await contexts();
      const current = tree.flatMap(c => (c.context === context ? [c] : []));
      for (const frame of framesOf(current)) {
        let host;
        try {
          host = await run("document.querySelector('uwords-panel')", frame);
        } catch { continue; }
        if (!host || host.type !== 'node') continue;
        let title = '';
        const panes = [];
        const tabs = [];
        walkNode(host, n => {
          const cls = n.value.attributes && n.value.attributes.class;
          if (!cls) return;
          if (cls.split(' ').includes('title')) title = textOf(n);
          if (cls.split(' ').includes('pane')) panes.push(textOf(n));
          if (cls.split(' ').includes('tab')) tabs.push(textOf(n));
        });
        return {
          title,
          text: textOf(host),
          styled: true,
          frameId: frame,
          panes: Object.fromEntries(tabs.map((tab, i) => [tab, panes[i]])),
        };
      }
      return null;
    },

    topFrameId: async () => context,

    version: async () => `${capabilities.browserName} ${capabilities.browserVersion}`,

    // Firefox never lets extensions read file:// URLs; there is no switch to flip.
    allowFileAccess: async () => {},

    async frameUrls() {
      const tree = await contexts();
      const current = tree.filter(c => c.context === context);
      const urls = list => list.flatMap(c => [...(c.context === context ? [] : [c.url]), ...urls(c.children || [])]);
      return urls(current);
    },

    async setSettings(settings) {
      await inExtensionPage(`browser.storage.local.set(${JSON.stringify(settings)})`);
    },
    async clearSettings() {
      await inExtensionPage('browser.storage.local.clear()');
    },

    async tabCount() {
      return (await contexts()).length;
    },

    async closeOtherTabs() {
      for (const c of await contexts()) {
        if (c.context !== context) await send('browsingContext.close', { context: c.context }).catch(() => {});
      }
    },

    async screenshot() {
      const { data } = await send('browsingContext.captureScreenshot', { context });
      return Buffer.from(data, 'base64');
    },

    async setViewport(width, height) {
      await send('browsingContext.setViewport', { context, viewport: { width, height } });
    },

    async close() {
      try { await Promise.race([send('session.end'), sleep(3000)]); } catch { /* already gone */ }
      socket.close();
      proc.kill();
      await sleep(800);
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* best effort */ }
    },
  };

  // Storage belongs to the extension: run it from one of its pages, in a throwaway tab.
  async function inExtensionPage(expression) {
    const { context: tab } = await send('browsingContext.create', { type: 'tab', background: true });
    try {
      await send('browsingContext.navigate', { context: tab, url: `${extensionOrigin}popup/popup.html`, wait: 'complete' });
      return value(await run(expression, tab));
    } finally {
      await send('browsingContext.close', { context: tab }).catch(() => {});
      await sleep(150);
    }
  }
  driver.inExtensionPage = inExtensionPage;

  // The panel asks the background from an extension page, like the toolbar popup.
  driver.lookup = (source, query) => inExtensionPage(
    `browser.runtime.sendMessage({ type: 'lookup', source: ${JSON.stringify(source)}, query: ${JSON.stringify(query)} })`);
  driver.playAudio = url => inExtensionPage(`browser.runtime.sendMessage({ type: 'play', url: ${JSON.stringify(url)} })`);

  return driver;
}
