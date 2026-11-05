# Contributing

Issues and pull requests are welcome. The most useful contribution is often a parser fix: the dictionary sites change their pages now and then, and a parser has to follow.

## Set up

You need [Node.js](https://nodejs.org/) 22.2 or newer, and nothing else: the project has no npm dependencies. For the end-to-end tests you also need a Chromium-family browser and, for the Firefox side, Firefox or Zen.

```bash
npm run build
```

See the [README](README.md#development) for loading the result in a browser, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the code is organized. Please read [docs/DECISIONS.md](docs/DECISIONS.md) before changing something fundamental: many choices that look odd have a reason written down there.

## Before you open a pull request

```bash
npm test
```

```bash
npm run test:e2e -- --browser chromium
```

```bash
npm run test:e2e -- --browser firefox
```

When you touch a parser or a source, also run these with `--live`, which tests against the real sites. If a change affects behavior, add or extend a scenario in `test/e2e/scenarios.mjs`.

## Rules of the road

- **Everything is in English:** UI text, identifiers, comments, docs and commit messages.
- **Docs change with the code.** A pull request that changes behavior updates the README and `CHANGELOG.md`; one that changes the structure or makes a design choice updates `docs/ARCHITECTURE.md` or `docs/DECISIONS.md`.
- **No runtime dependencies**, and no build step beyond copying files. The code that runs in the browser is the code in the repository.
- **Shared code first.** Put things in `src/`. `platforms/` is for what truly differs between browsers, and `editions/` for what differs between dictionaries.
- **Don't commit dictionary content.** Test fixtures are small hand-written pages that only copy a site's class names and structure.

## Common tasks

### A site changed its pages

Run the live tests to see which source broke, compare the site's new markup with the matching `parse-*.js` in `editions/`, and fix the parser and its fixture in `test/e2e/fixtures/parsers/` together.

### Adding or replacing a source in an edition

1. List it in the edition's `common/edition.js`. The order is the tab order.
2. Add a parser in the edition's `background/` that produces the [shared result shape](docs/ARCHITECTURE.md#the-result-shape), and list the file in `edition.json`.
3. Add its lookup to `UW_LOOKUPS` in the edition's `background/sources.js`, and its audio host to `UW_AUDIO_HOSTS`.
4. Add parser and live scenarios.

### Updating pdf.js

Download the release from the [pdf.js repository](https://github.com/mozilla/pdf.js/releases) and replace `src/pdfjs/`, keeping `web/uwords-viewer.html` and `web/locale/locale.json`. Then reapply the changes listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): compare the new `web/viewer.html` with `uwords-viewer.html`, and remove source maps, sample files, other locales and the sandbox files. Update the version in the notices and run the end-to-end tests.

### Releasing

1. Update the version in `package.json` and add a section to `CHANGELOG.md`.
2. Run all tests, including `--live`, on both browser families.
3. Push, and wait for CI to pass on that commit.
4. Create a GitHub release tagged on that commit (`v1.3.0`), and attach the four files from the `packages` artifact of its CI run. Packages built on Windows would differ in line endings.
