# Contributing

This is a personal project maintained by Johan Emerén. Bug reports and focused
feature suggestions are welcome through GitHub Issues. Unsolicited code
contributions are not accepted at this time.

## Maintainer workflow

1. Start from an up-to-date `main` branch.
2. Create a focused branch such as `fix/update-url` or `docs/install-guide`.
3. Keep commits small and coherent. Do not mix unrelated scripts or local
   work into the same commit.
4. Run `npm run check` before pushing.
5. Open a pull request and describe the behavior, user impact, and validation.
6. Squash-merge the pull request after review, then delete the feature branch.

Use explicit paths when staging files in a mixed worktree. Review the staged
snapshot with `git diff --cached` before committing; avoid `git add -A` unless
every visible change belongs to the same commit.

## Userscript releases

Installable userscripts follow semantic versioning in their metadata blocks.

- Increment the patch version for fixes and metadata corrections.
- Increment the minor version for backward-compatible features.
- Increment the major version for incompatible behavior or configuration.

Any change to installable behavior or metadata must update the corresponding
README version. Keep `@namespace`, `@license`, `@downloadURL`, and `@updateURL`
consistent with the repository conventions enforced by the test suite.

Kanji Components is generated. Edit
`kanji-components/scripts/wanikani-kanji-components.template.js`, run
`npm run build:kanji-components`, and commit both the template and generated
userscript.

## Code and documentation

- Prefer clear names and small functions over explanatory comments.
- Comment invariants, browser constraints, fallbacks, and other decisions that
  are not evident from the code itself.
- Document every requested site permission and external dependency.
- Preserve third-party licenses and attribution notices.
