'use strict';

// Elements whose text should never leak into extracted strings
// (icons, hidden accessibility labels, audio fallbacks...).
const UW_STRIP = 'svg, script, style, noscript, audio, .visually-hidden, .hdn';

function uwText(el) {
  if (!el) return '';
  const clone = el.cloneNode(true);
  clone.querySelectorAll(UW_STRIP).forEach(n => n.remove());
  return clone.textContent
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .trim();
}

function uwUnique(list) {
  return [...new Set(list.filter(Boolean))];
}
