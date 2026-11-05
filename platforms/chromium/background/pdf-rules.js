'use strict';

/*
 * Declarative redirect of PDF responses to the bundled viewer. Manifest V3 has no
 * blocking webRequest, and these rules are its replacement: they match on response
 * headers (Chrome 128+) before the browser's own PDF viewer takes over.
 *
 * Same logic as isPdfResponse() in the Firefox background script. The URL can't be
 * encoded in a regex substitution, so viewer-glue.js reads it raw from "?src=".
 */

const UW_PDF_RULE_IDS = [1, 2, 3];

function uwPdfRedirectRules(viewerUrl) {
  const GENERIC_BINARY = ['application/octet-stream*', 'binary/octet-stream*'];
  const IS_DOWNLOAD = { header: 'content-disposition', values: ['attachment*'] };
  const rule = (id, condition) => ({
    id,
    priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: `${viewerUrl}?src=\\0` } },
    condition: { resourceTypes: ['main_frame', 'sub_frame'], requestMethods: ['get'], ...condition },
  });
  return [
    // Declared as a PDF.
    rule(UW_PDF_RULE_IDS[0], {
      regexFilter: '^https?://.*',
      responseHeaders: [{ header: 'content-type', values: ['application/pdf*', 'application/x-pdf*'] }],
      excludedResponseHeaders: [IS_DOWNLOAD],
    }),
    // Generic binary, but the URL says PDF.
    rule(UW_PDF_RULE_IDS[1], {
      regexFilter: '^https?://[^?#]*\\.pdf([?#].*)?$',
      responseHeaders: [{ header: 'content-type', values: GENERIC_BINARY }],
      excludedResponseHeaders: [IS_DOWNLOAD],
    }),
    // Generic binary, but the file name says PDF. Conditions in a list are ORed, so
    // "and the type is generic" is written as "exclude every other type".
    rule(UW_PDF_RULE_IDS[2], {
      regexFilter: '^https?://.*',
      responseHeaders: [{ header: 'content-disposition', values: ['*.pdf*'] }],
      excludedResponseHeaders: [IS_DOWNLOAD, { header: 'content-type', excludedValues: GENERIC_BINARY }],
    }),
  ];
}
