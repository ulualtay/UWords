// Drives a Chromium-family browser with the extension loaded, over CDP.

import { attachToTarget, evaluate, launchChromium, waitForTarget } from './cdp.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// What the panel shows, read from inside the extension's own world: closed shadow roots
// are visible to content scripts and extension pages through chrome.dom.
const PANEL_INFO = `(() => {
  const host = document.querySelector('uwords-panel');
  if (!host) return null;
  const root = chrome.dom.openOrClosedShadowRoot(host);
  const card = root.querySelector('.card');
  const r = card.getBoundingClientRect();
  return {
    title: (root.querySelector('.title') || {}).textContent || '',
    text: root.textContent,
    styled: getComputedStyle(card).position === 'absolute',
    rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
    panes: Object.fromEntries([...root.querySelectorAll('.tab')].map((tab, i) => [
      tab.textContent, root.querySelectorAll('.pane')[i].textContent,
    ])),
    tabs: Object.fromEntries([...root.querySelectorAll('.tab')].map(tab => {
      const t = tab.getBoundingClientRect();
      return [tab.textContent, { x: Math.round(t.left + t.width / 2), y: Math.round(t.top + t.height / 2) }];
    })),
  };
})()`;

// A proxy that isn't there: every site fails fast, except localhost, which browsers never
// send through a proxy.
const NO_INTERNET = ['--proxy-server=http://127.0.0.1:9'];

// The dictionary sites' bot protection challenges the headless user agent, which real
// users never have. For lookups on those sites the headless browser reports the user
// agent it would have with a window.
async function windowedUserAgent() {
  const probe = await launchChromium();
  try {
    const { userAgent } = await probe.send('Browser.getVersion');
    return userAgent.replace('HeadlessChrome', 'Chrome');
  } finally {
    await probe.close();
  }
}

export async function createChromiumDriver({ extensionDir, headful = false, offline = false, args = [] }) {
  const userAgent = !offline && !headful ? [`--user-agent=${await windowedUserAgent()}`] : [];
  const browser = await launchChromium({ headful, args: [...(offline ? NO_INTERNET : userAgent), ...args] });
  const { id } = await browser.send('Extensions.loadUnpacked', { path: extensionDir });
  const extensionOrigin = `chrome-extension://${id}/`;

  let session = null;
  let targetId = null;
  const contexts = new Map(); // execution contexts of the current page, by id

  browser.on(msg => {
    if (msg.sessionId !== session) return;
    if (msg.method === 'Runtime.executionContextCreated') contexts.set(msg.params.context.id, msg.params.context);
    if (msg.method === 'Runtime.executionContextDestroyed') contexts.delete(msg.params.executionContextId);
    if (msg.method === 'Runtime.executionContextsCleared') contexts.clear();
  });

  async function useTarget(id_) {
    targetId = id_;
    contexts.clear();
    session = await attachToTarget(browser, targetId);
    await browser.send('Page.enable', {}, session);
    await browser.send('Runtime.enable', {}, session);
  }

  const first = await browser.send('Target.createTarget', { url: 'about:blank' });
  await useTarget(first.targetId);

  async function currentUrl() {
    return evaluate(browser, session, 'location.href');
  }

  const isOurWorker = t => t.type === 'service_worker' && t.url.startsWith(extensionOrigin);

  // The browser stops an idle worker. Any message from an extension page starts it again.
  async function wakeServiceWorker() {
    const { targetInfos } = await browser.send('Target.getTargets');
    if (targetInfos.some(isOurWorker)) return;
    const { targetId: pageId } = await browser.send('Target.createTarget', { url: `${extensionOrigin}popup/popup.html`, background: true });
    const page = await attachToTarget(browser, pageId);
    await sleep(300);
    await evaluate(browser, page, "chrome.runtime.sendMessage({ type: 'native-pdf', url: '' })").catch(() => {});
    await browser.send('Target.closeTarget', { targetId: pageId });
  }

  async function serviceWorkerSession() {
    await wakeServiceWorker();
    const target = await waitForTarget(browser, isOurWorker);
    const worker = await attachToTarget(browser, target.targetId);
    // A worker that has just started may not have its extension APIs yet.
    for (let attempt = 0; attempt < 50; attempt++) {
      if (await evaluate(browser, worker, "typeof chrome !== 'undefined' && !!chrome.storage && typeof uwOnMenuClicked === 'function'")) break;
      await sleep(100);
    }
    return worker;
  }

  const mouse = (type, { x, y }, extra = {}) => browser.send('Input.dispatchMouseEvent', { type, x, y, ...extra }, session);

  const driver = {
    name: 'chromium',
    extensionOrigin,
    viewerUrl: `${extensionOrigin}pdfjs/web/uwords-viewer.html`,

    async open(url) {
      const loaded = new Promise(resolve => {
        const off = browser.on(msg => {
          if (msg.sessionId === session && msg.method === 'Page.loadEventFired') { off(); resolve(); }
        });
        setTimeout(() => { off(); resolve(); }, 8000);
      });
      const { errorText } = await browser.send('Page.navigate', { url }, session);
      if (!errorText) await loaded;
      await sleep(150); // content scripts settle (settings load)
    },

    url: currentUrl,
    eval: expression => evaluate(browser, session, expression),

    async click(point, { alt = false } = {}) {
      const modifiers = alt ? 1 : 0;
      await mouse('mouseMoved', point);
      await mouse('mousePressed', point, { button: 'left', clickCount: 1, buttons: 1, modifiers });
      await sleep(30);
      await mouse('mouseReleased', point, { button: 'left', clickCount: 1, modifiers });
    },

    async dblclick(point) {
      await mouse('mouseMoved', point);
      await mouse('mousePressed', point, { button: 'left', clickCount: 1, buttons: 1 });
      await mouse('mouseReleased', point, { button: 'left', clickCount: 1 });
      await sleep(70);
      await mouse('mousePressed', point, { button: 'left', clickCount: 2, buttons: 1 });
      await mouse('mouseReleased', point, { button: 'left', clickCount: 2 });
    },

    move: point => mouse('mouseMoved', point),
    press: point => mouse('mousePressed', point, { button: 'left', clickCount: 1, buttons: 1 }),
    release: point => mouse('mouseReleased', point, { button: 'left', clickCount: 1 }),

    async key(key) {
      const code = key === 'Escape' ? { windowsVirtualKeyCode: 27, code: 'Escape' } : {};
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key, ...code }, session);
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key, ...code }, session);
    },

    // Looks in the page's extension worlds, including same-process frames; on the
    // extension's own pages the page world itself is the extension's.
    async panel() {
      const url = await currentUrl().catch(() => '');
      if (url.startsWith(extensionOrigin)) {
        try {
          return await evaluate(browser, session, PANEL_INFO);
        } catch { return null; }
      }
      for (const context of contexts.values()) {
        if (!context.origin.startsWith('chrome-extension://') && !String(context.name).startsWith('UWords')) continue;
        if (context.auxData && context.auxData.isDefault) continue;
        try {
          const info = await evaluate(browser, session, PANEL_INFO, { contextId: context.id });
          if (info) return { ...info, frameId: context.auxData && context.auxData.frameId };
        } catch { /* context went away */ }
      }
      return null;
    },

    async topFrameId() {
      const { frameTree } = await browser.send('Page.getFrameTree', {}, session);
      return frameTree.frame.id;
    },

    // URLs of the page's child frames, in or out of process.
    async frameUrls() {
      const { targetInfos } = await browser.send('Target.getTargets');
      const { frameTree } = await browser.send('Page.getFrameTree', {}, session);
      return [
        ...(frameTree.childFrames || []).map(f => f.frame.url),
        ...targetInfos.filter(t => t.type === 'iframe').map(t => t.url),
      ];
    },

    async setSettings(settings) {
      const worker = await serviceWorkerSession();
      await evaluate(browser, worker, `chrome.storage.local.set(${JSON.stringify(settings)})`);
      await sleep(150);
    },

    async clearSettings() {
      const worker = await serviceWorkerSession();
      await evaluate(browser, worker, 'chrome.storage.local.clear()');
      await sleep(150);
    },

    async tabCount() {
      const { targetInfos } = await browser.send('Target.getTargets');
      return targetInfos.filter(t => t.type === 'page').length;
    },

    async closeOtherTabs() {
      const { targetInfos } = await browser.send('Target.getTargets');
      for (const t of targetInfos) {
        if (t.type === 'page' && t.targetId !== targetId) await browser.send('Target.closeTarget', { targetId: t.targetId });
      }
    },

    async screenshot() {
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, session);
      return Buffer.from(data, 'base64');
    },

    async setViewport(width, height) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: false }, session);
    },

    // ---- Chromium-only hooks, for scenarios that have no Firefox equivalent ----

    // Stops the service worker, as the browser does after 30 idle seconds.
    async stopServiceWorker() {
      const worker = await waitForTarget(browser, t => t.type === 'service_worker' && t.url.startsWith(extensionOrigin));
      await browser.send('Target.closeTarget', { targetId: worker.targetId });
      await sleep(300);
    },

    // Simulates choosing the context menu item (native menus can't be automated).
    async clickContextMenu(selectionText) {
      const worker = await serviceWorkerSession();
      const url = await currentUrl();
      await evaluate(browser, worker, `(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(t => t.length ? t : chrome.tabs.query({ url: ${JSON.stringify(url)} }));
        uwOnMenuClicked({ menuItemId: UW_MENU_ID, selectionText: ${JSON.stringify(selectionText)}, pageUrl: ${JSON.stringify(url)}, frameId: 0 }, tab);
      })()`);
    },

    async pdfRules() {
      const worker = await serviceWorkerSession();
      return evaluate(browser, worker, 'chrome.declarativeNetRequest.getDynamicRules()');
    },

    // Asks the background directly, as the panel does; needs an extension page open.
    async lookup(source, query) {
      const worker = await serviceWorkerSession();
      return evaluate(browser, worker, `askOffscreen({ type: 'lookup', source: ${JSON.stringify(source)}, query: ${JSON.stringify(query)} })`);
    },

    async playAudio(url) {
      const worker = await serviceWorkerSession();
      return evaluate(browser, worker, `askOffscreen({ type: 'play', url: ${JSON.stringify(url)} })`);
    },

    // Flips "Allow access to file URLs" the way the extensions page does. The extension
    // reloads, which closes tabs showing its pages, so the test tab leaves them first.
    // Chrome disables an unpacked extension that reloads outside developer mode.
    async allowFileAccess(allowed) {
      await driver.open('about:blank');
      const { targetId: pageId } = await browser.send('Target.createTarget', { url: 'chrome://extensions/' });
      const page = await attachToTarget(browser, pageId);
      await sleep(800);
      await evaluate(browser, page, 'chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })');
      await evaluate(browser, page, `chrome.developerPrivate.updateExtensionConfiguration({ extensionId: ${JSON.stringify(id)}, fileAccess: ${allowed} })`);
      await browser.send('Target.closeTarget', { targetId: pageId });
      await sleep(800); // the reload
      const worker = await serviceWorkerSession();
      const actual = await evaluate(browser, worker, 'chrome.extension.isAllowedFileSchemeAccess()');
      if (actual !== allowed) throw new Error(`File access is ${actual} after setting it to ${allowed}`);
    },

    async version() {
      return (await browser.send('Browser.getVersion')).product;
    },

    close: () => browser.close(),
  };
  return driver;
}
