# Universal Speed Control

A dependency-free userscript for changing the effective speed of common
browser timing APIs.

The installable userscript is:

```text
src/universal-speed-control.user.js
```

Current version: `0.6.0`.

## Behavior

- Runs at `document-start` only on itch.io pages and itch.io's HTML-game CDN,
  including their frames.
- Starts at `1×` with every timing override disabled.
- Can independently scale `setInterval`, `setTimeout`, `performance.now()`,
  `Date.now()`, and `requestAnimationFrame`.
- Supports speeds from `0.1×` to `100×`, including convenient presets.
- Reschedules active timers when the speed or relevant toggle changes while
  preserving their remaining virtual delay.
- Keeps virtual clocks continuous when settings change.
- Limits animation work per rendered frame so an ambitious multiplier cannot
  monopolize the browser's UI thread.
- Shows the measured animation speed achieved relative to real elapsed time,
  including measurements reported by embedded game frames.
- Can test a user-selected visible counter against each timing method and rank
  the counter-rate changes, including counters inside cross-origin frames.
- Saves settings in the current site's `localStorage`, so different origins
  have independent profiles.
- Propagates the top-level site's settings through nested, cross-origin frames,
  which is required for games embedded by hosts such as itch.io.
- Shows one small launcher in the top-level page. Click it to open the controls.

## Install

[Install Universal Speed Control](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/universal-speed/src/universal-speed-control.user.js)
with the open-source [Violentmonkey](https://violentmonkey.github.io/)
userscript manager. Review the declared itch.io site access before confirming.

The script uses an isolated on-page control because a userscript cannot create
a browser-toolbar popup.

## Usage

1. Open the launcher labeled `1× · 0 active` near the top-right corner.
2. Select a multiplier or move the slider.
3. Enable only the timing APIs used by the page.
4. Reload the page if the site captured a native timing function before the
   userscript manager injected this script.

To detect a likely timing method automatically:

1. Choose the speed you ultimately want to use.
2. Click **Detect method**, then click a visible counter that contains exactly
   one number or clock value, such as elapsed time or a score.
3. Leave the page visible while the script measures a 2-second baseline and
   tests each method individually for 2 seconds at `5×`.
4. Review the ranked results and click **Use detected method** when there is a
   clear winner. The original settings are restored before you decide.

The complete probe takes about 13 seconds, including short settling periods.
Use the visible **Cancel** control while selecting, or click
**Cancel detection** while measuring, to restore the original settings.

Start with `setInterval` and `setTimeout`. Enable clock or animation overrides
only when the page needs them; changing every clock at once is more likely to
break unrelated UI, networking timeouts, or anti-abuse logic.

## Limitations

- It affects the current page and its frames, but not Web Workers or
  Service Workers.
- Its metadata currently includes only `itch.io`, `*.itch.io`, and
  `html-classic.itch.zone`. Add more explicit `@match` entries as needed.
- Browser throttling in hidden/background tabs still applies.
- Server-authoritative timers and progress cannot be accelerated.
- Counter detection requires visible DOM text containing exactly one numeric
  value. It cannot inspect numbers drawn only in canvas or WebGL, and probing
  temporarily advances any affected page or game state.
- Code that deliberately restores or captures native functions before this
  script runs can bypass the overrides.
- At high animation multipliers, CPU-heavy pages may achieve less than the
  requested rate. Excess animation work is dropped rather than queued, and the
  control panel reports the measured rate.

## Validation

Run:

```sh
node --check src/universal-speed-control.user.js
node --test tests/universal-speed-control.test.js
```

## License

Copyright © 2026 Johan Emerén. This release is open source under the MIT
License included at the repository root.
