# Suno tools for The Grind

Verified on Windows i7 on 2026-10-18 using the installed Sunox 0.3.4 command help. This guide is project documentation, not authorization to rename/delete songs, generate music, or publish the site.

## Start here: the library is accessible through Sunox

Work in `D:\SYNCt\SBGmac\Projects\Apps\ScattaBrain to Genius`. Do not inspect or modify sibling projects to find a Suno integration.

The installed tool is a command-line integration called **Sunox**, not a Suno connector currently exposed in this chat's MCP tools. A missing `suno` command does NOT mean Suno access is unavailable: check `sunox` too. Its agent skill and browser extension are supporting components; do not reinstall them as routine setup.

```powershell
Set-Location -LiteralPath 'D:\SYNCt\SBGmac\Projects\Apps\ScattaBrain to Genius'
Get-Command sunox -ErrorAction SilentlyContinue
# If this shell has a stale PATH, use the verified executable directly:
$sunoxExe = 'C:\Users\jcurt\AppData\Local\Programs\Sunox\sunox.exe'
& $sunoxExe --version
& $sunoxExe --help
```

The exact executable above was found and reported `sunox 0.3.4`. Recheck its help after upgrades. Do not download another version, install a skill globally, or edit authentication files just to read the library.

## Read the current account without changing Suno

Use `--read-only` on inspection/export commands. Start with one small request before collecting the complete library:

```powershell
& $sunoxExe --read-only --json clip list --limit 1
& $sunoxExe --read-only --json playlist list --page 1
& $sunoxExe --read-only --json clip info 'FULL-CLIP-UUID'
```

These commands read private account data. Do not paste full responses into chat or commit them. Report only necessary counts, field availability, and errors with credentials removed. A successful help/version check proves installation, not current authentication. No live authenticated library request was run while writing this guide.

If an actual read reports expired/missing authentication, inspect `sunox doctor --help` and use the existing login workflow. `sunox login` can read browser cookies or open an interactive Chrome/Edge login window; Jason may need to complete sign-in. Do not log out, clear browser storage, uninstall apps, or print cookies, JWTs, config secrets, or token files.

```powershell
& $sunoxExe login
```

Do this only when authentication needs renewal. Do not repeat browser setup when an ordinary read succeeds.

## Collect a complete current library

`clip list` supports `--cursor`, `--limit`, and `--trashed`. Do not assume one response is the whole library, that a large limit guarantees completeness, or that an old count is today's count.

1. Create a new timestamped run folder inside the ignored `private-suno/` directory in this repo. Use a new folder for each run and do not overwrite earlier evidence. Save raw output there only, never credentials.
2. Fetch the first active-library page. Inspect the actual JSON shape locally to identify the clip list and continuation cursor; the response field names have not been verified here.
3. Follow every returned continuation cursor with `clip list --cursor 'RETURNED-CURSOR'`. Stop on the service's end-of-feed signal. Fail on repeated cursors, errors, malformed pages, or unexpected account changes. Do not publish a partial result.
4. Deduplicate by full clip UUID, retaining each separate take even when titles/lyrics match. Record page count, unique clip count, collection time, and whether pagination completed.
5. Inspect `clip info` for a representative take. Verify the export includes complete lyrics/prompt, style/tags, duration, creation time, type/instrumental information, voice/persona metadata, and source-take relationships used by the builder. If list output is simplified, enrich from detailed reads before rebuilding. Missing persona data must not erase known attribution or become a claim of no persona.
6. The default feed and even an all-pages search can omit still-active workspace recordings. During the October 18 refresh, they returned 97 takes while exact-ID checks confirmed another 126 were active. Reconcile every existing catalogue UUID; use `sunox --read-only --json clip status UUID1 UUID2 ...` in batches of up to 25 to read full records without the supplemental calls made by `clip info`. Do not treat a fully paginated feed as proof of complete account coverage. For new recordings outside that feed, additional workspace discovery may be needed. When reconciling removals, collect all Trash pages separately using `clip list --trashed` and the same cursor process. Confirm missing old IDs against Trash or detailed reads. Absence from one page is not proof of deletion. Preserve scores, notes, and stored planner records for removed recordings.
7. Produce a complete JSON array of clip objects for `build_tracks.py`, keeping the raw responses separately. Do not convert a simplified title/ID list into a purported full-feed export.

Example read commands (placeholders are intentional; these are not a complete export script):

```powershell
& $sunoxExe --read-only --json clip list --limit 100
& $sunoxExe --read-only --json clip list --limit 100 --cursor 'RETURNED-CURSOR'
& $sunoxExe --read-only --json clip list --trashed --limit 100
```

`private-suno/` is ignored by Git, but is not an access-control boundary. Do not serve that directory with the local preview server or publish its contents. For previews while private exports exist, use a public-only staging directory or a server that explicitly denies `/private-suno/`.

## Refresh the boards from verified inputs

Read `CODEX_HANDOFF.md`, `CLAUDE_HANDOFF.md`, and the current builders before running an import.

- Audio Board and Album Planner share `audio/tracks.js`; rebuild it once to refresh their available library.
- Lyric Board uses written song/version packets in `lyrics/songs.js`. A new Suno recording is not automatically a new written song. Rebuild from the complete approved Writing Sessions source and preserve existing slugs/version stems; do not invent lyric versions from titles alone.
- `lyrics/build_songs.py` accepts `--suno-titles` for verified clip links. `audio/build_tracks.py` accepts `--library`, `--matches`, and `--lyrics-catalogue`.
- Existing match results must be retained and extended with evidence. Never omit the match input merely to make a refresh run: that would discard existing lyric source links. Use exact source/version/full-text evidence; leave ambiguity unconfirmed.
- Generate `audio/tracks.js`, `lyrics/songs.js`, and `lyrics/audio-links.js` through their builders, never hand edits. Compare old/new UUIDs, lyric IDs, voice attribution, and match counts before accepting output. Do not rebuild from missing/incomplete source inputs.
- Keep `grind.album.v1`, `grind.audio.v1`, `grind.planner.v1`, view/account keys, Firebase merge logic, and rules intact. A catalogue refresh does not authorize editing the user's cloud records or clearing browser data.
- After changes under either board, run `python -B scripts\refresh-board-cache.py`; include the new cache name in the local commit. Add new client scripts to `APP_SHELL` in `service-worker.js`. A documentation file or test is not a client script.
- Run relevant import tests and planner tests, then browser regressions with isolated data and screenshots confined to this repo (`ARTIFACT_DIR`). State exactly what ran. Synthetic tests do not establish real Firebase sync, phone-to-PC behavior, Suno playback, or real-data migration.
- Jason authorizes routine pushes to `main` for completed, verified work he requests in this project, unless he says to hold deployment. A push deploys GitHub Pages; check the deployment result.

## Renaming songs: only when Jason authorizes the scope

Use full UUIDs rather than ambiguous titles. Prepare a reviewable old-title/new-title mapping, preserve the previous values locally, then change only the title. Do not alter lyrics, covers, visibility, or persona metadata as a side effect.

```powershell
# Read before and after; the middle command changes the Suno account.
& $sunoxExe --read-only --json clip info 'FULL-CLIP-UUID'
& $sunoxExe clip set 'FULL-CLIP-UUID' --title 'Dearly Beloved.C1.1'
& $sunoxExe --read-only --json clip info 'FULL-CLIP-UUID'
```

Historical naming agreement: `Song Name.C1.1` = Cue lyric version 1, take 1; `M` = Misc; `S` = Scatta. Instrumentals use an `i`, e.g. `Dearly Beloved.iC1.1`. Confirm attribution/version from evidence; do not guess from similar titles. One UUID remains one take.

## Deleting and restoring: recoverable Trash only

A planner Delete tag is a request marker, not proof Suno has deleted anything. For an explicitly authorized cleanup, capture the exact selected UUID manifest, distinguish deletions from pending renames, reconcile already-trashed clips, and process only the authorized remaining IDs. Save before/after evidence and verify membership in Trash plus absence from the active feed before marking a task complete.

```powershell
# Only after authorization covers these exact IDs:
& $sunoxExe clip delete 'FULL-CLIP-UUID' --yes
# Verify through the paginated Trash and active feeds.
& $sunoxExe --read-only --json clip list --trashed --limit 100
# Restore only if requested/authorized:
& $sunoxExe clip restore 'FULL-CLIP-UUID'
```

Do not use `clip purge` or `clip empty-trash`. Do not generate, extend, remix, create cover art, or spend credits as part of a library refresh. Do not enable paid overages or separately billed services.

## Prior chat and older tool

The source conversation is **The Grind + Suno — Web apps and library**, formerly **Standardize Suno song names**:

- Chat ID: `01a12ffd-99c2-71c3-a822-d505ee731bb0`.
- Host: Mac mini (`remote-control:env_e_6aa1df94a1bc832d925b7f982cab4be7`). The chat can be read through Codex's `read_thread` tool; retrieving its history does not authorize sending it messages.
- It records Windows Sunox installation/login and successful `sunox playlist list` output, naming work, the October 14 cleanup (40 newly trashed plus four already in Trash), and the October 16 cleanup (55 newly trashed). These are historical results, not today's library counts or renewed deletion permission.
- `CLAUDE_HANDOFF.md` also describes an older Mac-only `suno` CLI at `/opt/homebrew/bin/suno` and full-feed helpers under `/Users/sbgmac/Documents/Codex/`. Those paths are historical and are not assumed to exist on this PC. Do not substitute their simplified list output for complete metadata.
- No Suno MCP connector was exposed in this Windows chat when checked. Prefer the verified installed Sunox CLI. If a later session exposes an actual Suno plugin, inspect its real schemas/skill before using it; never invent tool names or claim a connection merely because an old chat used one.

## What was verified for this document

The executable path, version, and help for clip list/info/set/delete/restore, playlist list, login, doctor, and agent skill installation were checked locally. No account write, live library export, authentication renewal, installation, or deployment was performed for this documentation task.


## October 18 refresh receipt

A subsequent authenticated refresh in this chat verified 223 active takes: 97 from the paginated feed plus 126 older takes confirmed active through batch exact-ID reads. All 57 IDs removed from the prior 258-take catalogue were confirmed in Trash; 22 newer takes were added. No Suno rename, deletion, restore, generation, or publication was performed. Discovery outside the default workspace feed was limited to known catalogue IDs; do not claim the feed alone covers every workspace.

Lyric sources rebuilt to 81 songs / 110 versions / 9 source sessions. All 99 prior version IDs and their lyric text survived; 610 source-file hashes were verified unchanged. Audio now has 143 direct lyric links, including the 22 newer takes. Historical rename receipts, existing direct matches, voice attribution and source-take relationships were retained.

The private raw exports, reconciled `library-full.json`, `library-build-input.json`, reconstructed `matches.json`, original catalogue backups and source hash manifest are under `private-suno/20261018T174301Z/`. They remain ignored by Git. These are dated snapshots, not inputs to reuse as a future current-library export. The raw feed includes complete metadata; `library-build-input.json` is the reviewed builder input.

Local verification: `album-board-import`, `audio-import` (including Windows UTF-8/BOM regression), `planner-status`, `planner-candidates`, `album-sessions` (including the song dropdown), `audio-panels`, `album-status`, `album-planner`, and `unified-pwa`. Browser tests used isolated synthetic records with external/Firebase requests blocked. The local test server denied `/private-suno/`, hidden paths, and test artifacts. Status-test examples were made synthetic and the session test now chooses a current multi-take song, because old named takes had legitimately moved to Trash. Real Firebase/device sync, real-data migration and actual Suno playback were not tested.


## October 19 Reset / Lyric Mine follow-up

The 136 recordings generated on October 19 Eastern time came from 68 source blueprints: 39 in `2026-10-08-Reset` (78 recordings) and 29 in `2026-10-09-Lyric-Mine` (58 recordings). The receipts' source SHA-256 hashes were reverified for all 68. Four prompts omit the written draft's title line; their source links are proven by generation receipts rather than a claim of identical full text.

A fresh exact-ID check found 135 of those recordings active: 77 Reset and 58 Lyric Mine. One Reset recording was already in Trash. Across the prepared 359-record catalogue, 296 were active and 63 were confirmed in Trash. The refreshed catalogue excludes those 63 without removing any scores, notes, or private planner records. All 135 active new recordings retain their exact source-version links, writer/version information and take 1/2 labels.

The default workspace feed returned zero during this follow-up even while the exact-ID reads succeeded. Use known generation-receipt IDs and catalogue IDs with `clip status` batches when the current workspace feed is empty. Do not infer library deletion from an empty feed or silently lose active recordings.

The complete approved Writing Sessions rebuild retained every prior lyric ID and discovered 22 additional written versions in four Oct 18/19 Cue sessions; the resulting Lyric Board has 81 songs, 132 versions and 13 sessions. Existing scores, notes, tracklists, storage keys and Firebase logic were not changed.

The verification snapshot and before-state backups are in `private-suno/20261020T004203Z-verify-todays-recordings/` (UTC filename; October 19 Eastern). Newer remote main catalogue/test work was integrated into the local update branch. Jason subsequently authorized routine deployment of completed, verified requested work unless he says to hold it. Browser tests remain isolated and do not prove real account sync or actual playback.
