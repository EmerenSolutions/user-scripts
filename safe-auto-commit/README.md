# Wanikani Safe Auto Commit

Lightweight safe auto-commit for WaniKani reviews and optional lesson quizzes.

The installable userscript is:

```text
src/wanikani-safe-auto-commit.user.js
```

Current version: `1.0.0`.

## Behavior

- Auto-submits meaning answers when the typed answer exactly matches an accepted meaning or user synonym.
- Auto-submits reading answers when the typed answer exactly matches an accepted reading.
- Can auto-advance only when WaniKani marks the submitted answer correct and the native subject and question type still match.
- Includes a session toggle button.
- Runs only in reviews and enabled lesson quizzes, not in the Lesson Picker or lesson study pages.
- Uses Wanikani Open Framework for persistent settings when available.

## Requirements

- The open-source [Violentmonkey](https://violentmonkey.github.io/) userscript
  manager.
- Wanikani Open Framework is recommended for settings and fallback subject lookup.

## Install

[Install Wanikani Safe Auto Commit](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/safe-auto-commit/src/wanikani-safe-auto-commit.user.js),
review its WaniKani site access, and confirm the installation in Violentmonkey.

## Safety Notes

This script is intentionally conservative: it submits only when the normalized input matches known accepted answers. Asynchronous fallback lookups are discarded when the question changes, settings are saved, or the page navigates. If required submission controls are missing, it disables itself and shows an update warning.

Auto-advance checks WaniKani's native quiz-input controller and input container's
`correct="true"` state after 80 ms. If these are unavailable, the native result
has not settled, or the question or controls have changed, it leaves advancement
to the user. It does not retry a skipped advance.

## Validation

From the repository root, run:

```sh
npm run check
node --test safe-auto-commit/tests/*.test.js
```

The focused tests cover out-of-order ItemData/API lookups, question and page
changes, settings invalidation, stale lookup errors, and guarded advancement.
The root check includes these regression tests; the focused command can also
be run on its own.

### Live verification and limits

Johan confirmed that correct answers submit and advance once, and that wrong
answers, warnings, and delayed grading do not auto-advance. These checks and the
automated regression tests support the first stable release.

The following live checks remain unverified:

- Reading and user-synonym input, paste, and IME composition.
- Enabled lesson quizzes, and behavior with auto-advance disabled or the session
  paused.
- Rapid question changes, manual advancement, and Turbo navigation while WKOF
  fallback lookups are pending.
- Compatibility with other review scripts, especially scripts that alter answer
  grading or question order.

## Release history

### 1.0.0

First stable public release of Wanikani Safe Auto Commit.

- Submit exact accepted meanings, readings, and user synonyms.
- Discard asynchronous answer lookups after a question or page change.
- Advance only after native correct-answer confirmation for the same question.
- Include session controls, optional lesson-quiz support, and WKOF settings.

## License

Copyright © 2026 Johan Emerén. This script is licensed under the MIT License
included at the repository root.
