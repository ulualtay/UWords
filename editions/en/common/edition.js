'use strict';

/*
 * The English dictionary edition: the tabs of the panel, in order. `site` is the name
 * shown in messages and links. `unavailable` words the "source has no such page" state.
 */
const UW_SOURCES = Object.freeze([
  { id: 'cambridge', label: 'Cambridge', site: 'Cambridge Dictionary' },
  { id: 'mw', label: 'Merriam-Webster', site: 'Merriam-Webster' },
  {
    id: 'mwSimple',
    label: 'MW Simple',
    site: 'Merriam-Webster (Simple)',
    unavailable: {
      title: 'There’s no Simple Definition for “{query}”.',
      hint: 'Merriam-Webster only offers them for words in its Learner’s Dictionary.',
      fallback: 'mw',
      fallbackLabel: 'Show the full definition →',
    },
  },
]);
