# Salesforce Connection Popup Dismiss

Current version: `0.2.1`.

Build: `4`. Beta; installable source: `src/salesforce-connection-popup.user.js`.

Prevents App Builder from creating its offline dialog when the message is:

> Check your Internet connection and try again.

Once the builder initializes, the script replaces its dedicated `onShowOffline`
display handler and cached action implementation. For this exact warning it
returns before Salesforce creates the panel, backdrop, or dialog-open flag.
Other messages and actions retain their native behavior. The installed script
name stays unchanged so this updates existing installations.

The handler is identified by its component, method name, and expected source
markers. If Salesforce changes these internals, or the userscript manager cannot
access the page context, the script falls back to clicking the exact matching
popup's own close control. That fallback also covers generic Aura error masks,
matching frames, and warnings shown before initialization. A brief flash is
possible in fallback mode. Only the exact English wording is supported, with
whitespace normalized.

This removes the interruption; it does not repair connectivity or retry failed
operations. Check Salesforce's save confirmation before leaving your edits.
Disable the script in Violentmonkey and reload to see these connection warnings again.

## Installation

Install [Salesforce Connection Popup Dismiss](https://raw.githubusercontent.com/EmerenSolutions/user-scripts/main/salesforce-connection-popup/src/salesforce-connection-popup.user.js)
with [Violentmonkey](https://violentmonkey.github.io/), then reload Salesforce.

To install the current local copy in Firefox:

1. From the repository root, run `python3 -m http.server 8765 --bind 127.0.0.1`.
2. Open `http://127.0.0.1:8765/salesforce-connection-popup/src/salesforce-connection-popup.user.js` in a new Firefox tab.
3. Verify the name and local source, click **Install**, and wait for **Script installed**.
4. Close the installer/source tabs and stop the server with Ctrl+C.
5. Finish saving any pending work, then reload Salesforce.

Reopen that local URL for later updates. Local-file access is not required.

## Scope and privacy

Runs on `*.lightning.force.com`, `*.my.salesforce-setup.com`, and the
`/visualEditor/` path on `*.my.salesforce.com`. This includes sandbox subdomains.
Other domains and translated messages are not supported by this beta.
It makes no network requests, stores no data, and does not change Salesforce's
request handling or diagnostic error reporting. It uses the page context when
available to intercept the dedicated display handler. In Firefox content mode,
`wrappedJSObject` and `exportFunction` provide the supported bridge without
changing CSP or browser security settings; see the
[Violentmonkey context documentation](https://violentmonkey.github.io/posts/inject-into-context/). Fixed console messages
report prevention or immediate dismissal without record or page details.

## Validation

Run `npm run check`, or `node --test salesforce-connection-popup/tests/*.test.js`.

The 21 script tests cover exact-message matching, unrelated errors, reused and
replaced dialogs, delayed controls, failed close handlers, native argument and
return-value preservation, missing labels, changed or read-only Aura internals,
Firefox export failures, repeated initialization, and client-side navigation.
The complete repository check includes 104 tests and JavaScript syntax checks.

Version 0.2.1 (build 4) was tested in Firefox with Violentmonkey on 2026-09-29
against a Salesforce sandbox Account record page:

- Twenty consecutive native offline actions, five spaced actions after save
  recovery, and one after reload created zero App Builder modal nodes. The
  native dialog-open flag stayed false.
- With a temporary description edit, Firefox's per-tab Offline mode caused
  the real `Builder.saveInstances` request to fail with `NS_ERROR_OFFLINE`.
  No connection dialog or false save confirmation appeared. After restoring
  the connection, retrying Save returned HTTP 200 and showed `Changes saved.`.
- An unrelated Aura error containing the warning sentence remained visible.
  The normal Activation dialog also remained usable.
- Generic Aura warnings were dismissed in both the builder and its canvas.
- The original description was restored and saved. Reloading confirmed the
  original page configuration, with no pending edits. The tab was left online.

These checks cover the observed Salesforce build. The userscript uses private
Aura internals, so future Salesforce changes may require an update. The source
signature check is a compatibility guard, not a guarantee that future handlers
with the same markers are unchanged. Firefox's exported callback is covered by
live testing; the automated bridge test uses a stub and does not reproduce
Firefox's compartment security. Other browsers have not been verified live.

The publication audit added regression coverage and documentation only; the
runtime remains the same version 0.2.1 tested and installed locally.

## License

Copyright © 2026 Johan Emerén. Licensed under the repository's MIT License.
