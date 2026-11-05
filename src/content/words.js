'use strict';

/*
 * Finds the word under a point from layout geometry alone. Unlike selections and
 * caret APIs this also works for text the browser won't select or put a caret in:
 * links, buttons, user-select: none, text under a transparent overlay, shadow DOM.
 *
 * Loaded after common/settings.js.
 */

const UW_WORD_RE = /[\p{L}\p{M}](?:[\p{L}\p{M}'’ʼ\-]*[\p{L}\p{M}])?/gu;
const UW_INPUT_BUTTON = 'input[type="button" i], input[type="submit" i], input[type="reset" i]';
const UW_POINTER_PAD = 1;
// Text inside pointer-events: none wrappers is not in the hit-test stack, so the
// topmost elements are searched in depth too, within these limits.
const UW_DEEP_ELEMENTS = 3;
const UW_DEEP_TEXT_NODES = 500;

function uwInRect(x, y, r, pad = 0) {
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}

// Content scripts may look into closed shadow roots too.
function uwShadowRootOf(el) {
  if (el.openOrClosedShadowRoot !== undefined) return el.openOrClosedShadowRoot; // Firefox
  try {
    return browser.dom ? browser.dom.openOrClosedShadowRoot(el) : el.shadowRoot;
  } catch (err) {
    return el.shadowRoot; // not an HTMLElement
  }
}

// Elements under the point, topmost first, including those inside shadow roots.
function uwElementsAt(x, y, root = document, seen = new Set()) {
  const found = [];
  for (const el of root.elementsFromPoint(x, y)) {
    if (seen.has(el) || el.getRootNode() !== root) continue;
    seen.add(el);
    const shadow = uwShadowRootOf(el);
    if (shadow) found.push(...uwElementsAt(x, y, shadow, seen));
    found.push(el);
  }
  return found;
}

function uwPlainRect({ left, top, right, bottom, width, height }) {
  return { left, top, right, bottom, width, height };
}

function uwWordInTextNode(node, x, y, range) {
  // The whole node first: most nodes aren't under the point at all.
  range.selectNodeContents(node);
  if (!Array.from(range.getClientRects()).some(r => uwInRect(x, y, r, UW_POINTER_PAD))) return null;
  if (getComputedStyle(node.parentElement).visibility !== 'visible') return null;
  UW_WORD_RE.lastIndex = 0;
  for (let m = UW_WORD_RE.exec(node.data); m; m = UW_WORD_RE.exec(node.data)) {
    range.setStart(node, m.index);
    range.setEnd(node, m.index + m[0].length);
    const rect = Array.from(range.getClientRects()).find(r => uwInRect(x, y, r, UW_POINTER_PAD));
    if (!rect) continue;
    const query = uwNormalizeQuery(m[0]);
    return uwIsWord(query) ? { query, rect: uwPlainRect(rect), element: node.parentElement } : null;
  }
  return null;
}

// <input type="submit" value="…"> keeps its text out of the DOM, so its words are
// measured: the value is drawn centered unless a stylesheet says otherwise.
function uwWordInInputButton(input, x, y) {
  const text = input.value;
  if (!text) return null;
  const style = getComputedStyle(input);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = style.font || `${style.fontSize} ${style.fontFamily}`;
  const box = input.getBoundingClientRect();
  const start = box.left + (box.width - ctx.measureText(text).width) / 2;
  UW_WORD_RE.lastIndex = 0;
  for (let m = UW_WORD_RE.exec(text); m; m = UW_WORD_RE.exec(text)) {
    const left = start + ctx.measureText(text.slice(0, m.index)).width;
    const right = left + ctx.measureText(m[0]).width;
    if (x < left - 2 || x > right + 2) continue;
    const query = uwNormalizeQuery(m[0]);
    if (!uwIsWord(query)) return null;
    return { query, element: input, rect: { left, right, top: box.top, bottom: box.bottom, width: right - left, height: box.height } };
  }
  return null;
}

// Words below an element with its own background can't be what the user sees.
function uwHidesWhatIsBelow(el) {
  const { backgroundColor, backgroundImage } = getComputedStyle(el);
  const clear = backgroundColor === 'transparent' || /(?:,|\/)\s*0\)$/.test(backgroundColor);
  return !clear || backgroundImage !== 'none';
}

// Searches the text nodes below `el` for the word at the point.
function uwWordInElement(el, x, y, range = document.createRange(), maxNodes = Infinity) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(), n = 0; node && n < maxNodes; node = walker.nextNode(), n++) {
    const word = uwWordInTextNode(node, x, y, range);
    if (word) return word;
  }
  return null;
}

// The word at a viewport position: { query, rect, element } or null.
function uwWordAt(x, y) {
  const stack = uwElementsAt(x, y);
  const range = document.createRange();
  for (const el of stack) {
    if (el.matches(UW_INPUT_BUTTON)) {
      const word = uwWordInInputButton(el, x, y);
      if (word) return word;
    }
    for (const child of el.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const word = uwWordInTextNode(child, x, y, range);
      if (word) return word;
    }
    if (uwHidesWhatIsBelow(el)) break;
  }
  for (const el of stack.slice(0, UW_DEEP_ELEMENTS)) {
    const word = uwWordInElement(el, x, y, range, UW_DEEP_TEXT_NODES);
    if (word) return word;
  }
  return null;
}
