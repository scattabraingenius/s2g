# Capture and Vault Sync v2

`/capture/` saves an idea, bar or quote to the Vault in one step. The same capture box is the Capture card on `/dash/`, and the main app's Vault uses the same store.

## Why it exists

Before this change, the main app synced the Vault as one whole array and replaced it with every cloud snapshot. Two kinds of capture were lost:

- an entry saved offline, if the page was closed before it reconnected;
- an entry saved while signed out, wiped at the next sign-in.

`tests/vault-sync-browser.test.cjs` reproduces both against the old code and passes against this one.

## How an entry is kept safe

| Step | Where |
|---|---|
| Enter pressed: the entry is written to its own key, `grind.vault.pending.<key>`, **before** the box clears or says "Saved" | `vault-store.js` `add()` |
| The typed text is kept on every keystroke until then | `grind.capture.draft.<box>` |
| Any page that is signed in sends all local records in one merging transaction | `planners/the-grind-scattabrain-2026/vaultSync/accounts/<uid>` |
| The pending key is removed only once the server holds a record at least that new | `vault-store.js` `absorb()` |
| "Synced" is shown only after that | `capture-ui.js`, main app `renderVaultStatus()` |

Each entry is a record with a revision `[time, device]`. The later revision wins. A delete is a tombstone that keeps the text, so **Recently deleted** in the main Vault can restore it. Merging is order-free and idempotent, the same pattern as `lyrics/sync.js`, `audio/album/planner-sync.js` and `studio/studio-sync.js`.

## Compatibility with the old format

- The main app still writes the old `vault` array, and `grind.vault.v1`, as a **mirror** of the live entries, so older tabs and JSON exports keep working.
- An incoming old array (from a cloud snapshot, `grind.vault.v1` or an import file) is merged as a **union**: it can add entries and newer edits, but it never deletes anything and never brings back a deleted entry.
- A delete made in a stale tab that still runs the old code does not stick. Reload every device after deploying.

## Files

| File | Role |
|---|---|
| `vault-sync.js` | Records, merge, validation, old-format import (pure) |
| `vault-store.js` | Local storage, pending changes, cloud sync |
| `cloud.js` | Lazy Firebase load and Google sign-in for pages other than the main app |
| `capture-ui.js`, `capture.css` | The capture box |
| `index.html`, `manifest.webmanifest`, `icons/` | The installable capture page |

Install it on a phone with Add to Home Screen. On Windows, install it from the browser, then set a shortcut key in the shortcut's Properties. On a Stream Deck, use the built-in Website action with `https://scattabraingenius.github.io/s2g/capture/`.

## Tests

Unit tests run with Node and need nothing else:

```
node tests/vault-sync.test.cjs
node tests/next-task.test.cjs
```

The browser tests need the `playwright` package (on `NODE_PATH` or installed locally) and a Chromium browser: Edge by default, or `BROWSER_EXECUTABLE`. They serve the repository themselves and use a fake Firebase (`tests/helpers/fake-firebase.cjs`), so no real account is touched:

```
node tests/vault-sync-browser.test.cjs
```
