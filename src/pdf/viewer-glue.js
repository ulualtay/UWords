'use strict';

/*
 * Hooks UWords into the bundled pdf.js viewer (pdfjs/web/uwords-viewer.html).
 *   ?src=<url>         PDF opened directly
 *   ?local=<file url>  PDF on this computer that the extension isn't allowed to
 *                      read, so the user picks the file once
 *   (no parameter)     "Open a PDF" from the toolbar popup
 * Word lookups themselves come from content/content.js, which the viewer page
 * loads like a content script.
 */

(() => {
  const PRODUCT = browser.runtime.getManifest().name;
  const IS_CHROMIUM = location.protocol === 'chrome-extension:';

  // Two spellings of ?src=: Firefox's redirect encodes the URL, while Chromium's
  // declarative redirect can't, so there everything after "?src=" is the raw URL,
  // including any "&" of its own.
  function sourceFromQuery(search) {
    if (!search.startsWith('?src=')) return null;
    const value = search.slice('?src='.length);
    return /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : decodeURIComponent(value);
  }

  const src = sourceFromQuery(location.search);
  const local = src ? null : new URLSearchParams(location.search).get('local');

  // Fired by viewer.mjs before it initializes: the moment to set options.
  document.addEventListener('webviewerloaded', () => {
    const options = window.PDFViewerApplicationOptions;
    options.set('disablePreferences', true);
    options.set('localeProperties', { lang: 'en-US' });
    options.set('defaultUrl', '');          // no bundled sample document
    options.set('enableScripting', false);  // PDF JavaScript isn't needed for reading
    options.set('isEvalSupported', false);  // the extension CSP forbids eval anyway

    // pdf.js refuses cross-origin ?file= URLs, so the document is opened here.
    const app = window.PDFViewerApplication;
    app.initializedPromise.then(() => {
      if (src) app.open({ url: src, originalUrl: src });
      else showFilePrompt(app, local);
    });
  }, { once: true });

  function fileName(url) {
    try { return decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch (e) { return ''; }
  }

  function showFilePrompt(app, localUrl) {
    const name = localUrl ? fileName(localUrl) : '';
    if (name) document.title = name;

    const box = el('div', 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;z-index:100000;pointer-events:none;text-align:center;font:15px/1.5 system-ui,sans-serif;color:#e7e9ed');
    const title = el('div', 'font-size:18px;font-weight:700;max-width:560px;overflow-wrap:anywhere');
    title.textContent = name ? `Open “${name}” with ${PRODUCT}` : `Open a PDF with ${PRODUCT}`;
    const why = el('div', 'max-width:480px;opacity:.75;font-size:13.5px');
    why.textContent = name
      ? 'Your browser doesn’t let extensions read files on your computer, so choose this file once to look up words in it.'
      : 'Choose a PDF from your computer to look up words in it.';
    const button = el('button', 'pointer-events:auto;margin-top:6px;padding:10px 18px;border:0;border-radius:8px;background:#2456d6;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer');
    button.type = 'button';
    button.textContent = name ? `Choose “${name}”…` : 'Choose a PDF file…';
    button.addEventListener('click', () => document.getElementById('fileInput').click());
    const hint = el('div', 'opacity:.6;font-size:13px');
    hint.textContent = 'or drop it onto this window';
    box.append(title, why, button, hint);

    if (localUrl) {
      const native = el('button', 'pointer-events:auto;margin-top:10px;padding:0;border:0;background:none;color:#8db2ff;font:13px system-ui,sans-serif;cursor:pointer;text-decoration:underline');
      native.type = 'button';
      native.textContent = 'Open in the browser’s own PDF viewer instead';
      native.addEventListener('click', async () => {
        await uwSend({ type: 'native-pdf', url: localUrl }).catch(() => {});
        history.back();
      });
      box.append(native);
    }

    if (localUrl && IS_CHROMIUM) {
      // Chromium has a per-extension switch that makes this prompt unnecessary.
      const allow = el('button', 'pointer-events:auto;padding:0;border:0;background:none;color:#8db2ff;font:13px system-ui,sans-serif;cursor:pointer;text-decoration:underline');
      allow.type = 'button';
      allow.textContent = 'Skip this step: turn on “Allow access to file URLs” for this extension';
      allow.addEventListener('click', () => browser.tabs.create({ url: `chrome://extensions/?id=${browser.runtime.id}` }));
      box.append(allow);
    }

    document.body.append(box);
    app.eventBus.on('documentloaded', () => box.remove(), { once: true });
  }

  function el(tag, css) {
    const node = document.createElement(tag);
    node.style.cssText = css;
    return node;
  }

  // The document scrolls inside #viewerContainer, not the window, so an open
  // panel would drift away from its word: close it instead.
  document.addEventListener('scroll', () => uwPage.close(), true);
})();
