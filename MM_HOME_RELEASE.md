# MM..HOME in the unified app

The installed ScattaBrain app opens **https://scattabraingenius.github.io/the-grind/mm-home/**.
It is an embedded copy, not a redirect to the separate family-planner website.

Source of truth: sibling `../MM..HOME/index.html`. After authorized FP changes, run
`python scripts/update-mm-home.py` here. It preserves the unified app manifest/icon paths,
root service worker, SB2G return link, and checks that cloud configuration matches. It updates
the worker cache identifier from the generated source hash. Review the diff and publish this
repository as well as the standalone FP source repository; verify BOTH live addresses.
Do not replace this page with a redirect that opens outside the installed app's scope.

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
