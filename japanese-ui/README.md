# Wanikani Progressive Japanese UI

Replaces selected interface labels with Japanese vocabulary learned through
WaniKani.

The installable userscript is:

```text
src/wanikani-progressive-japanese-ui.user.js
```

Current version: `1.0.0`.

Stable release. Translates eligible WaniKani interface text while preserving
subject meanings and study content.

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
- Uses curated UI senses for known labels; a learned dictionary meaning cannot
  override them with an unrelated sense (for example, research for `Study`).
- Treats abbreviated weekday labels in Review Forecast as dates. `Sun` becomes
  `日曜日` only after that weekday vocabulary is learned; learning the word for
  the sun does not unlock the weekday. Elsewhere, ordinary vocabulary still
  uses the learned-meaning map.
- Translates exact UI labels and count-prefixed labels such as `10 Lessons`.
- Watches dynamically rendered dashboard and lesson picker content, and
  WaniKani Turbo navigation.
- Releases tracking records when dynamic sites remove translated UI nodes, so
  detached content does not accumulate during long sessions.
- Uses one site-wide match for `https://www.wanikani.com/*`, so browsing pages
  and Turbo navigation work without adding individual URLs. Includes kanji,
  radical, vocabulary, level, subject-detail, dashboard, and lesson-picker pages.
- Translates UI headings and navigation while protecting shared subject cards:
  their characters, readings, and English meanings remain unchanged everywhere.
- Leaves subject-detail content intact, including Primary, Alternatives, User
  Synonyms, mnemonics, explanations, context sentences, and notes. Section
  headings outside protected content can still translate.
- Uses subject-link destinations as a fallback when a card lacks the standard
  WaniKani class. `[data-japanese-ui-ignore]` also opts a subtree out.
- Excludes active review, extra-study, and lesson sessions. Restores labels when
  Turbo navigation enters these sessions and resumes on a browsing page.
- Runs in Violentmonkey's isolated content context. Uses the saved vocabulary
  cache immediately when available, then refreshes through WKOF. If refreshing
  fails, existing cached translations remain available.
- Avoids editable forms and code, releases detached text-node records, and
  restores translations if a node moves into protected content or its parent
  becomes protected.
- Uses a short-lived WaniKani-only bridge to request minimized vocabulary and
  assignment data from WKOF, then removes the bridge. The API token is never
  copied or exposed to other sites.

## Requirements

- An open-source userscript manager such as Violentmonkey.
- [Wanikani Open Framework](https://community.wanikani.com/t/28549), used to
  read cached subject and assignment data from WaniKani's API.

The script does not request or store an API token itself.

## Install

[Install Wanikani Progressive Japanese UI](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/japanese-ui/src/wanikani-progressive-japanese-ui.user.js),
review the WaniKani page access and storage permissions, and confirm the
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

Reload WaniKani after installation to apply the update and
refresh the learned-word cache. Visit the dashboard again after completing
new lessons to update the cache.

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

Automated tests cover weekday context, learned-vocabulary gates, dynamically
inserted forecast labels, restoration for Turbo caching, dashboard/lesson-picker
navigation, and preserving host text updates and control attributes.

Live Firefox checks confirmed navigation translation and preserved subject
meanings, Primary, Alternatives, and User Synonyms on vocabulary and radical
pages. The general dictionary map remains heuristic.

Regression checklist for future changes in Firefox with Violentmonkey and WKOF:

- Confirm the dashboard forecast markup matches the context selectors, including
  separate weekday/date text nodes and a learner without weekday vocabulary.
- With Review Forecast Open Today enabled, confirm today opens on initial load,
  frame refresh, and return from the lesson picker even when weekday labels are
  Japanese. Older English-only weekday matching is incompatible with translated
  labels; use the updated companion script and verify compatibility.
- Manually close today and confirm it stays closed until the forecast refreshes.
- Navigate dashboard → lesson picker → lesson session → dashboard using Turbo
  and browser Back/Forward. Confirm picker controls work, study content remains
  intact, and cached labels restore correctly. Also start on a quiz page and
  return to browsing to check that translation resumes.
- Check kanji, radical, vocabulary, and level lists: headings/navigation should
  translate while every card meaning stays English. On each subject-detail
  type, confirm Primary, Alternatives, User Synonyms, notes, and explanations
  remain unchanged, including content loaded dynamically.
- Check visible labels against their intended UI sense with a larger learned
  vocabulary set; the general dictionary map remains heuristic.

## License

Copyright © 2026 Johan Emerén. This implementation is open source under the
MIT License included at the repository root.
