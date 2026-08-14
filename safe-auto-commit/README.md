# Wanikani Safe Auto Commit

Lightweight safe auto-commit for WaniKani reviews and optional lesson quizzes.

The installable userscript is:

```text
src/wanikani-safe-auto-commit.user.js
```

Current version: `0.10.10`.

## Behavior

- Auto-submits meaning answers when the typed answer exactly matches an accepted meaning or user synonym.
- Auto-submits reading answers when the typed answer exactly matches an accepted reading.
- Can auto-advance after correct answers.
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

This script is intentionally conservative: it submits only when the normalized input matches known accepted answers. If required WaniKani page structure is missing, it disables itself and shows an update warning.

## Validation

From the repository root, run:

```sh
npm run check
```

## License

Copyright © 2026 Johan Emerén. This script is licensed under the MIT License
included at the repository root.
