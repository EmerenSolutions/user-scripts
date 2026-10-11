# Wanikani Review Reorder

Reviews in three groups: **radicals → kanji → vocabulary**. Items are shuffled
within each group when a review session opens. For each item, meaning comes
first, then reading. A wrong answer repeats the same question until correct;
the next item starts after the current item is complete. Radicals and kana-only
vocabulary retain WaniKani's meaning-only behavior.

Current version: `1.0.0`.
Installable build: `2`.

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
changes, it may pause with a message rather than reorder. Version `1.0.0` has
not been verified in an authenticated live review session.

## Validation

```sh
npm run check
```

The committed tests use a mock native queue. They cover group shuffling,
full-queue loading, event-driven header classes, initialization, repeated scans,
interrupted navigation, incompatible scripts, malformed responses, input
locking, and preservation of native state. They check the native ordering flags;
they do not exercise WaniKani’s answer checker, real retry progression, wrap-up,
or Safe Auto Commit together with this script.

On 2026-09-25, a separate local integration check also exercised the script
against WaniKani's publicly served queue and cached-statistics modules:
meaning and reading retries stayed on the same item, progression followed the
three groups, and wrong-answer counts reached the native completion API
boundary unchanged. Network submission and SRS calculations were stubbed;
no real reviews were submitted. The external modules are not bundled here.

On 2026-10-11, a local integration check using the currently public queue,
cached-statistics, and wrap-up modules confirmed meaning/reading retries,
meaning-only radicals and kana vocabulary, retained incorrect-attempt counts,
and wrap-up completion/cancellation. The review controller, answer checker,
API submission, and SRS calculations were mocked or bypassed; no network
submissions occurred. These external modules and the temporary harness are not
bundled, so this is supplementary evidence rather than a committed test.

### Authenticated live-check plan

The checks below remain pending for version `1.0.0`, build `2`. Record the
browser, Violentmonkey and script versions, date, and results. Disable other
queue managers first.

1. **Dashboard navigation:** with reviews available, enter regular reviews from
   the dashboard without reloading. Confirm preparation finishes once, input
   unlocks, and the first subject is from the earliest available group
   (radicals → kanji → vocabulary), with meaning/name first.
2. **Reload:** reload before entering an answer. Confirm preparation completes,
   the item count is unchanged, input receives focus, and the initial subject,
   question label, and header agree. A fresh shuffle may produce the same order.
3. **Header colors:** during normal study, check the native radical, kanji, and
   vocabulary colors at group transitions, on retries, and after reload. Confirm
   no stale type color or loss of unrelated theme classes.
4. **Wrong meaning and reading:** when an actual mistake occurs during the
   user’s normal study, advance past feedback and confirm the same subject and
   question repeat. After a correct meaning, reading follows; after a correct
   reading, the next subject follows. Radicals and kana-only vocabulary complete
   after meaning. Verify the native result retains incorrect-attempt counts.
5. **Wrap-up:** during user-led study, toggle wrap-up and confirm its count
   matches the active batch. It should finish that batch without adding backlog
   subjects. Also check cancelling wrap-up resumes the ordered backlog.
6. **Safe Auto Commit:** repeat user-led study with it enabled, including
   auto-advance. Exact accepted meanings/readings should submit and advance once;
   wrong answers should remain manual, with feedback visible before retry.
   Check accepted answers refresh for each new subject/question and no stale
   answer is submitted during preparation or reload.

Navigation and visual inspection can be checked without entering answers. Retry,
completion, wrap-up completion, and auto-submit checks require user-led study;
incorrect attempts affect SRS. Do not submit answers, fabricate mistakes, or
change SRS data as part of an unattended publication review. Until the user-led
checks are complete, authenticated behavior and compatibility remain unverified.
