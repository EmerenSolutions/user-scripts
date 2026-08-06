# WaniKani Kanji Components

A WaniKani userscript that shows whole kanji used as visual components within the current kanji.

The installable userscript is:

```text
src/wanikani-kanji-components.user.js
```

Current version: `0.1.12`.

## Behavior

- Detects the current WaniKani kanji on item pages and during reviews.
- Runs in WaniKani lessons and lesson quizzes when enabled, but not on the lesson picker.
- Shows direct visual components from a bundled decomposition map, promoting WaniKani kanji through non-WaniKani intermediate shapes.
- Shows nested components found inside those direct components.
- Shows component forms when a kanji appears in a changed shape, such as `水 as 氵`.
- Links displayed components to WaniKani kanji pages.
- Uses WaniKani Open Framework to filter results to kanji that exist in WaniKani.
- Adds a WaniKani script menu settings entry for enabling/disabling the script and each context.

This script is separate from WaniKani radical mnemonics and reading/phonetic-series helpers.

## Requirements

- The open-source [Violentmonkey](https://violentmonkey.github.io/) userscript
  manager.
- WaniKani Open Framework is required so the component list can be filtered to WaniKani kanji.

## Install

[Install Kanji Components](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/kanji-components/src/wanikani-kanji-components.user.js),
review its WaniKani site access, and confirm the installation in Violentmonkey.

## Data Source

Component data is generated from `cjk-decomp`, vendored under `vendor/cjk-decomp`.

The source data is licensed under Apache-2.0. See:

```text
vendor/cjk-decomp/LICENSE
```

## Development

Regenerate the component map and installable userscript with:

```sh
npm run build:kanji-components
```

Run the complete repository validation with `npm run check`.

## License

Original script and build code is licensed under the repository's MIT License.
The vendored `cjk-decomp` data remains under Apache-2.0; see
`vendor/cjk-decomp/LICENSE` and the repository's `THIRD_PARTY_NOTICES.md`.
