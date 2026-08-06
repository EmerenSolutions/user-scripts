# WaniKani Progressive Japanese UI

Replaces selected interface labels with Japanese vocabulary learned through
WaniKani.

The installable userscript is:

```text
src/wanikani-progressive-japanese-ui.user.js
```

Current version: `0.1.0`.

## Behavior

- Uses actual assignment data instead of assuming that every item from an old
  level was learned.
- Treats a vocabulary item as learned after its lesson is completed and it
  enters Apprentice 1 or higher.
- Builds an English-to-Japanese map from the meanings attached to your actual
  learned WaniKani vocabulary instead of relying only on a small hand-written
  list.
- Progressively replaces learned words inside UI labels. For example,
  `Today's Lessons` becomes `今日の Lessons` after learning `今日`, then
  `今日の授業` after also learning `授業`.
- Translates exact UI labels and count-prefixed labels such as `10 Lessons`.
- Watches dynamically rendered dashboard widgets and WaniKani Turbo
  navigation.
- Avoids mnemonic, explanation, context-sentence, form, and code content.
- Runs only on the private allowlist: WaniKani, YouTube, Nexus Mods, and
  Google Keep.
- Refreshes a private Violentmonkey cache whenever WaniKani is opened, then
  uses that learned-word cache on allowlisted sites. The API token is never
  copied or exposed to those sites.

## Requirements

- An open-source userscript manager such as Violentmonkey.
- [WaniKani Open Framework](https://community.wanikani.com/t/28549), used to
  read cached subject and assignment data from WaniKani's API.

The script does not request or store an API token itself.

## Install

[Install Progressive Japanese UI](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/japanese-ui/src/wanikani-progressive-japanese-ui.user.js),
review the allowlisted sites and storage permissions, and confirm the
installation in Violentmonkey.

For local development, serve the script from the repository root over
loopback:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open this URL in Firefox and install it with Violentmonkey:

```text
http://127.0.0.1:8765/japanese-ui/src/wanikani-progressive-japanese-ui.user.js
```

Reload WaniKani after installation to refresh the learned-word cache, then
reload any allowlisted site. Visit WaniKani again after completing new lessons
to update the cache.

## Original reference

The project started by examining version 0.2 of
[Japanese WaniKani dashboard](https://greasyfork.org/en/scripts/434601-japanese-wanikani-dashboard).
That script has no declared open-source license, so its downloaded source is
kept in the Git-ignored `reference/` directory and is not incorporated into
this implementation.

## Validation

Run:

```sh
node --check src/wanikani-progressive-japanese-ui.user.js
node --test tests/wanikani-progressive-japanese-ui.test.js
```

## License

Copyright © 2026 Johan Emerén. This implementation is open source under the
MIT License included at the repository root.
