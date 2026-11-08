# Audio Board

A listening companion to Lyric Board. Open `/audio/`. Every Suno clip is one take with a separate score, Shortlist/Maybe/Cut decision, notes and tracklist membership. Recording IDs stay tied to Suno UUIDs even if titles change.

The October 12 catalogue includes 295 clips: 190 vocal takes, 57 instrumentals and 48 stems. Vocals are the initial view. Filter by song, lyric writer, recording type or lyric-match status; search includes current and previous titles, lyrics and source files. Sort by newest, title or score. Custom listening sessions collect chosen takes across songs and sync between devices.

Lyrics and generation style opens by default for each take. When sync, focus changes or ratings refresh the same take, disclosure sections preserve their current open/closed state. Switching takes starts the lyrics section open again.

Every take has **Open in Suno** and **Copy title**. Exact matches link to the corresponding Lyric Board version. The generic audio_url is a private placeholder, and the returned M4A/Opus media streams carry Suno’s encoding marker. Chrome’s native player cannot decode those streams, so the board opens the original Suno take for listening. The importer skips private placeholders, signed URLs and encoded streams. A native player is supported when a future export supplies a plain playable URL, preserving the player through rating/status changes. No credentials or downloaded audio files are published.

Voice labels come from Suno persona metadata. The current catalogue identifies Write what I can on 125 takes: 86 vocals and 39 instrumentals. Vocal takes using that confirmed persona show Your voice; instrumentals show Persona setting. Six older vocals reference the vsJBrazen persona ID; its name is verified with Suno’s persona endpoint. Both IDs/names are recorded in `voice-personas.json` to retain labels when the feed omits a persona object. No persona listed means Suno has no persona attached, not that the track cannot contain an uploaded voice. Unknown metadata stays unconfirmed. Persona names preserve any explicitly named version; this persona has only one version, so no version number is invented. Use the voice filter to compare takes. Derived recordings also expose their recorded source-take links.

Audio Board installs separately in Chrome using today’s original neon cassette icon, stored in `audio/icons/`. Its manifest ID and scope are `/audio/`; Lyric Board retains its original `/lyrics/` identity. The shared service worker precaches both pages and their data. Audio itself remains online.

Scores, notes, listening sessions and exact-take tracklist sync using the existing Google sign-in. Local storage is `grind.audio.v1`; cloud records are isolated at `planners/the-grind-scattabrain-2026/album/audio/accounts/<UID>`. Lyric records, planner tasks and old local ratings are never copied or moved. Export/import is board-specific.

## Refresh the catalogue

Export full library metadata with the existing read-only Suno downloader and match it to SBGLP, then run:

    python3 audio/build_tracks.py --library /path/to/library-current.json --matches /path/to/matched-data.json

The CLI list response omits persona and media-source fields; importing it is supported, but those voice labels remain unconfirmed. Use a full feed export to retain voice/source provenance.

The optional match file is the earlier tracklist export’s JSON, with a `rows` array containing clip_id, source, writer, version, match, type and sbglp_lyrics. Without it, writer/version labels can be parsed from titles, but source matches remain unconfirmed. The builder rejects empty sources, invalid or duplicate UUIDs; filters private, signed and untrusted audio URLs; preserves clip IDs; writes `tracks.js` and the lyric comparison index; then refreshes the offline cache. It never changes songs on Suno or source files in SBGLP.

## Verification

    python3 -B tests/audio-import.test.py
    APP_BASE_URL=http://127.0.0.1:8765 node tests/audio-board.test.cjs
    APP_BASE_URL=http://127.0.0.1:8765 node tests/audio-media.test.cjs  # isolated plain-audio fixture

Browser checks use an isolated backend with synthetic accounts and cover independent scores for two takes of one lyric packet, separate tracklist membership, two-device sync, intact lyric data, exact source navigation, writer/song/type filters, listening sessions, installability, responsive layout and offline reload.

## Installation identity fix

The previous `id: "./"` resolved against the site origin, making both boards collide. The fixed IDs are `/s2g/lyrics/` and `/s2g/audio/`. Start URLs, scopes, browser storage and cloud score paths are unchanged. A previously installed board with the shared origin-root identity may need to be removed and installed again from the correct board URL. Tests now verify Chrome’s processed identities as well as origin-based ID resolution.

## Album Planner

`/audio/album/` is where album decisions happen. **Adding to** at the top picks the album you're building; every status on a card applies to that album.

**One status per take, per album.** Unreviewed → Maybe → Shortlist → On album, and any of them can become Cut. Score stays a separate number (sorting and the Unscored filter), and **Delete** stays a separate, library-wide Suno cleanup tag: tagged takes are hidden from the buckets.

- **Album picks** is the album-picking view. Its tabs are the statuses, each with a count that adds up to the total: **Unreviewed** (the inbox, the default) · **Maybe** · **Shortlist** · **On album** · **Cut**. **All alive** (not Cut, not tagged delete) is a browsing view beside them. Album picks shows the takes in the planner: **+ Add takes** pulls in an Audio Board session, pasted Suno links or catalogue search results, and acting on a take in Triage adds it.
- **Triage** (the old "Sort") is a quick one-decision-per-take pass over the whole catalogue: each take goes to an album or **Later**. It overlaps with the Unreviewed bucket, which is deliberate for now and flagged for the owner.
- Changing a status that moves a card out of the current tab folds the card away (it does not jump), shows "M1.2 → Shortlist · Undo" for about 6 seconds, and moves focus to the next card. **Z** also undoes.
- **Card**: Score box · title · **edit** (rename) · one status control (Maybe, Shortlist, + Album, Cut; press the lit one again for Unreviewed) · **▶ Suno**, **Lyrics ▸** (text plus the Lyric Board link, or Find lyrics), **Details** · **⋯** (Add to another album, Compare, Delete) · Notes. On-album takes keep a green "Album 1 · Debut #3" badge.
- **Keys**: S shortlist, M maybe, A add to album, C cut, U back to Unreviewed, Z undo, J/K next/previous, Space opens the take on Suno, ? lists them. The focused card has a ring. Keys never fire while typing in a box, and the score box still jumps to the next take on Enter (Shift+Enter goes back).
- **Guardrails**: the target line turns amber when over and red when well over ("17/12 tracks · 5 over target"). Adding a second take of a song already on the album asks "Replace C1.1 with M1.2 on Album 1?" (Replace puts the new take in the old take's place and sends the old one to Shortlist; Keep both warns on every take of that song). With grouping by song, each header says whether the song is on the album and by which take. A sticky **tracklist panel** (a bottom bar on phones) lists the album's tracks with lengths, running total and warnings; drag or ↑/↓ to reorder.
- **Sessions** group like-takes (Compare, Compare all, or Auto-build). **Album** orders the current album, lists Shortlist/Maybe takes ready to place, and shows **What's missing**. **Suno cleanup** lists takes to delete (with **Keep** to remove the tag) and to rename.

Where each status lives, so it syncs with records the planner already had: On album is the album's `order`; Cut is the album's `cut`; Maybe/Shortlist is `considered[stem].marks[albumId]`; Unreviewed is none of those (`audio/album/planner-status.js`). An album with `statusV: 2` has been converted. **Migration** (first load after this change): the planner backs up first (`grind.planner.v1.premigration`, downloadable from **Status migration log**), then for every take and album the first matching rule wins: On album (position kept) → Cut → Shortlist → Maybe → Unreviewed. Takes that carried more than one flag are written to the conflict log (`grind.planner.v1.migration`). The old Audio Board Shortlist/Maybe/Cut flags are read once and left untouched. A signed-in device converts only after its account has loaded, an already-converted album is never converted again, and converted data merges like any other planner record.

Planner records (albums, per-album statuses, sessions, renames, delete tags) sync at `planners/the-grind-scattabrain-2026/album/planner/accounts/<UID>`; scores and notes sync through Audio Board's own account child. Both use the per-record revision merge with tombstones. Local keys: `grind.planner.v1` and Audio Board's `grind.audio.v1`.

Audio Board and Lyric Board also have an ascending/descending toggle beside Sort, and Audio Board accepts `?take=<uuid>` to open one take.

Verification: `node tests/planner-status.test.cjs` (model and migration, no browser), and with a static server running, `APP_BASE_URL=http://127.0.0.1:8765 node tests/album-status.test.cjs` plus `album-planner`, `planner-sort`, `planner-merge` (synthetic data, Firebase blocked).

Dropdowns are only rebuilt when their options change, and background sync never re-renders the page while a dropdown is open (Android Chrome reopens the native picker when its options are replaced).
