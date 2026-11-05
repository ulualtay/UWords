'use strict';

/*
 * Result panel shared by the in-page popup (content script, mode "floating")
 * and the toolbar popup (mode "embedded"). Everything lives in a closed shadow
 * root so page styles can't leak in. Depends on common/edition.js and
 * common/settings.js.
 */

const UW_CSS_URL = browser.runtime.getURL('ui/panel.css');
const UW_SENSE_LIMIT = 6;
// Elements that can't have children, so a panel can't be mounted inside them.
const UW_REPLACED_ELEMENTS = /^(VIDEO|IFRAME|IMG|CANVAS|EMBED|OBJECT)$/;

let uwCssText = null;

function uwSiteName(id) {
  const source = UW_SOURCES.find(s => s.id === id);
  return source ? source.site : id;
}

function uwErrorText(err) {
  const text = String((err && err.message) || err);
  // A content script orphaned by an extension update or reload (Chromium).
  if (/context invalidated|sendMessage/i.test(text)) {
    return `${browser.runtime?.getManifest?.().name || 'The extension'} was updated. Reload this page to use it again.`;
  }
  return text;
}

// Constructable stylesheets are not subject to the page's CSP; fall back to a
// <link> to the web-accessible file if they can't be used from this context.
async function uwAttachStyles(shadow) {
  try {
    if (uwCssText === null) uwCssText = await (await fetch(UW_CSS_URL)).text();
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(uwCssText);
    shadow.adoptedStyleSheets = [sheet];
    if (shadow.adoptedStyleSheets.length === 1) return;
  } catch (e) { /* fall back below */ }
  await new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = UW_CSS_URL;
    link.addEventListener('load', resolve, { once: true });
    link.addEventListener('error', resolve, { once: true });
    shadow.prepend(link);
  });
}

function uwEl(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

function uwSpeakerIcon() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  const body = document.createElementNS(NS, 'path');
  body.setAttribute('class', 'spk-body');
  body.setAttribute('d', 'M2 6h2.5L8 3v10L4.5 10H2z');
  const wave = document.createElementNS(NS, 'path');
  wave.setAttribute('class', 'spk-wave');
  wave.setAttribute('d', 'M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.3 6.3 0 0 1 0 9');
  svg.append(body, wave);
  return svg;
}

class UWPanel {
  constructor({ mode = 'floating', container = null, settings }) {
    this.mode = mode;
    this.settings = settings;
    this.query = '';
    this.results = {};
    this.token = 0;
    this.active = null;
    this.closeHandlers = new Set();

    this.host = document.createElement('uwords-panel');
    this.host.setAttribute('data-mode', mode);
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    this.ready = uwAttachStyles(this.shadow);

    this.build();

    // Many sites dispatch synthetic "resize" events; only a real viewport change
    // makes the anchor position stale.
    this.onResize = () => {
      if (window.innerWidth !== this.viewport.w || window.innerHeight !== this.viewport.h) this.close();
    };
    this.onFullscreenChange = () => this.close();

    if (mode === 'embedded' && container) {
      container.append(this.host);
      this.renderAll();
    }
  }

  build() {
    // The toolbar popup needs a search box; the in-page popup just shows the word.
    let heading;
    if (this.mode === 'embedded') {
      this.input = uwEl('input', {
        class: 'q', type: 'text', spellcheck: 'false', autocomplete: 'off',
        placeholder: 'Look up a word…', 'aria-label': 'Word to look up',
      });
      heading = uwEl('form', {
        class: 'search',
        onsubmit: e => { e.preventDefault(); this.lookup(this.input.value, { keepTab: true }); },
      }, this.input);
    } else {
      this.titleEl = uwEl('div', { class: 'title', role: 'heading', 'aria-level': '2', lang: 'en' });
      heading = this.titleEl;
    }

    const close = this.mode === 'floating'
      ? uwEl('button', { class: 'icon-btn', type: 'button', title: 'Close (Esc)', 'aria-label': 'Close', onclick: () => this.close() }, '×')
      : null;

    this.tabs = {};
    this.panes = {};
    const tablist = uwEl('div', { class: 'tabs', role: 'tablist', onkeydown: e => this.onTabKey(e) });
    for (const s of UW_SOURCES) {
      this.tabs[s.id] = uwEl('button', {
        class: 'tab', type: 'button', role: 'tab', 'aria-selected': 'false',
        onclick: () => this.select(s.id, true),
      }, s.label, uwEl('span', { class: 'state', 'aria-hidden': 'true' }));
      tablist.append(this.tabs[s.id]);
      this.panes[s.id] = uwEl('section', { class: 'pane', role: 'tabpanel', hidden: true });
    }

    // Dictionary content is English: keeps text-transform from producing a dotted
    // "İ" on pages whose language is Turkish.
    this.body = uwEl('div', { class: 'body', lang: 'en' }, Object.values(this.panes));
    this.card = uwEl('div', { class: 'card', dataset: { mode: this.mode, theme: this.settings.theme } },
      uwEl('div', { class: 'head' }, heading, close),
      tablist,
      this.body);

    // Double-click a word inside the panel to look it up in place.
    this.card.addEventListener('dblclick', e => {
      e.stopPropagation();
      if (e.target.closest('input, button')) return;
      const sel = (this.shadow.getSelection && this.shadow.getSelection()) || window.getSelection();
      const text = uwNormalizeQuery(sel ? sel.toString() : '');
      if (uwIsWord(text)) this.lookup(text, { keepTab: true });
    });

    // Typing in the panel must not trigger the page's keyboard shortcuts
    // (YouTube: k/f/space..., GitHub, Gmail...). Outside the shadow root these
    // events would look like they came from a non-editable element. Clicks stay
    // inside too: to the page they would be clicks on an unknown element, which
    // video players and "click outside to close" dialogs would act on.
    for (const type of ['keydown', 'keyup', 'keypress', 'click', 'dblclick', 'auxclick', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
      this.card.addEventListener(type, e => e.stopPropagation());
    }

    this.shadow.append(this.card);
    this.select(this.initialTab(), false);
  }

  // ---------- lifecycle ----------

  contains(event) {
    return event.composedPath().includes(this.host);
  }

  get isOpen() {
    return this.host.isConnected;
  }

  // Where the panel has to live to be rendered and clickable.
  mountPoint() {
    // A modal dialog makes everything outside it inert.
    const modals = document.querySelectorAll('dialog:modal');
    if (modals.length) return modals[modals.length - 1];
    // In fullscreen only the fullscreen element's subtree is rendered (e.g. the
    // YouTube player).
    const fs = document.fullscreenElement;
    return fs && !UW_REPLACED_ELEMENTS.test(fs.tagName) ? fs : document.documentElement;
  }

  // The top layer is above any z-index, and above the page's own dialogs, popovers
  // and fullscreen elements when entered after them.
  bringToTop() {
    try {
      this.host.setAttribute('popover', 'manual');
      if (!this.host.matches(':popover-open')) this.host.showPopover();
    } catch (err) { /* stays in normal stacking order, with the highest z-index */ }
  }

  async open(query, rect) {
    if (!this.isOpen) {
      this.host.style.setProperty('visibility', 'hidden', 'important');
      document.addEventListener('fullscreenchange', this.onFullscreenChange);
      window.addEventListener('resize', this.onResize);
    }
    const mount = this.mountPoint();
    if (this.host.parentNode !== mount) mount.append(this.host);
    this.bringToTop();
    this.anchor = rect;
    this.viewport = { w: window.innerWidth, h: window.innerHeight };
    this.lookup(query);
    await this.ready;
    if (!this.isOpen) return;
    this.place();
    this.host.style.removeProperty('visibility');
  }

  close() {
    if (this.mode !== 'floating' || !this.isOpen) return;
    this.token++;
    this.host.remove();
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    window.removeEventListener('resize', this.onResize);
    for (const fn of this.closeHandlers) fn();
  }

  onClose(fn) {
    this.closeHandlers.add(fn);
  }

  focus() {
    if (this.input) this.input.focus();
  }

  setSettings(settings) {
    this.settings = settings;
    this.card.dataset.theme = settings.theme;
    this.renderAll();
  }

  // Positions the card next to the anchor rect (viewport coords). Coordinates are
  // relative to the host, which sits at the document origin, so the card scrolls
  // with the page.
  place() {
    const r = this.anchor || { left: 0, top: 0, right: 0, bottom: 0 };
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(420, vw - 16);
    const spaceBelow = vh - r.bottom - 16;
    const spaceAbove = r.top - 16;
    const below = spaceBelow >= 300 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(200, Math.min(480, below ? spaceBelow : spaceAbove));
    const left = Math.max(8, Math.min(r.left - 16, vw - width - 8));
    const hr = this.host.getBoundingClientRect();

    const s = this.card.style;
    s.width = `${width}px`;
    s.maxHeight = `${maxHeight}px`;
    s.left = `${left - hr.left}px`;
    if (below) {
      s.top = `${r.bottom + 8 - hr.top}px`;
      s.bottom = 'auto';
    } else {
      // Anchor the card's bottom edge so it grows upwards as results arrive.
      s.top = 'auto';
      s.bottom = `${hr.top - (r.top - 8)}px`;
    }
  }

  // ---------- tabs ----------

  initialTab() {
    const tab = this.settings.defaultTab === 'last' ? this.settings.lastTab : this.settings.defaultTab;
    return UW_SOURCES.some(s => s.id === tab) ? tab : UW_SOURCES[0].id;
  }

  select(id, byUser) {
    this.active = id;
    for (const s of UW_SOURCES) {
      const on = s.id === id;
      this.tabs[s.id].setAttribute('aria-selected', String(on));
      this.tabs[s.id].tabIndex = on ? 0 : -1;
      this.panes[s.id].hidden = !on;
    }
    this.body.scrollTop = 0;
    this.requestResult(id);
    if (byUser && this.settings.lastTab !== id) {
      this.settings.lastTab = id;
      uwSaveSettings({ lastTab: id }).catch(() => {});
    }
  }

  onTabKey(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const ids = UW_SOURCES.map(s => s.id);
    const next = ids[(ids.indexOf(this.active) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length];
    this.select(next, true);
    this.tabs[next].focus();
    e.preventDefault();
  }

  // ---------- lookup ----------

  lookup(raw, { keepTab = false } = {}) {
    const query = uwNormalizeQuery(raw);
    if (!query) return;
    const token = ++this.token;
    this.query = query;
    if (this.input) this.input.value = query;
    if (this.titleEl) this.titleEl.textContent = query;
    this.results = {};
    this.requested = new Set();
    if (!keepTab) this.select(this.initialTab(), false);
    this.renderAll();
    for (const s of UW_SOURCES) {
      if (!s.lazy || s.id === this.active) this.requestResult(s.id);
    }
  }

  // Asks the background for one tab's result, once per query.
  requestResult(id) {
    if (!this.query || !this.requested || this.requested.has(id)) return;
    this.requested.add(id);
    this.tabs[id].classList.add('is-loading');
    const token = this.token;
    uwSend({ type: 'lookup', source: id, query: this.query })
      .catch(err => ({ status: 'error', message: uwErrorText(err) }))
      .then(res => {
        if (token !== this.token) return;
        this.results[id] = res || { status: 'error', message: 'No response.' };
        this.renderPane(id);
      });
  }

  async play(url, button) {
    button.classList.add('is-playing');
    try {
      const res = await uwSend({ type: 'play', url });
      if (res && !res.ok) button.title = res.message || 'Could not play the audio';
    } catch (err) {
      button.title = uwErrorText(err);
    } finally {
      button.classList.remove('is-playing');
    }
  }

  // ---------- rendering ----------

  renderAll() {
    for (const s of UW_SOURCES) this.renderPane(s.id);
  }

  renderPane(id) {
    const pane = this.panes[id];
    const res = this.results[id];
    const tab = this.tabs[id];
    tab.classList.toggle('is-loading', !!this.query && !res && !!this.requested && this.requested.has(id));
    tab.classList.toggle('is-empty', !!res && res.status !== 'ok');

    if (!this.query) {
      pane.replaceChildren(uwEl('p', { class: 'msg' }, 'Type a word and press Enter, or double-click a word on any page.'));
      return;
    }
    if (!res) {
      pane.replaceChildren(this.skeleton());
      return;
    }

    // replaceChildren() would turn a null into the text "null".
    const fill = (...nodes) => pane.replaceChildren(...nodes.flat().filter(Boolean));
    switch (res.status) {
      case 'ok':
        fill(
          res.resolvedFrom
            ? uwEl('p', { class: 'resolved' }, `No entry for “${res.resolvedFrom}”. Showing “${res.query}”.`)
            : null,
          res.suggestions && res.suggestions.length
            ? uwEl('div', { class: 'msg did-you-mean' }, uwEl('p', { class: 'msg-sub' }, 'Did you mean:'), this.suggestions(res.suggestions))
            : null,
          ...res.entries.map(e => this.renderEntry(e)),
          this.footer(id, res));
        break;
      case 'notfound':
        fill(
          uwEl('div', { class: 'msg' },
            uwEl('p', {}, `No results for “${this.query}” on ${uwSiteName(id)}.`),
            res.suggestions && res.suggestions.length
              ? [uwEl('p', { class: 'msg-sub' }, 'Did you mean:'), this.suggestions(res.suggestions)]
              : null),
          this.footer(id, res));
        break;
      case 'unavailable': {
        const info = UW_SOURCES.find(s => s.id === id).unavailable;
        fill(
          uwEl('div', { class: 'msg' },
            uwEl('p', {}, info.title.replace('{query}', this.query)),
            uwEl('p', { class: 'msg-sub' }, info.hint),
            uwEl('button', { class: 'link-btn', type: 'button', onclick: () => this.select(info.fallback, true) }, info.fallbackLabel)));
        break;
      }
      default:
        fill(
          uwEl('div', { class: 'msg is-error' }, uwEl('p', {}, res.message || 'Something went wrong.')),
          this.footer(id, res));
    }
  }

  skeleton() {
    return uwEl('div', { class: 'skeleton', 'aria-label': 'Loading' },
      ['w40', 'w90', 'w75', 'w85', 'w60'].map(w => uwEl('div', { class: `bar ${w}` })));
  }

  suggestions(list) {
    return uwEl('div', { class: 'chips' }, list.map(word =>
      uwEl('button', { class: 'chip', type: 'button', onclick: () => this.lookup(word, { keepTab: true }) }, word)));
  }

  footer(id, res) {
    if (!res.url) return null;
    return uwEl('div', { class: 'foot' },
      uwEl('a', { href: res.url, target: '_blank', rel: 'noopener noreferrer' }, `Open on ${uwSiteName(id)} ↗`));
  }

  renderEntry(entry) {
    const article = uwEl('article', { class: 'entry' },
      uwEl('div', { class: 'entry-head' },
        uwEl('span', { class: 'hw' }, entry.headword || this.query),
        entry.pos ? uwEl('span', { class: 'pos' }, entry.pos) : null),
      entry.inflections ? uwEl('div', { class: 'infl' }, entry.inflections) : null,
      entry.prons.length ? uwEl('div', { class: 'prons' }, entry.prons.map(p => this.renderPron(p))) : null);

    // Collapse long entries, but never just to hide one or two senses. An entry
    // marked `collapsed` (secondary material) starts with everything hidden.
    const total = entry.groups.reduce((n, g) => n + g.senses.length, 0);
    const limit = entry.collapsed ? 0 : total > UW_SENSE_LIMIT + 2 ? UW_SENSE_LIMIT : total;
    let shown = 0;
    let hidden = 0;
    for (const group of entry.groups) {
      const list = uwEl('ol', { class: 'senses' });
      const section = uwEl('section', { class: 'group' },
        group.title ? uwEl('div', { class: 'group-title' }, group.title) : null,
        list);
      let visibleInGroup = 0;
      for (const sense of group.senses) {
        const li = this.renderSense(sense);
        if (shown < limit) { shown++; visibleInGroup++; } else { li.hidden = true; hidden++; }
        list.append(li);
      }
      if (!visibleInGroup) section.hidden = true;
      article.append(section);
    }

    if (hidden) {
      const label = entry.moreLabel ? entry.moreLabel.replace('{count}', hidden) : `Show ${hidden} more meanings`;
      const more = uwEl('button', { class: 'link-btn show-all', type: 'button' }, label);
      more.addEventListener('click', () => {
        article.querySelectorAll('[hidden]').forEach(n => { n.hidden = false; });
        more.remove();
      });
      article.append(more);
    }
    return article;
  }

  renderPron(p) {
    if (!p.audio) {
      return uwEl('span', { class: 'pron is-plain' },
        p.label ? uwEl('span', { class: 'region' }, p.label) : null,
        uwEl('span', { class: 'ipa' }, p.text));
    }
    const button = uwEl('button', { class: 'pron', type: 'button', title: 'Listen' },
      p.label ? uwEl('span', { class: 'region' }, p.label) : null,
      p.text ? uwEl('span', { class: 'ipa' }, p.text) : null,
      uwSpeakerIcon());
    button.addEventListener('click', () => this.play(p.audio, button));
    return button;
  }

  renderSense(s) {
    return uwEl('li', { class: 'sense' },
      s.num ? uwEl('span', { class: 'num' }, s.num) : null,
      uwEl('div', { class: 'sense-body' },
        s.phrase ? uwEl('div', { class: 'phrase' }, s.phrase) : null,
        uwEl('div', { class: 'def-line' },
          s.level ? uwEl('span', { class: `lvl lvl-${s.level[0]}` }, s.level) : null,
          s.labels.map(l => uwEl('span', { class: 'lab' }, l)),
          s.def ? uwEl('span', { class: 'def', lang: s.lang }, s.def) : null,
          (s.refs || []).map(r => uwEl('button', {
            class: 'ref', type: 'button', title: `Look up “${r}”`,
            onclick: () => this.lookup(r, { keepTab: true }),
          }, `→ ${r}`))),
        s.notes.map(n => uwEl('div', { class: 'note' }, `— ${n}`)),
        this.renderExamples(s.examples),
        s.subs.map(sub => uwEl('div', { class: 'sub' },
          uwEl('div', { class: 'def-line' },
            sub.label ? uwEl('span', { class: 'sub-label' }, sub.label) : null,
            uwEl('span', { class: 'def' }, sub.def)),
          this.renderExamples(sub.examples)))));
  }

  renderExamples(list) {
    const max = Number(this.settings.maxExamples) || 0;
    if (!list.length || max <= 0) return null;
    const ul = uwEl('ul', { class: 'examples' });
    const add = ex => ul.append(uwEl('li', {}, ex.lead ? uwEl('b', {}, ex.lead) : null, ex.lead ? ' ' : null, ex.text));
    list.slice(0, max).forEach(add);
    if (list.length > max) {
      const row = uwEl('li', { class: 'more-row' });
      row.append(uwEl('button', {
        class: 'link-btn', type: 'button',
        onclick: () => { row.remove(); list.slice(max).forEach(add); },
      }, `+${list.length - max} more ${list.length - max === 1 ? 'example' : 'examples'}`));
      ul.append(row);
    }
    return ul;
  }
}
