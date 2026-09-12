# MM..HOME in the unified app

**Canonical URL (new, 2026-09-12):** https://scattabraingenius.github.io/s2g/mm-home/, embedded
in https://scattabraingenius.github.io/s2g/. **Compatibility URL (preserved):**
https://scattabraingenius.github.io/the-grind/mm-home/, embedded in
https://scattabraingenius.github.io/the-grind/ — Jason's already-installed app still opens this
one and is unaffected by the s2g migration; see "s2g URL migration" below before repointing it.
Both are embedded copies, not redirects to the separate family-planner website.

Source of truth: sibling `../MM..HOME/index.html`. After authorized FP changes, run
`python scripts/update-mm-home.py` here. It preserves the unified app manifest/icon paths,
root service worker, SB2G return link, and checks that cloud configuration matches. It updates
the worker cache identifier from the generated source hash. Review the diff and publish this
repository, its `s2g` mirror (see below), and the standalone FP source repository; verify all
three live addresses. Do not replace this page with a redirect that opens outside the installed
app's scope.

## Bank "Send money" and "Pay back" embed — 2026-09-12 (implemented, NOT yet published)

Source FP change: `Apps\MM..HOME\docs\handoff-to-c.md` ("Bank 'Send money' and 'Pay back'" section).
`python scripts/update-mm-home.py` run here against the updated source, embedding the new Bank
transfer feature (Send money, Pay back, `bankParticipants()` household-total fix) into
`mm-home/index.html` unchanged in structure — only the two files the script always touches changed:
`mm-home/index.html` (embedded FP source, cache-hash-derived) and `service-worker.js` (its
`CACHE_NAME` hash bump). Shared app-bar block assertion passed (no divergence between the two
`index.html` copies), so the embed was not blocked.

**Testing against this checkout:**
- `tests/unified-pwa.test.cjs` run **unchanged** against a local static-server copy of this
  worktree — passed (shared app bar, Life Admin, Time, Bank, phone/desktop layout, service worker,
  Grind engine).
- The same isolated Bank-transfer suite used for the standalone FP repo
  (`Resources\FamOS-local-verification-2026-09-11\bank-transfer-check.cjs`, 28 checks) run against
  `/mm-home/` in this checkout — passed identically to the standalone copy: worked example, gift
  path, conservation, Dad as sender/recipient without job/allowance/clothing enrollment, the
  household total fix (Dad included via `bankParticipants()`), linked-history protection, and every
  other check listed in the FP handoff.
- No production Firebase data or live household records were read, written, or connected to.

**Not yet done:** not committed or pushed to `the-grind`/`s2g`/`family-planner` — misc review is the
next gate per `Resources\FamOS-local-verification-2026-09-11\CLAUDE-BANK-TRANSFERS.md`. Once
authorized to publish, this repository, its `s2g` mirror, and the standalone `family-planner` repo
all need the paired release, and all three live URLs need re-verification (see the paired-release
policy in root `AGENTS.md`).

## s2g URL migration — 2026-09-12 (published)

Jason requested the unified app's URL become `/s2g/` (confirmed spelling). Per the paired-release
policy recorded in root `AGENTS.md` ("Shared Family Planner releases — Jason confirmed
2026-09-12"), both delivery paths were verified live together.

- **the-grind repo** (`scattabraingenius/the-grind`, this checkout): `main` fast-forwarded
  `ea6096a` → `83b5bbf` (the previously-approved but unpublished unified build) → `ce3b749`
  (adds the cache-scope fix below). No force push. Live and `Pages` build confirmed `built` at
  `ce3b749` via the Pages API.
- **New `scattabraingenius/s2g` repo**: created public, seeded with `the-grind`'s **full git
  history** (`git push` of the same branch tip, not a squashed copy), Pages enabled from `main`.
  Live and confirmed `built` at `ce3b749`.
- Both `https://scattabraingenius.github.io/the-grind/` and `https://scattabraingenius.github.io/s2g/`
  (and their `/mm-home/` embeds) serve byte-identical content as of `ce3b749`. Old hash routes
  (`#time`, `#calendar`, etc.) verified working on both.
- **Cache-scope fix (`ce3b749`):** `service-worker.js`'s `CACHE_NAME` was a bare content-hash
  literal with no per-site component. Cache Storage is per-*origin*, not per-registration-*scope*,
  so `/the-grind/` and `/s2g/` sharing `scattabraingenius.github.io` meant one site's `activate`
  cleanup could delete the other's live cache once their content hashes diverge on a future
  release. Fixed by suffixing the cache key with a scope-derived id (`CACHE_KEY = CACHE_NAME +
  ":" + SCOPE_ID`), appended so the key still starts with the plain `CACHE_NAME` literal that
  `scripts/update-mm-home.py`'s regex substitution and `tests/unified-pwa.test.cjs`'s
  `key.startsWith("scattabrain-unified-shell-v5-")` assertion both depend on. Verified live in an
  isolated browser context that visited both origins: each got its own distinct cache key
  (`...:the-grind` / `...:s2g`), and forcing a service-worker update cycle on one did not delete
  the other's cache.
- **Installed-app identity — do not claim auto-migration.** `manifest.webmanifest` has relative
  `id`/`start_url`/`scope` (all `"./"`), confirmed identical at both live URLs. Per the Web App
  Manifest spec these resolve against each site's own URL, so `/the-grind/`'s installed identity
  and `/s2g/`'s are genuinely different apps to the OS/browser. **Jason's existing installed app
  keeps opening `/the-grind/` unchanged; it will not update in place.** Installing `/s2g/` (a
  fresh "Add to Home Screen"/Install action against that URL) creates a second, separate installed
  entry. Migrating means: install from the new URL, confirm it, then optionally remove the old
  installed shortcut — a manual, user-driven step, not something this release can perform for him.
- **Testing:** `tests/unified-pwa.test.cjs` run **unchanged** (not weakened) against a local
  static-server copy — passed. Also run against the live `/the-grind/` and `/s2g/` URLs: the
  known DOMContentLoaded icon-readiness race (2.6MB shared nav-icon atlas over real network
  latency vs. the near-zero-latency local server the test assumes) reproduced on both, confirmed
  via a throwaway `networkidle`-waiting diagnostic script that the same icons do finish loading
  correctly on both live sites — not a regression, a pre-existing environmental limitation of
  this assertion against a remote host, left as-is per instruction not to weaken the test.
  Targeted live checks (old/new hash routes, offline shell at root and `/mm-home/` on both sites,
  cross-site cache isolation) all passed; see `claude-s2g-release-status.md` for full evidence.
- **family-planner (kids standalone) repo:** untouched. Already current at `main` `0bff940`
  (content `cb0cba9`) from the prior kids release; verified live content still byte-identical to
  that commit. No shared-planner change was needed for this release.
- **Next action / limitations:** live verification is complete for both unified URLs. Physical
  device install-and-launch acceptance of the new `/s2g/` URL is Jason's first-use check, same as
  every prior release in this document. No redirect was added from `/the-grind/` to `/s2g/`
  (would break the old installed app's service-worker scope); both stay live during the
  transition per instruction.

## 2026-09-11 shared app bar (local, not published)

The SB2G page and MM..HOME now use one shared app bar (see MM..HOME `docs/handoff-to-c.md`,
1.21-beta). The embed script changed: instead of injecting a `🧠 SB2G` link it sets
`SB2G_URL="../"` and `NAV_ICON_BASE="../icons/nav/"`, copies `MM..HOME/icons/nav/*.png` to
`icons/nav/`, and asserts the two shared blocks are identical. The unified worker precaches the
nav icons. This host has no Python, so the embed was produced by an exact PowerShell port of the
script (its cache-hash method reproduced the committed `12585e14bc7b` before use); run the Python
script once on a machine that has it and confirm it produces no diff.

SB2G page (v1.2-beta): title/subtitle removed; SB2G button, large live clock and two-line date in
the bar; Home/Calendar/Agenda/Life Admin open the embedded planner; **Time** (`#time`) shows The
Grind (renamed from The Other Grind — labels only, storage keys unchanged) and the Time button
shows a dot while a session runs (red once time is reached). Up Next and Important Dates are
hidden, not deleted. Sync, account, Sound, Print, Export, Import, Sign in/out and today's progress
moved to a Settings & tools footer. Pre-release review fix: switching views commits inline edits
and cancels an open Grind session edit when Time is left (a hidden editor had been holding back
dashboard re-renders); a half-typed task editor is kept. `tests/unified-pwa.test.cjs` was rewritten for the new bar but
could not be run here (no Node); `tests/og-engine.test.html` passed 83/83 against the new source.

## 2026-09-08 release

Updated the embedded planner from the old Today/Money/dropdown UI to FP 1.20-beta with
Home/Chores/EHAH, remembered person, immediate points, bulk/Other descriptions, score editing,
countdown and weekly/all-time history. Preserved manifest scope and SB2G return navigation.
The unified worker now revalidates navigation and only retires its own cache names.
No local-storage keys, cloud configuration or household records were changed by testing.

30 isolated EHAH checks passed against the embedded file. A separate local HTTP/PWA check passed
same-tab navigation from FP to SB2G and back, visible EHAH navigation, remembered profile,
shared manifest/worker scope and offline EHAH reload. Phone layout inspected.
Physical installed-iPhone acceptance is still Jason's first-use check.
