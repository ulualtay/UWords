# Third-party notices

UWords' own code is under the [MIT license](LICENSE). The packages also contain the following third-party software, which keeps its own license. All of it lives in `src/pdfjs/`, next to the license files named below.

## Mozilla pdf.js

The PDF viewer is [pdf.js](https://github.com/mozilla/pdf.js) v6.4.299, © Mozilla Foundation, under the Apache License 2.0 (`src/pdfjs/LICENSE`).

UWords' changes to the distribution, as the license asks to state:

- `src/pdfjs/web/uwords-viewer.html` is a modified copy of `web/viewer.html`. It loads the UWords scripts, drops the bundled sample document, and allows `file:` in `connect-src`.
- `src/pdfjs/web/locale/locale.json` lists en-US only, and the other locales are removed.
- Source maps, the sample PDF and the code for running JavaScript inside PDFs (`build/pdf.sandbox.mjs`, `web/wasm/quickjs-eval.*`) are removed; UWords turns that feature off.

Everything else in `src/pdfjs/` is unmodified.

## Components bundled with pdf.js

| Component | Location | License | License file |
|---|---|---|---|
| Adobe CMap resources | `web/cmaps/` | BSD 3-Clause, © Adobe Systems Incorporated | `web/cmaps/LICENSE` |
| ICC color profile | `web/iccs/` | CC0 1.0 | `web/iccs/LICENSE` |
| Foxit standard fonts (from PDFium) | `web/standard_fonts/Foxit*` | BSD 3-Clause, © PDFium Authors | `web/standard_fonts/LICENSE_FOXIT` |
| Liberation fonts | `web/standard_fonts/Liberation*` | GPL v2 with font exception, © Red Hat, Inc. | `web/standard_fonts/LICENSE_LIBERATION` |
| JBIG2 decoder (from PDFium) | `web/wasm/jbig2*` | BSD 3-Clause, © PDFium Authors; Mozilla's build under Apache 2.0 | `web/wasm/LICENSE_JBIG2`, `web/wasm/LICENSE_PDFJS_JBIG2` |
| OpenJPEG decoder | `web/wasm/openjpeg*` | BSD 2-Clause; Mozilla's build under BSD | `web/wasm/LICENSE_OPENJPEG`, `web/wasm/LICENSE_PDFJS_OPENJPEG` |
| qcms color management | `web/wasm/qcms*` | MIT | `web/wasm/LICENSE_QCMS`, `web/wasm/LICENSE_PDFJS_QCMS` |

## Dictionary and translation content

UWords contains no dictionary data. It fetches pages from the sites below in your browser, when you ask for a word, and shows the result. That content belongs to its owners and stays under their terms. UWords isn't affiliated with or endorsed by any of them.

- [Cambridge Dictionary](https://dictionary.cambridge.org/), Cambridge University Press & Assessment
- [Merriam-Webster](https://www.merriam-webster.com/), Merriam-Webster, Incorporated
- [Tureng](https://tureng.com/), Tureng Çeviri
- [Google Translate](https://translate.google.com/), Google LLC
- [Sesli Sözlük](https://www.seslisozluk.net/), Sesli Sözlük

The product names are trademarks of their respective owners and are used only to say where a result comes from.
