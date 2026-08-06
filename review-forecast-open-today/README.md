# WaniKani Review Forecast Open Today

A lightweight userscript that opens today's hourly Review Forecast schedule on
the WaniKani dashboard.

The installable userscript is:

```text
src/wanikani-review-forecast-open-today.user.js
```

Current version: `0.3.2`.

## Behavior

- Runs only on the WaniKani dashboard.
- Opens the current weekday in the Review Forecast widget after it loads.
- Leaves the widget alone when today's schedule is already open.
- Stays closed if you close it manually, until WaniKani reloads the widget.
- Re-runs after WaniKani Turbo navigation and widget reloads.
- Fails quietly when the expected Review Forecast controls are unavailable.

## Install

[Install Review Forecast Open Today](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/review-forecast-open-today/src/wanikani-review-forecast-open-today.user.js)
with the open-source [Violentmonkey](https://violentmonkey.github.io/)
userscript manager. Review the declared WaniKani site access before confirming.

The script retains its original `wanikani-userscripts` namespace so an existing
installation keeps the same userscript identity after the repository move.
Install this release once even if version `0.3.1` is already present: the old
repository's raw update URL is no longer available, and this updates the saved
download and update addresses to their current locations.

## Privacy and permissions

- Requests access only to `www.wanikani.com` and `preview.wanikani.com`.
- Uses no privileged userscript APIs (`@grant none`).
- Makes no network requests and stores no data.
- Activates only WaniKani's existing Review Forecast control.

## Limitations

- WaniKani markup changes can prevent the forecast row from opening.
- The script does not alter, accelerate, or schedule reviews.
- It does not run inside frames or outside the dashboard.

## Validation

From the repository root, run:

```sh
npm run check
```

## License

Copyright © 2026 Johan Emerén. This script is licensed under the MIT License
included at the repository root.
