// Renders each edition's icons/icon.svg into the PNG sizes Chromium needs (it doesn't
// accept SVG extension icons). Run after changing an icon; the PNGs are committed.
// Needs a Chromium-family browser (see findChromium, or set CHROME_PATH).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EDITIONS, ROOT } from './build.mjs';
import { attachToTarget, launchChromium } from '../test/e2e/lib/cdp.mjs';

const SIZES = [16, 32, 48, 128];

const browser = await launchChromium();
try {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const session = await attachToTarget(browser, targetId);
  await browser.send('Page.enable', {}, session);
  await browser.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, session);
  for (const edition of EDITIONS) {
    const svg = readFileSync(join(ROOT, 'editions', edition, 'icons', 'icon.svg'));
    const src = `data:image/svg+xml;base64,${svg.toString('base64')}`;
    for (const size of SIZES) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false }, session);
      const html = `<!doctype html><html style="margin:0;background:transparent"><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`;
      const loaded = new Promise(resolve => {
        const off = browser.on(msg => {
          if (msg.method === 'Page.loadEventFired' && msg.sessionId === session) { off(); resolve(); }
        });
      });
      await browser.send('Page.navigate', { url: `data:text/html;base64,${Buffer.from(html).toString('base64')}` }, session);
      await loaded;
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } }, session);
      const path = join(ROOT, 'editions', edition, 'icons', `icon-${size}.png`);
      writeFileSync(path, Buffer.from(data, 'base64'));
      console.log(`Wrote ${path}`);
    }
  }
} finally {
  await browser.close();
}
