# Lyric review

Lyric Board uses the same 0–100 song rating as Audio Board for linked Suno takes: choose the take in the review panel. Every opened version has a rating box. Without an exact recording match, its song rating stays with the lyric version in the `songScore` field; it is never automatically copied over an audio score when a recording is linked later. Old lyric-board scores are preserved and labelled Previous lyric-board score.

Close song and Back to songs both close the detail panel. On phones the list and detail occupy separate views; on desktop closing restores the full-width list. Closing a deep link removes its song/version parameters, so reload stays closed. Ordinary reloads start with the song list while retaining version choices, filters, ratings and notes. Escape also closes an open song when focus is outside an editing control. Rating commits update the list without replacing the focused panel, allowing a single tap on Close to save and leave.

Listening readiness is independent of the score: Not assessed, Ready, Heavy, Set aside. A lyric version and a recording can have different readiness choices. Filtering by version readiness only shows versions with that choice. Audio Board has its own take-readiness filter.

Writing sessions and batches support multiple selections. Each button toggles independently; results include the union of the selected sessions and custom batches without duplicate versions. All clears the selections and shows everything. Deselecting the last button leaves an empty view rather than switching to All. Choices persist across reloads. An explicit version link adds its writing session if necessary, preserving the other selected sessions.

Sort matches Audio Board's title, rating, date, status, length and writer controls; length here means lyric character count. Date defaults to newest first; the direction button switches to oldest first. A song's date is the newest known version date inside the selected sessions, using the dated batch or source filename (and creation time for custom copies). Unknown dates stay last in either direction. Rating and date sorts use the selected versions rather than unrelated sessions.

Select words or tap a lyric line, enter an optional passage comment, and choose a colour. The Highlight selection button uses the last chosen colour. Colour labels can be renamed. Markup is separate from the plain lyric/Suno copy fields. Each annotation has its own sync record. A text change makes old anchors stale rather than moving highlights onto different words. Editable copies start without inherited annotations and lose their recording match when their words change.

Quick statuses, tags, notes, custom writing sessions and the existing lyric tracklist stay available. Keyboard shortcuts: S shortlist, M maybe, R needs revision, P preferred, U unreviewed, J/K next/previous song, Z undo review action. Shortcuts do not run while typing. Review backup includes both the lyric-review state and Audio Board rating state. Restore merges records rather than replacing either account. Keep the backup private.

## Refresh from Studio

Run from the repository using Python 3:

    python -B lyrics/build_songs.py --studio --manifest test-artifacts/studio-import.json

Pass an explicit Studio root as the positional argument if this checkout is outside the synced folder layout. The importer retains existing version IDs and original content, imports dated writing packets including edited filename variants, library lyrics, anchors, headed lyric-book songs, explicitly named reference lyric files, and Suno lyric exports. It reads no message archives or seed briefs. Identical copies add source locations; distinct writing or generation prompts remain versions. Existing catalogue entries remain when a source is unavailable. Source locations do not establish artistic approval. An available writing folder and song folder are both required.

The private manifest records input SHA-256 hashes and every candidate's disposition. Never hand-edit songs.js. Refreshing also regenerates the exact take index from the current Audio Board catalogue and updates the service-worker cache. Re-run after an Audio Board catalogue refresh to include new take links. No source files are moved, rewritten or deleted.

## Studio file growth

    python -B scripts/studio-growth.py "D:/SYNCt/01 Studio" --output test-artifacts/studio-growth.json

This reads file metadata and hashes same-size files to identify byte-identical copies. The private report contains source paths and is ignored by Git. Duplicate bytes are a theoretical upper bound, not an approved deletion list: filing histories, exports and backups may have legitimate separate purposes.

## Verification

    python -B tests/album-board-import.test.py
    python -B tests/studio-import.test.py
    node tests/album-sync.test.cjs
    node tests/sync-property-order.test.cjs
    node tests/planner-status.test.cjs
    node tests/planner-candidates.test.cjs

With a local server at APP_BASE_URL and Playwright available:

    node tests/lyric-review.test.cjs
    node tests/lyric-review-cloud.test.cjs
    node tests/audio-panels.test.cjs
    node tests/album-status.test.cjs
    node tests/unified-pwa.test.cjs

The review sync test uses a synthetic transactional backend and two isolated browser profiles. It verifies concurrent offline passage marks, separate lyric notes/audio scores, account separation and restoration, and untouched parent planner data. It does not verify real signed-in Firebase permissions or a physical phone.
