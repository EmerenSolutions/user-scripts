# Wanikani Kanji Components

A WaniKani userscript that shows whole kanji used as visual components within the current kanji.

The installable userscript is:

```text
src/wanikani-kanji-components.user.js
```

Current version: `1.0.0`.

## Behavior

- Detects the current WaniKani kanji on item pages and during reviews.
- Runs in WaniKani lessons and lesson quizzes when enabled, but not on the lesson picker.
- Shows direct visual components from a bundled decomposition map, promoting WaniKani kanji through non-WaniKani intermediate shapes.
- Shows nested components found inside those direct components.
- Shows component forms when a kanji appears in a changed shape, such as `水 as 氵`.
- Links displayed components to WaniKani kanji pages.
- Uses Wanikani Open Framework to filter results to kanji that exist in WaniKani.
- Adds a WaniKani script menu settings entry for enabling/disabling the script and each context.
- Clears the panel on non-kanji quiz questions and navigation; pending data loads cannot restore an older question's panel.

This script is separate from WaniKani radical mnemonics and reading/phonetic-series helpers.

## Requirements

- The open-source [Violentmonkey](https://violentmonkey.github.io/) userscript
  manager.
- Wanikani Open Framework is required so the component list can be filtered to WaniKani kanji.

## Install

[Install Wanikani Kanji Components](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/kanji-components/src/wanikani-kanji-components.user.js),
review its WaniKani site access, and confirm the installation in Violentmonkey.

## Data Source

Component data is generated from `cjk-decomp`, vendored under
`vendor/cjk-decomp`. The generated map is bundled in the userscript, so page
loads do not query an external component database.

The build keeps BMP ideographs used as roots and any supplementary-plane
ideographs reachable through their decomposition paths. This preserves
intermediate shapes such as the one connecting `歴` to `林` while excluding
unrelated supplementary CJK data.

To reduce the installed size, ordinary components are stored as strings.
Objects are used only when an alternate visible form must also be retained:

```json
{
  "歴": ["𠩵", "止"],
  "億": [{"kanji":"人", "form":"亻"}, "意"]
}
```

The source data is licensed under Apache-2.0. See:

```text
vendor/cjk-decomp/LICENSE
```

## Development

Regenerate the component map and installable userscript with:

```sh
npm run build:kanji-components
```

The generated `data/components.json` and installable userscript are committed.
Run the complete repository validation with `npm run check`.

Run this script's behavioral tests on their own with:

```sh
node --test kanji-components/tests/*.test.js
```

These tests execute the installable script in a controlled DOM fixture and
cover component filtering, promotion through intermediate shapes, alternate
forms, cyclic data, rendering, concurrent loads, question events, navigation,
settings, and missing or failed WKOF loads. Repository tests additionally check
the generated script and embedded third-party license against their sources.

## Publication checks

The automated fixtures do not establish compatibility with current live
WaniKani markup or browser layout. Version `1.0.0` was published with automated
validation; the following live Firefox checks with Violentmonkey and WKOF remain
unverified:

- Item pages such as `億` and `歴`: direct/nested rows, visible aliases, link
  destinations, and layout at narrow widths and in dark mode.
- Reviews and lessons/lesson quizzes: kanji → vocabulary → radical → kanji,
  rapid question changes, and delayed ItemData responses. Confirm event payloads
  are recognized and old panels never return during DOM transitions.
- Turbo navigation and back/forward navigation between item pages, quizzes,
  the dashboard, and the excluded lesson picker.
- Settings menu/dialog, persistence after reload, and each context/master
  switch, including changes during an outstanding item load.
- WKOF disabled, WKOF loaded late, and a failed ItemData request: requirement
  or error note, bounded retries, and recovery after reload.

## License

Original script and build code is licensed under the repository's MIT License.
The vendored and embedded `cjk-decomp` data remains under Apache-2.0. The
installable userscript includes the required source, modification, and license
notice. See `vendor/cjk-decomp/LICENSE` and the repository's
`THIRD_PARTY_NOTICES.md`.
