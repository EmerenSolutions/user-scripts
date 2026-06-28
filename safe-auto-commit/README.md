# WaniKani Safe Auto Commit

Lightweight safe auto-commit for WaniKani reviews and optional lesson quizzes.

The installable userscript is:

```text
src/wanikani-safe-auto-commit.user.js
```

Current version: `0.10.6`.

## Behavior

- Auto-submits meaning answers when the typed answer exactly matches an accepted meaning or user synonym.
- Auto-submits reading answers when the typed answer exactly matches an accepted reading.
- Can auto-advance after correct answers.
- Includes a session toggle button.
- Uses WaniKani Open Framework for persistent settings when available.

## Requirements

- A userscript manager such as Tampermonkey or Violentmonkey.
- WaniKani Open Framework is recommended for settings and fallback subject lookup.

## Safety Notes

This script is intentionally conservative: it submits only when the normalized input matches known accepted answers. If required WaniKani page structure is missing, it disables itself and shows an update warning.
