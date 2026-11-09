# Studio Board

One page for every song: lyric versions beside Suno takes, with scores, album status, highlights, notes and song decisions together. It replaces juggling the Lyric Board, the Audio Board (Album Planner), the Classic view and the local Studio Track Catalog. The older pages keep working and share the same data, so you can switch at your own pace.

Open it at `/s2g/studio/`.

## What's where

| View | What it does | Came from |
|---|---|---|
| Songs | One page per song. The header holds song status, chosen take, chosen lyric, next action and song notes. Lyrics sit on the left with highlights, quick tags, readiness, status, notes, Suno fields with Copy, editing and where each version came from. Takes sit on the right, each a full planner card plus Choose and Take details. | Lyric Board, Classic view, catalog "Your call" |
| Triage, Album picks, Sessions, Albums | The Album Planner's own views, unchanged: keys, replace dialog, compare sessions, drag-to-order tracklists, What's missing. | Album Planner |
| Cleanup | Two lists: takes on Suno but not on the board yet, and songs written but never sent to Suno. Then possible duplicate songs, then the planner's delete and rename lists. | Album Planner, handoff gap lists |
| Inventory | Songs and every Suno take as tables with CSV export. Local mode adds Studio files, playlists and coverage. | Studio Track Catalog |

The album dock at the bottom is the planner's tracklist panel. Its "Adding to" choice decides which album the M, S, A and C buttons act on.

Keys: `S` `M` `A` `C` `U` set a take's status, `J`/`K` move between takes, `Space` plays on Suno, `Z` undoes, `[`/`]` move between songs, `/` searches, `?` lists them all.

## Where the data lives

| Store | localStorage key | Firebase path under `planners/the-grind-scattabrain-2026/album/` | Written by |
|---|---|---|---|
| Lyric reviews, highlights, your copies | `grind.album.v1` | `accounts/<uid>` | `stores.js` with `lyrics/sync.js` |
| Take scores, notes, readiness | `grind.audio.v1` | `audio/accounts/<uid>` | `audio/album/planner.js` |
| Albums, statuses, sessions, renames, delete tags | `grind.planner.v1` | `planner/accounts/<uid>` | `audio/album/planner.js` |
| Song decisions, last viewed lyric | `grind.studio.v1` | `studio/accounts/<uid>` | `stores.js` with `studio-sync.js` |

The first three use the old boards' exact record formats, so the old pages read everything the Studio Board writes. Song decisions get their own path because the old pages reject record kinds they don't know. If the database rules don't allow that path yet, song decisions stay on the device and the sync line says so; everything else still syncs.

`planner.js` runs inside this page through `host.js` (`window.PLANNER_HOST`). On the Audio Board page that object doesn't exist, so the planner behaves exactly as before.

## Updating the song index

`catalog.js` joins `lyrics/songs.js`, `audio/tracks.js` and the Studio Track Catalog's `data/catalog.json` into one song list. Rebuild it after either board's data or the catalog changes:

    python studio/build_studio.py
    python scripts/refresh-board-cache.py

Only song-level facts and Suno take facts are written. Studio file paths, song-home paths and receipt paths stay off the public site.

## Local mode

When the Studio Track Catalog server serves this page (`http://localhost:<port>/s2g/studio/`, with `s2g_root` set in its `config.local.json`), the page also gets:

- a Studio files panel on each song, with Open and Copy path
- Studio files, Playlists and Coverage tabs in Inventory, plus Refresh inventory
- **Save to Studio** on your own copies, which writes a new `<Song> - Lyrics - vNN - Scatta - <date>.md` in the song's `01 Songs/<Song>/Lyrics/` folder and never overwrites
- song decisions copied into the catalog's `data/annotations.json`

Use `localhost`, not `127.0.0.1`, so Google sign-in works.

## Tests

    node tests/studio-board.test.cjs
    python tests/studio-build.test.py
