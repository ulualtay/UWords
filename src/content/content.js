'use strict';

/*
 * Turns clicks into lookups on any page. Listeners sit in the capture phase on
 * window and the script runs at document_start, so they are the first to see an
 * event: a site can't hide its clicks by stopping propagation.
 *
 * Loaded after common/*, content/words.js and ui/panel.js. The PDF viewer loads it
 * like a page script.
 */

(() => {
  // How long a click on clickable text waits for the second click of a double-click.
  const HOLD_MS = 250;
  // Once the second press has started, how long its click may take to arrive.
  const SECOND_PRESS_MS = 600;
  const SAME_SPOT_PX = 6;
  // Below this size a frame can't show the panel: the top frame does it instead.
  const MIN_FRAME_WIDTH = 300;
  const MIN_FRAME_HEIGHT = 220;
  const CLICKABLE = [
    'a[href]', 'button', 'summary', 'label', '[onclick]', UW_INPUT_BUTTON,
    ...['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'switch', 'checkbox', 'radio']
      .map(role => `[role="${role}"]`),
  ].join(', ');

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

  function show(query, rect, event) {
    const tooSmall = window !== window.top && (window.innerWidth < MIN_FRAME_WIDTH || window.innerHeight < MIN_FRAME_HEIGHT);
    if (!tooSmall) {
      getPanel().open(query, rect);
      return;
    }
    const screen = event ? { x: event.screenX, y: event.screenY } : null;
    uwSend({ type: 'show-in-top', query, screen })
      .then(res => { if (!res || !res.ok) getPanel().open(query, rect); })
      .catch(() => getPanel().open(query, rect));
  }

  // Page-specific integrations can take over clicks (youtube.js does on captions).
  const clickClaims = new Set();
  const isClaimed = e => [...clickClaims].some(fn => fn(e));

  // Small API for page-specific integrations loaded after this script (youtube.js).
  globalThis.uwPage = {
    get settings() { return settings; },
    isActive,
    open(query, rect) { show(query, rect); },
    close() { if (panel) panel.close(); },
    get isOpen() { return !!panel && panel.isOpen; },
    contains(e) { return fromPanel(e); },
    onClose(fn) { closeHandlers.add(fn); },
    claimClicks(fn) { clickClaims.add(fn); },
  };

  function fromPanel(e) {
    return !!panel && panel.contains(e);
  }

  function isEditable(target) {
    const el = target instanceof Element ? target : target && target.parentElement;
    if (!el) return false;
    if (el.isContentEditable || el.closest('textarea, select')) return true;
    const input = el.closest('input');
    return !!input && !input.matches(UW_INPUT_BUTTON);
  }

  function isClickable(el) {
    if (!(el instanceof Element)) return false;
    for (let n = el; n; n = n.parentElement || n.getRootNode().host) {
      if (n.matches(CLICKABLE)) return true;
    }
    return getComputedStyle(el).cursor === 'pointer';
  }

  function swallow(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  // ---------- closing the panel ----------

  // Registered now rather than when the panel opens, to come before the page's listeners.
  function closeOnPressOutside(e) {
    if (panel && panel.isOpen && !panel.contains(e) && !isClaimed(e)) panel.close();
  }
  window.addEventListener('pointerdown', closeOnPressOutside, true);
  window.addEventListener('mousedown', closeOnPressOutside, true);

  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !panel || !panel.isOpen) return;
    // Esc is the panel's: it shouldn't also close a dialog the panel is above.
    e.preventDefault();
    panel.close();
  }, true);

  // ---------- clickable text: double-click without activating it ----------

  // A double-click starts with a single click, which would already follow the link
  // or press the button. So a click on a word in clickable text waits briefly: a
  // second click makes it a lookup, otherwise the click is replayed as if nothing
  // had happened. Clicks that don't land on a word are never delayed.

  let held = null;               // { target, init, hit, x, y, timer }
  let swallowDblclickUntil = 0;

  function hold(e, hit) {
    swallow(e);
    const { clientX, clientY, screenX, screenY } = e;
    held = {
      hit,
      target: e.composedPath()[0],
      x: clientX,
      y: clientY,
      init: { bubbles: true, cancelable: true, composed: true, detail: 1, button: 0, clientX, clientY, screenX, screenY },
      timer: setTimeout(release, HOLD_MS),
    };
  }

  function release() {
    if (!held) return;
    const { target, init, x, y, timer } = held;
    clearTimeout(timer);
    held = null;
    // The page may have re-rendered in the meantime.
    const el = target.isConnected ? target : document.elementFromPoint(x, y);
    if (el) replayClick(el, init);
  }

  function replayClick(el, init) {
    const control = el.closest('label')?.control;
    let forwarded = false;
    const noteForwarded = () => { forwarded = true; };
    if (control) control.addEventListener('click', noteForwarded, { capture: true, once: true });
    const allowed = el.dispatchEvent(new MouseEvent('click', init));
    // After a real press on a label, Firefox takes a scripted click on it for the end
    // of a text selection and doesn't pass it on to the labeled control.
    if (control && allowed && !forwarded) control.click();
    if (control) control.removeEventListener('click', noteForwarded, { capture: true });
  }

  window.addEventListener('pointerdown', e => {
    if (!held || !e.isTrusted) return;
    const sameSpot = e.button === 0 && Math.hypot(e.clientX - held.x, e.clientY - held.y) <= SAME_SPOT_PX;
    if (!sameSpot) {
      release();
      return;
    }
    clearTimeout(held.timer);
    held.timer = setTimeout(release, SECOND_PRESS_MS);
  }, true);

  // ---------- clicks ----------

  window.addEventListener('click', e => {
    if (!e.isTrusted) return; // the page's own scripted clicks, and our replays
    if (performance.now() < swallowClickUntil) {
      swallowClickUntil = 0;
      swallow(e);
      return;
    }
    if (held) {
      const { hit, timer } = held;
      clearTimeout(timer);
      held = null;
      swallow(e);
      swallowDblclickUntil = performance.now() + SECOND_PRESS_MS;
      show(hit.query, hit.rect, e);
      return;
    }
    const mode = settings.trigger;
    if (mode === 'alt-click' || !isActive() || e.button !== 0 || e.detail !== 1) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (fromPanel(e) || isClaimed(e)) return;
    const target = e.composedPath()[0];
    if (isEditable(target)) return;
    if (mode !== 'click' && !settings.clickableText) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // the user was selecting text
    const hit = uwWordAt(e.clientX, e.clientY);
    if (!hit) return;
    if (isClickable(target) || isClickable(hit.element)) {
      if (settings.clickableText) hold(e, hit);
    } else if (mode === 'click') {
      show(hit.query, hit.rect, e);
    }
  }, true);

  // ---------- Alt+click ----------

  // Works on mouseup, since Firefox fires no click at all for Alt+click on a link. If a
  // click does follow, it is swallowed: Alt+click on a link would download it in Chromium.
  let altPress = null;
  let swallowClickUntil = 0;

  window.addEventListener('mousedown', e => {
    altPress = e.isTrusted && e.altKey && e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
  }, true);

  window.addEventListener('mouseup', e => {
    const press = altPress;
    altPress = null;
    if (!press || !e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > SAME_SPOT_PX) return;
    if (!isActive() || settings.trigger !== 'alt-click') return;
    if (fromPanel(e) || isClaimed(e) || isEditable(e.composedPath()[0])) return;
    const hit = uwWordAt(e.clientX, e.clientY);
    if (!hit) return;
    swallowClickUntil = performance.now() + SECOND_PRESS_MS;
    show(hit.query, hit.rect, e);
  }, true);

  // ---------- double-clicks ----------

  function selectedWordAt(x, y) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const query = uwNormalizeQuery(sel.toString());
    if (!uwIsWord(query)) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    return uwInRect(x, y, rect, 4) ? { query, rect } : null;
  }

  window.addEventListener('dblclick', e => {
    if (!e.isTrusted) return;
    if (performance.now() < swallowDblclickUntil) {
      swallowDblclickUntil = 0;
      swallow(e);
      return;
    }
    if (!isActive() || settings.trigger !== 'dblclick' || e.button !== 0) return;
    if (fromPanel(e) || isClaimed(e) || isEditable(e.composedPath()[0])) return;
    // The browser's selection knows word boundaries across inline elements; geometry
    // gives the better anchor (selection ranges are retargeted out of shadow DOM)
    // and works where nothing gets selected.
    const selected = selectedWordAt(e.clientX, e.clientY);
    const hit = uwWordAt(e.clientX, e.clientY);
    if (!selected && !hit) return;
    show(selected ? selected.query : hit.query, hit ? hit.rect : selected.rect, e);
  }, true);

  // ---------- messages from the background (context menu, small frames) ----------

  browser.runtime.onMessage.addListener(msg => {
    if (!msg || msg.type !== 'show') return;
    if (msg.targetTabId != null) {
      // Broadcast to extension pages (the PDF viewer): only the target tab reacts.
      browser.tabs.getCurrent().then(tab => { if (tab && tab.id === msg.targetTabId) showAtSelection(msg.query); });
      return;
    }
    if (msg.screen) showAtScreenPoint(msg.query, msg.screen);
    else showAtSelection(msg.query);
  });

  function topCenterRect() {
    const left = Math.max(8, window.innerWidth / 2 - 210);
    return { left, right: left, top: 60, bottom: 60 };
  }

  function showAtSelection(text) {
    const query = uwNormalizeQuery(text);
    if (!uwIsPhrase(query)) return;
    const sel = window.getSelection();
    const rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    // No usable rectangle e.g. for a selection inside a text field.
    getPanel().open(query, rect && (rect.width || rect.height) ? rect : topCenterRect());
  }

  // The word was in a child frame; its position only reaches us in screen coordinates.
  function showAtScreenPoint(text, { x, y }) {
    const query = uwNormalizeQuery(text);
    if (!uwIsPhrase(query)) return;
    const originX = window.mozInnerScreenX ?? window.screenX + (window.outerWidth - window.innerWidth) / 2;
    const originY = window.mozInnerScreenY ?? window.screenY + window.outerHeight - window.innerHeight;
    const left = x - originX;
    const top = y - originY;
    const onScreen = left >= 0 && top >= 0 && left <= window.innerWidth && top <= window.innerHeight;
    getPanel().open(query, onScreen ? { left, right: left, top, bottom: top + 8 } : topCenterRect());
  }
})();
