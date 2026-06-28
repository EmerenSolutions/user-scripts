# WaniKani Userscripts

Personal userscripts and tools for improving the WaniKani study experience.

## Scripts

- `safe-auto-commit` - safely auto-submits matching answers in WaniKani reviews and optional lesson quizzes.
- `kanji-components` - shows whole kanji that appear as visual components inside another kanji.

## Install

Install scripts with a userscript manager such as Tampermonkey or Violentmonkey.

- Safe Auto Commit: `safe-auto-commit/src/wanikani-safe-auto-commit.user.js`
- Kanji Components: `kanji-components/src/wanikani-kanji-components.user.js`

## Naming

- Display names use the official `WaniKani` capitalization.
- In-WaniKani script menu labels omit `WaniKani`, since the context is already clear.
- Userscript filenames use lowercase kebab-case, such as `wanikani-safe-auto-commit.user.js`.
- Script namespaces use this repository URL.

## Development

- `safe-auto-commit` is edited directly as a userscript in `src/`.
- `kanji-components` is generated from a readable template plus bundled decomposition data. Edit `scripts/wanikani-kanji-components.template.js`, then run the build scripts listed in its README.
