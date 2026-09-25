# Browser Userscripts

Open-source, dependency-light userscripts for WaniKani study tools,
progressive Japanese immersion, browser games, and webtoon reading.

## Scripts

| Script | Purpose | Runs on | Version | Install |
| --- | --- | --- | --- | --- |
| [Wanikani Review Reorder](review-reorder/README.md) | Groups randomized reviews by type, with meaning first and immediate retries. | WaniKani reviews | `0.1.0` | [Install (beta)](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/review-reorder/src/wanikani-review-reorder.user.js) |
| [Wanikani Safe Auto Commit](safe-auto-commit/README.md) | Submits only exact accepted answers during supported WaniKani quizzes. | WaniKani | `0.10.10` | [Install](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/safe-auto-commit/src/wanikani-safe-auto-commit.user.js) |
| [Wanikani Kanji Components](kanji-components/README.md) | Shows whole kanji used as visual components inside the current kanji. | WaniKani | `0.1.16` | [Install](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/kanji-components/src/wanikani-kanji-components.user.js) |
| [Wanikani Review Forecast Open Today](review-forecast-open-today/README.md) | Opens today's hourly Review Forecast schedule on the dashboard. | WaniKani | `0.3.3` | [Install](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/review-forecast-open-today/src/wanikani-review-forecast-open-today.user.js) |
| [Wanikani Progressive Japanese UI](japanese-ui/README.md) | Replaces eligible interface words with vocabulary already learned in WaniKani. | WaniKani dashboard and lesson picker | `0.2.0` | [Install](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/japanese-ui/src/wanikani-progressive-japanese-ui.user.js) |
| [Universal Speed Control](universal-speed/README.md) | Adjusts browser timers and animation clocks with per-site controls. | itch.io games, CrazyGames | `0.7.0` | [Install](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/universal-speed/src/universal-speed-control.user.js) |
| [Webtoon Gap Trimmer](webtoon-gap-trimmer/README.md) | Shortens blank white bands inside chapter images. | MangaKakalot | `0.1.1` | [Install (beta)](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/webtoon-gap-trimmer/src/webtoon-gap-trimmer.user.js) |

Wanikani Review Reorder and Webtoon Gap Trimmer are beta releases. See each
script’s README for supported behavior and validation limits.

## Installation

1. Install the open-source [Violentmonkey](https://violentmonkey.github.io/)
   userscript manager.
2. Use an **Install** link above.
3. Review the requested sites and permissions, then confirm the installation.
4. Reload any page that was already open.

Most WaniKani scripts integrate with
[Wanikani Open Framework](https://community.wanikani.com/t/28549). Review Reorder
runs independently. See each script’s README for its exact requirements.

Only the sites declared by a script's `@match` metadata can run that script.
The source files also declare GitHub-hosted update URLs, so userscript managers
can detect releases merged into `main`.

A userscript's name and namespace form its installation identity. Wanikani
script display names follow the `Wanikani …` standard. Safe Auto Commit, Kanji
Components, and Review Forecast Open Today retain their original
`wanikani-userscripts` namespace after the repository rename. New scripts use
the current repository URL as their namespace.

## Privacy and security

- No script sends analytics or telemetry.
- Review Reorder only fetches items already in the active review session from
  WaniKani. It stores no data and leaves answer submission to WaniKani.
- Kanji Components uses its bundled decomposition map and makes no requests to
  an external component database at runtime.
- Review Forecast Open Today only activates an existing dashboard control; it
  makes no network requests and stores no data.
- Progressive Japanese UI stores its learned-vocabulary cache in
  Violentmonkey storage and runs in an isolated content context. A temporary
  bridge accesses WKOF only on WaniKani; the API token is not copied to other
  sites.
- Universal Speed Control stores per-origin settings in `localStorage` and
  does not communicate with a remote service.
- Webtoon Gap Trimmer analyzes pixels locally and may download existing chapter
  images from their CDN without cookies. It uploads no image data.
- Review a userscript's metadata and source before installing it. Report
  security concerns through GitHub's private vulnerability reporting.

## Development

Node.js 22 or newer is required. Run the complete repository check with:

```sh
npm run check
```

Regenerate the bundled Kanji Components data and installable script with:

```sh
npm run build:kanji-components
```

The generated userscript is committed so its raw GitHub URL remains directly
installable. Repository tests verify that the generated file matches its
template and data source.

## Repository layout

Each script owns a directory containing its documentation, installable source,
and tests or build inputs. Shared repository policy and automation live at the
root.

```text
user-scripts/
├── review-reorder/
├── safe-auto-commit/
├── kanji-components/
├── review-forecast-open-today/
├── japanese-ui/
├── universal-speed/
├── webtoon-gap-trimmer/
├── scripts/
└── tests/
```

## License

Original code and documentation are licensed under the [MIT License](LICENSE).
Vendored third-party material retains its original license; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
