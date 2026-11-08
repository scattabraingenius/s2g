# Lyric Board

A page inside The Grind for the 2026 album: every song from the writing sessions in one list. Read the lyrics, copy each Suno field with one tap, score songs 0 to 100, mark them Shortlist, Maybe or Cut, keep notes, and build the tracklist.

Built by Cue (Claude), October 9, 2026.

## Open it

Serve The Grind as usual and go to `/lyrics/`. For example, from `ScattaBrain to Genius`:

    python3 -m http.server 8765 --bind 127.0.0.1

then open http://127.0.0.1:8765/lyrics/

## Update the songs

The song list is a generated file, `songs.js`. After new songs land in SBGLP, run:

    python3 lyrics/build_songs.py

It discovers every dated session folder in `SBGLP/02 Album Project/Writing Sessions`. Pass that folder explicitly when working from another checkout:

    python lyrics/build_songs.py "D:\SYNCt\SBGLP\02 Album Project\Writing Sessions"

Future dated sessions and their filter chips are discovered automatically. Song packets use `<slug>_v<version>_<writer>_lyrics.md`; accompanying Suno fields are read from `Suno Pass`. Missing prompts are shown as missing, rather than invented from the notes. `cg` is displayed as Misc; source filenames stay unchanged. Instrumental-style prompts are included when provided. Newest sessions appear first.

The October 8 and October 9 version IDs stay unchanged so existing scores, notes, picks and copies retain their links. Other sessions use IDs that include the session folder, keeping repeated filenames distinct. Building refuses missing/empty sources and duplicate IDs, verifies hashes after reading, and refreshes the offline-cache version. `--manifest <path>` writes an optional source-hash receipt. Source song files are never changed.

## Rating and your own versions

Each version of a song has its own score, Shortlist/Maybe/Cut and notes. The song list shows the best score across a song's versions. **Copy & edit** makes your own copy of the version you are viewing, with editable name, title, style, exclude and lyrics that save as you type. The Copy buttons use your edited text. Your versions appear as extra chips on the song, are never touched by `build_songs.py`, and can be deleted. The **My versions** filter lists songs that have one.

## Work in a session

Use the **All songs** dropdown beside search to show one song and its versions. Songs are listed alphabetically; the selection combines with search, session, and rating filters. Choose **All songs** to restore the full list within the current session.

Click a session in **Working session** to see only its songs and versions. The session stays selected while rating, writing notes, changing status, editing copies and receiving cloud updates. Session scope is separate from the rating/status filters. Search, the visible version chips, the best-score badge and rating sort all use the selected session. The working session, filter and sort are remembered in this browser after reload. Choose **All** to compare across sessions.

Every song remains one card. Its version chips show each version's label, score and status; tap one to open that exact version. For multiple versions, the large badge is labelled **BEST**. **Sort: best score** ranks cards by their highest score within the working session and orders the chips by score. Unrated versions show a dash; a score of zero is retained. Other sessions' scores do not influence the selected session's ranking.

Use **+ New session** to create a named custom session such as Album finalists. Pick individual versions across any writing sessions. A new session can start with the current working session or with the existing tracklist. **Manage session** changes its name and membership or deletes just that session. A version can belong to several custom sessions. The detail panel's **Add version to a custom session** control adds the current version; **Remove from session** removes membership without deleting the version or rating. Copies made within a custom session automatically join it. Original writing packets are never moved, renamed or edited.

Custom names and memberships sync through the existing private account record map. Membership uses independent records, so concurrent additions merge; a removed version is not restored by a stale device. Deleting a custom session keeps songs, scores, notes and copied versions. Export/import includes custom sessions. Refresh other devices after this release: older open tabs cannot interpret the added session records and will stop cloud sync with an explicit error until reloaded, while retaining local edits.

Title, style prompt, excluded styles and lyrics have separate visible boxes, each with its own Copy button and character count. The displayed lyrics are exactly the Suno copy text. When the writing draft differs, it remains available under **Full writing draft**. Original packets are read-only; **Copy & edit** makes an editable version. Search covers prompts and every version, including your own. A **Back to songs** button returns phone users to the selected row. Copy and storage failures are reported explicitly.

## Where your scores live

Refresh Lyric Board on the phone that holds your existing ratings, then on your PCs. Use the same Google account on each device. The page restores The Grind's existing sign-in on the same browser origin; if it is signed out, use **Sign in with Google**. Wait for **Synced across devices** before closing the page. Ratings, Shortlist/Maybe/Cut, notes, editable copies and tracklist sync automatically. The selected version and search/filter choices remain local to each browser.

The existing localStorage key `grind.album.v1` stays in use. The first sync keeps a separate `grind.album.v1.before-cloud-sync` backup. Offline edits and their pending revisions are saved locally and merge when you reconnect. Signing out keeps your local data; switching accounts uses separate caches and does not upload the previous account's data. **Export scores** and **Import scores** remain available for separate backups. Import replaces this account's current board content and syncs that change.

Cloud data lives only at `planners/the-grind-scattabrain-2026/album/accounts/<Google UID>` in the existing Firebase Realtime Database. No database listener attaches while signed out. Existing planner access rules apply; this release does not change those rules. A denied read is an error, never an empty board. An empty PC cannot clear phone ratings. Each rating field has its own revision, so a concurrent score edit and note edit both survive. Concurrent edits to the same field resolve to the later revision; clock ties resolve consistently. Custom copies resolve per version; session names resolve per session, membership per version. Deleted copies, custom sessions and removed tracks/memberships keep tombstones so stale devices cannot silently restore them. Firebase transactions merge the account's record map without touching planner tasks, family data or any other account.

The sync badge reports saving, synced, offline, and failures separately. Failed writes retain the local queue and offer **Retry sync**. Remote updates do not replace a focused editor. If local storage fails, export a backup before closing. Firebase's [authentication persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence), [transaction semantics](https://firebase.google.com/docs/database/web/read-and-write) and [inherited access rules](https://firebase.google.com/docs/database/security/core-syntax) inform this implementation.

## Verification

    python -B tests/album-board-import.test.py
    APP_BASE_URL=http://127.0.0.1:8765 node tests/album-board.test.cjs
    node tests/album-sync.test.cjs
    APP_BASE_URL=http://127.0.0.1:8765 node tests/album-sync-browser.test.cjs
    APP_BASE_URL=http://127.0.0.1:8765 node tests/album-sessions.test.cjs

The browser runner uses the existing external Playwright installation via `NODE_PATH` and accepts `BROWSER_EXECUTABLE` and `ARTIFACT_DIR`. It creates a fresh browser context, uses synthetic scores, substitutes a fake clipboard, and blocks all non-local requests. No real account or existing browser profile is touched.

Sync checks use two independent browser contexts and an isolated transactional backend that replaces Firebase SDK requests. They cover migration, concurrent changes, offline reload, deletion, denied reads/writes, retry, account switching and redirect fallback. A separate fresh-browser smoke check initializes the real Firebase SDK while signed out and verifies that no protected database request occurs. The live account path rejects an unauthenticated read (HTTP 401). Positive access with Jason's actual signed-in account could not be checked because the normal browser-control runtime cannot launch; confirm **Synced across devices** on the phone and PCs after release.

## Current scope

- The shared app bar already links to Lyric Board, and the service worker precaches its page and catalogue.
- Account sync is confined to Lyric Board's child node; The Grind's existing partial planner updates preserve it. The service worker also precaches `sync.js`, and catalogue/planner release scripts include it in the cache hash.
- This page contains writing packets and local ratings. It does not download audio or consume Suno downloads.

The October 10 refresh includes 69 songs and 98 versions from six sessions: October 4 (4 versions), October 4 Cold Pass (12), October 8 Reset (39), October 9 Lyric Mine (29), October 10 Cue Battle 01 (7), and October 10 Misc Battle 01 (7). Source packets remain drafts unless Scatta approves them; catalogue inclusion is not listening approval.

## October 12 Suno title refresh

70 songs, 99 versions and seven sessions, including the Dearly Beloved v02 Cue rewrite. The read-only `suno-titles.csv` snapshot records all 298 library clips: 192 renamed and verified, 106 unchanged. The builder attaches clips only by their approved source path so repeated version numbers in different sessions cannot cross-link. Existing rating IDs remain intact.

Suno listening and per-recording decisions now live on Audio Board. Lyric Board shows each packet’s original title and exact copy fields. Matched packets link to Audio Board’s takes for that lyric version. C = Cue, M = Misc, S = Scatta; the first number is the lyric version, the final number is the clip; i denotes an instrumental with a separate count. Instrumental stems without approved renames keep their original names.

Future rebuilds automatically use this snapshot. To refresh it, replace it with a verified export of the same columns, or pass `--suno-titles <csv>`. No Suno credentials or audio are stored in this repository.

## Install Lyric Board in Chrome

Open the published `/lyrics/` URL in a normal Chrome window and use the address-bar install icon or the **Install Lyric Board** button when Chrome offers it. It installs separately from The Grind and launches directly into Lyric Board in a standalone window. The board registers the shared service worker itself, so visiting The Grind first is not required. Its manifest and offline page are precached; existing song ratings and account sync continue to use the same origin and storage.

## Lyric and Audio Boards

Lyric Board remains at `/lyrics/` so existing shortcuts, the app identity, rating IDs, copied versions, custom sessions and cloud records stay intact. Its labels and install name now read Lyric Board. The shared `board.js`, `board.css` and `sync.js` power both boards.

Audio Board lives at `/audio/` and stores decisions by Suno clip UUID. It has its own local key `grind.audio.v1`, score exports marked `audio-board`, and cloud path `planners/the-grind-scattabrain-2026/album/audio/accounts/<UID>`. Lyric cloud data remains at `album/accounts/<UID>` with the same `grind.album.v1` key and legacy `album-board` import format. Neither board imports the other board’s export. Both use the existing Google account authentication.

The source link is exact: the original SBGLP path is retained, and a promoted copy can link back to one imported session packet only when full lyric text, writer and version agree. Ambiguous packets are not guessed. Audio Board links back to that exact lyric version; Lyric Board’s small `audio-links.js` index lets a packet open its associated takes without loading the full audio catalogue. Scores are not copied between boards.

`python3 scripts/refresh-board-cache.py` versions all shared UI, both catalogues, manifests, and icon assets. Both catalogue builders and the embedded-planner update script call it. No audio downloads or signed URLs are stored in the offline cache.

## Lyric app icon

Lyric Board now uses the neon notebook and pen icon (`icons/lyric-notebook-*.png`) for installation, the browser tab and Apple touch icon. Audio Board uses the cassette artwork made earlier today. The app IDs, URLs and score storage are unchanged. The previous cassette files remain available for older cached installs.

## Installation identity fix

The previous `id: "./"` resolved against the site origin, making both boards collide. The fixed IDs are `/s2g/lyrics/` and `/s2g/audio/`. Start URLs, scopes, browser storage and cloud score paths are unchanged. A previously installed board with the shared origin-root identity may need to be removed and installed again from the correct board URL. Tests now verify Chrome’s processed identities as well as origin-based ID resolution.
