# Wanikani Review Reorder

Reviews in three groups: **radicals → kanji → vocabulary**. Items are shuffled
within each group when a review session opens. For each item, meaning comes
first, then reading. A wrong answer repeats the same question until correct;
the next item starts after the current item is complete. Radicals and kana-only
vocabulary retain WaniKani's meaning-only behavior.

Current version: `0.1.0`.
Installable build: `1` (beta).

## Installation

Install [Wanikani Review Reorder](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/review-reorder/src/wanikani-review-reorder.user.js)
with [Violentmonkey](https://violentmonkey.github.io/). Disable Reorder Omega before trying
this script: running two queue managers together is unsupported, and this
script pauses if it detects Queue Manipulator. Keep Omega installed if you
want to be able to switch back. Neither Omega nor Queue Manipulator is needed
by Wanikani Review Reorder; WKOF is not required either.

Reload WaniKani after installation.

### Local development installation

From the repository root:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open this URL in Firefox and install through Violentmonkey:

```text
http://127.0.0.1:8765/review-reorder/src/wanikani-review-reorder.user.js
```

Close the installer and stop the server. Reload WaniKani before starting a
review session. No local-file access or Track external edits is required.

## Behavior and boundaries

- Applies only to regular reviews, including dashboard-to-review Turbo
  navigation and full page loads. Lessons and Extra Study are unaffected.
- Temporarily locks review input while collecting and ordering the current
  queue. Missing subjects are fetched from WaniKani in batches of up to 100,
  with at most two requests at a time. This includes radicals that were not in
  the initial preloaded batch.
- Changes the existing native queue once, before any answer. Does not clone
  controllers, replace WaniKani's answer checker, clear statistics, or send
  review results itself. Incorrect attempts still count toward the SRS result.
- Uses native meaning-first and complete-subjects-in-order controls. Normal
  feedback and advance controls still apply; Safe Auto Commit can advance
  correct answers as usual. Wrong-answer feedback remains visible until you
  advance to retry.
- Synchronizes header type classes from the actual question event; no delayed
  color writes and no hard-coded colors. Other header classes are retained.
- Keeps WaniKani's wrap-up behavior: finish the active batch when wrapping up.
- Refuses to reorder after an answer, after completion counts change, or while
  the native queue is fetching or wrapping up. Fetch errors release the input
  and show a status message so the original session can continue.
- No settings screen, filtering, persisted preferences, API token, analytics,
  or external requests. A fresh session/reload gets a fresh random order.

The script uses WaniKani's internal review controller. If that interface
changes, it may pause with a message rather than reorder. This beta has not
been verified in an authenticated live review session.

## Validation

```sh
npm run check
```

Tests cover group shuffling, full-queue loading, event-driven header colors,
initialization, duplicate initialization, interrupted navigation, incompatible
scripts, malformed responses, input locking, and preservation of native state.

On 2026-09-25, a separate local integration check also exercised the script
against WaniKani's publicly served queue and cached-statistics modules:
meaning and reading retries stayed on the same item, progression followed the
three groups, and wrong-answer counts reached the native completion API
boundary unchanged. Network submission and SRS calculations were stubbed;
no real reviews were submitted. The external modules are not bundled here.

Before promoting this beta to a full release, verify dashboard navigation and
reload with real reviews available, test a wrong meaning and a wrong reading,
and confirm the first item and header color agree. The live check should use
actual study answers, because incorrect attempts affect SRS.
