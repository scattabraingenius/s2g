# MM..HOME in the unified app

The installed ScattaBrain app opens **https://scattabraingenius.github.io/the-grind/mm-home/**.
It is an embedded copy, not a redirect to the separate family-planner website.

Source of truth: sibling `../MM..HOME/index.html`. After authorized FP changes, run
`python scripts/update-mm-home.py` here. It preserves the unified app manifest/icon paths,
root service worker, SB2G return link, and checks that cloud configuration matches. It updates
the worker cache identifier from the generated source hash. Review the diff and publish this
repository as well as the standalone FP source repository; verify BOTH live addresses.
Do not replace this page with a redirect that opens outside the installed app's scope.

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
