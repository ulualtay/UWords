'use strict';

/* Loaded after common/settings.js and ui/panel.js */

(() => {
  let settings = { ...UW_DEFAULTS };
  let panel = null;

  uwLoadSettings().then(s => {
    settings = s;
    if (panel) panel.setSettings(settings);
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      settings[key] = newValue === undefined ? UW_DEFAULTS[key] : newValue;
    }
    if (!panel) return;
    // lastTab is written by the panel itself; re-rendering for it would be wasted work.
    if (Object.keys(changes).some(k => k !== 'lastTab')) panel.setSettings(settings);
    if (!isActive()) panel.close();
  });

  function isActive() {
    return settings.enabled && !settings.disabledSites.includes(location.hostname);
  }

  const closeHandlers = new Set();

  function getPanel() {
    if (!panel) {
      panel = new UWPanel({ mode: 'floating', settings });
      panel.onClose(() => closeHandlers.forEach(fn => fn()));
    }
    return panel;
  }

  // Small API for page-specific integrations loaded after this script (youtube.js).
  globalThis.uwPage = {
    get settings() { return settings; },
    isActive,
    open(query, rect) { getPanel().open(query, rect); },
    close() { if (panel) panel.close(); },
    get isOpen() { return !!panel && panel.isOpen; },
    contains(e) { return fromPanel(e); },
    onClose(fn) { closeHandlers.add(fn); },
  };

  function fromPanel(e) {
    return !!panel && panel.contains(e);
  }

  function isEditable(target) {
    const el = target instanceof Element ? target : target && target.parentElement;
    return !!el && (el.isContentEditable || !!el.closest('input, textarea, select'));
  }

  // ---------- double-click: use the word the browser just selected ----------

  document.addEventListener('dblclick', e => {
    if (!isActive() || settings.trigger !== 'dblclick' || e.button !== 0) return;
    if (fromPanel(e) || isEditable(e.target)) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const query = uwNormalizeQuery(sel.toString());
    if (!uwIsWord(query)) return;
    getPanel().open(query, sel.getRangeAt(0).getBoundingClientRect());
  }, true);

  // ---------- (Alt+)click: find the word under the pointer ----------

  const WORD_CHAR = /[\p{L}\p{M}'’\-]/u;
  const EDGE_CHAR = /['’\-]/;
  const INTERACTIVE = 'a[href], button, label, summary, select, [role="button"], [role="link"], [role="tab"], [onclick]';

  function wordAtPoint(x, y) {
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) { node = pos.offsetNode; offset = pos.offset; }
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      if (range) { node = range.startContainer; offset = range.startOffset; }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;

    const text = node.data;
    let start = offset;
    let end = offset;
    while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
    while (end < text.length && WORD_CHAR.test(text[end])) end++;
    while (start < end && EDGE_CHAR.test(text[start])) start++;
    while (end > start && EDGE_CHAR.test(text[end - 1])) end--;
    if (start >= end) return null;

    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    // caretPositionFromPoint snaps to the nearest text even in empty space; make
    // sure the pointer is actually on the word.
    const onWord = Array.from(range.getClientRects()).some(r =>
      x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1);
    if (!onWord) return null;

    const query = uwNormalizeQuery(text.slice(start, end));
    return uwIsWord(query) ? { query, rect: range.getBoundingClientRect() } : null;
  }

  document.addEventListener('click', e => {
    if (!isActive() || e.button !== 0) return;
    const mode = settings.trigger;
    const otherMods = e.ctrlKey || e.metaKey || e.shiftKey;
    if (mode === 'alt-click') {
      if (!e.altKey || otherMods) return;
    } else if (mode === 'click') {
      if (e.altKey || otherMods || e.detail > 1) return;
    } else {
      return;
    }
    if (fromPanel(e) || isEditable(e.target)) return;
    if (mode === 'click') {
      if (e.target instanceof Element && e.target.closest(INTERACTIVE)) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // the user was selecting text
    }
    const hit = wordAtPoint(e.clientX, e.clientY);
    if (!hit) return;
    if (mode === 'alt-click') {
      e.preventDefault();
      e.stopPropagation();
    }
    getPanel().open(hit.query, hit.rect);
  }, true);

  // ---------- context menu ("Look up “…” with UWords") ----------

  browser.runtime.onMessage.addListener(msg => {
    if (!msg || msg.type !== 'show') return;
    if (msg.targetTabId != null) {
      // Broadcast to extension pages (the PDF viewer): only the target tab reacts.
      browser.tabs.getCurrent().then(tab => { if (tab && tab.id === msg.targetTabId) showSelection(msg.query); });
      return;
    }
    showSelection(msg.query);
  });

  function showSelection(text) {
    const query = uwNormalizeQuery(text);
    if (!uwIsPhrase(query)) return;
    const sel = window.getSelection();
    let rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) {
      // e.g. selection inside a text field: fall back to the top centre of the viewport
      const left = Math.max(8, window.innerWidth / 2 - 210);
      rect = { left, right: left, top: 60, bottom: 60 };
    }
    getPanel().open(query, rect);
  }
})();
