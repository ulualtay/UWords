'use strict';

/* Answers the dictionary work the service worker forwards here (see service-worker.js). */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.target !== 'offscreen') return undefined;
  const pending = uwHandleDictionaryMessage(msg);
  if (!pending) return undefined;
  pending.then(sendResponse, err => sendResponse({ status: 'error', ok: false, message: uwDescribeError(err) }));
  return true; // the answer comes asynchronously
});
