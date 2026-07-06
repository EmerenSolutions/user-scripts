# WaniKani Kanji Components

A WaniKani userscript that shows whole kanji used as visual components within the current kanji.

The installable userscript is:

```text
src/wanikani-kanji-components.user.js
```

Current version: `0.1.10`.

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

- A userscript manager such as Tampermonkey or Violentmonkey.
- WaniKani Open Framework is required so the component list can be filtered to WaniKani kanji.

## Data Source

Component data is generated from `cjk-decomp`, vendored under `vendor/cjk-decomp`.

The source data is licensed under Apache-2.0. See:

```text
vendor/cjk-decomp/LICENSE
```

## Development

Regenerate the component map and installable userscript with:

```sh
node scripts/build-components.js
node scripts/build-userscript.js
```
