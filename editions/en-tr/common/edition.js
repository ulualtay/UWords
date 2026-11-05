'use strict';

/*
 * The English-Turkish edition: the tabs of the panel, in order. `site` is the name
 * shown in messages and links. A `lazy` source is only asked when its tab is opened:
 * Google rate-limits its public endpoint, and this keeps a lookup from spending a
 * request there unless the result is wanted.
 */
const UW_SOURCES = Object.freeze([
  { id: 'tureng', label: 'Tureng', site: 'Tureng' },
  { id: 'google', label: 'Google Translate', site: 'Google Translate', lazy: true },
  { id: 'sesli', label: 'Sesli Sözlük', site: 'Sesli Sözlük' },
]);
