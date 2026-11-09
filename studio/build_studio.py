#!/usr/bin/env python3
"""Build the Studio board's song index from the Lyric Board, the Audio Board and a Studio Track Catalog export.

Reads lyrics/songs.js and audio/tracks.js (already published) plus the catalog's data/catalog.json, then writes
studio/catalog.js. Only song-level facts and Suno take facts are written; Studio file paths, receipt paths and
song-home paths stay off the public site (local mode reads them from the catalog server instead).
"""
import argparse, datetime, json, re, unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DEFAULT_CATALOG = Path(r"D:\SYNCt\01 Studio\98 Working\Studio Track Catalog\data\catalog.json")
ALIASES = {"methoughthought": "thewakeofhellsbirth"}   # same alias as the catalog's title_key
UUID = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
WRITERS = r"(?:cue|misc|cg|scatta|q|que|claude)"


def window_json(path, name):
    text = Path(path).read_text(encoding="utf-8-sig")
    match = re.search(r"^window\." + name + r"\s*=\s*(.*?);?\s*$", text, re.M)
    if not match:
        raise ValueError(f"{path}: window.{name} not found")
    return json.loads(match.group(1).rstrip(";"))


def window_str(path, name):
    match = re.search(r"^window\." + name + r'\s*=\s*"([^"]*)"', Path(path).read_text(encoding="utf-8-sig"), re.M)
    return match.group(1) if match else ""


def tkey(text):
    ascii_text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    key = re.sub(r"[^a-z0-9]", "", ascii_text.lower())
    return ALIASES.get(key, key)


def clean_title(title):
    """Drop take, version and writer suffixes: 'Faceless v05_cue-10-08' and 'Dearly Beloved.C2.1' become the song title."""
    t = str(title or "").strip()
    for _ in range(3):
        before = t
        t = re.sub(r"\s*\([^)]*\)\s*$", "", t)
        t = re.sub(r"\.i?[CMS]\d+(?:\.\d+)?\.\d+$", "", t)
        t = re.sub(r"\s+v\d+[a-z]?(?:[_ ]" + WRITERS + r")?(?:-\d{2}-\d{2})?$", "", t, flags=re.I)
        t = re.sub(r"\s+-\s+" + WRITERS + r"$", "", t, flags=re.I)
        t = re.sub(r"\s+" + WRITERS + r"$", "", t, flags=re.I)
        if t == before:
            break
    return t.strip() or str(title or "").strip()


def display(title):
    title = clean_title(title)
    return title.title() if title == title.lower() and re.search(r"[a-z]", title) else title


def is_prompt(title):
    return bool(re.match(r"^\d{2}\s", title or "")) or tkey(title) == "beattastemap"


def build(songs_js, tracks_js, catalog_path):
    lyric_songs = window_json(songs_js, "ALBUM_SONGS")
    takes = window_json(tracks_js, "ALBUM_SONGS")
    catalog = json.loads(Path(catalog_path).read_text(encoding="utf-8")) if catalog_path else {"songs": [], "clips": []}

    songs = {}

    def song(key, title):
        if key not in songs:
            songs[key] = {"key": key, "title": display(title), "lyrics": [], "cat": None, "bases": []}
        return songs[key]

    by_slug = {}
    for s in lyric_songs:
        key = tkey(s["slug"])
        entry = song(key, s["title"])
        entry["lyrics"].append(s["slug"])   # e.g. Me, Though Thought and The Wake of Hell's Birth are one song
        by_slug[s["slug"]] = key

    take_song, take_ids = {}, set()
    for t in takes:
        v = t["versions"][0]
        tid = t["slug"]
        if not UUID.match(tid):
            raise ValueError(f"Invalid take id {tid}")
        take_ids.add(tid)
        key = by_slug.get(v.get("lyricSlug") or "") or tkey(clean_title(t.get("baseTitle") or t["title"]))
        entry = song(key, t.get("baseTitle") or t["title"])
        base = t.get("baseTitle") or t["title"]
        if base not in entry["bases"]:
            entry["bases"].append(base)
        take_song[tid] = key

    for c in catalog.get("songs", []):
        key = ALIASES.get(c["id"], c["id"])
        entry = song(key, c["title"])
        home = c.get("home") or None
        if home:
            entry["title"] = display(home.get("title") or entry["title"])
        fields = (home or {}).get("fields") or {}
        entry["cat"] = {
            "id": c["id"],
            "status": c.get("status") or "needs_review",
            "writers": c.get("writers") or [],
            "versions": c.get("versions") or [],
            "batches": c.get("batches") or [],
            "files": len(c.get("file_ids") or []),
            "packets": {"complete": c.get("complete_packets", 0), "incomplete": c.get("incomplete_packets", 0)},
            "home": {"status": fields.get("Status") or "", "chosenLyric": fields.get("Chosen lyric") or "",
                     "chosenAudio": fields.get("Chosen audio") or "", "next": fields.get("Next action") or ""} if home else None,
            "suggestions": [{"key": ALIASES.get(x["id"], x["id"]), "title": display(x["title"]), "similarity": x.get("similarity")} for x in c.get("suggestions") or []],
            "updated": c.get("updated") or "",
            "archivedOnly": bool(c.get("archived_only")),
        }

    clip_song = {}
    for c in catalog.get("songs", []):
        for cid in c.get("clip_ids") or []:
            clip_song[cid] = ALIASES.get(c["id"], c["id"])
    clips = []
    for c in catalog.get("clips", []):
        if not UUID.match(c.get("id", "")):
            continue
        key = take_song.get(c["id"]) or clip_song.get(c["id"]) or tkey(clean_title(c.get("base_title") or c.get("title")))
        song(key, c.get("base_title") or c.get("title"))
        clips.append({
            "id": c["id"], "title": c.get("title") or "", "base": c.get("base_title") or "", "version": c.get("version") or "",
            "writer": c.get("writer") or "", "duration": c.get("duration") or 0, "created": c.get("created") or "",
            "model": c.get("model") or "", "trashed": bool(c.get("trashed")), "mode": c.get("mode") or "",
            "rejected": bool(c.get("rejected")), "song": key, "onBoard": c["id"] in take_ids,
        })

    takes_per_song = {}
    for key in take_song.values():
        takes_per_song[key] = takes_per_song.get(key, 0) + 1
    for entry in songs.values():
        cat = entry["cat"]
        own_clips = [c for c in clips if c["song"] == entry["key"]]
        written = bool(entry["lyrics"]) or bool(cat and cat["files"])
        on_suno = bool(takes_per_song.get(entry["key"])) or bool(own_clips)
        entry["location"] = "both" if written and on_suno else "local" if written else "suno"
        entry["prompt"] = is_prompt(entry["title"])
        entry["boardTakes"] = takes_per_song.get(entry["key"], 0)
        entry["newTakes"] = sum(1 for c in own_clips if not c["onBoard"] and not c["trashed"])
        entry["trashedTakes"] = sum(1 for c in own_clips if c["trashed"])

    ordered = sorted(songs.values(), key=lambda s: (s["title"].lower(), s["key"]))
    return {
        "built": datetime.datetime.now().astimezone().isoformat(timespec="minutes"),
        "sources": {"lyrics": window_str(songs_js, "ALBUM_BUILT"), "takes": window_str(tracks_js, "ALBUM_BUILT"), "catalog": catalog.get("built", "")},
        "songs": ordered,
        "takeSong": take_song,
        "clips": clips,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", type=Path, default=DEFAULT_CATALOG, help="Studio Track Catalog data/catalog.json")
    parser.add_argument("--out", type=Path, default=HERE / "catalog.js")
    args = parser.parse_args()
    data = build(ROOT / "lyrics" / "songs.js", ROOT / "audio" / "tracks.js", args.catalog if args.catalog.is_file() else None)
    text = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    args.out.write_text("/* Generated by studio/build_studio.py. Song-level facts only; no Studio file paths. */\nwindow.STUDIO = " + text + ";\n", encoding="utf-8")
    songs = data["songs"]
    print(f"{len(songs)} songs ({sum(s['location']=='both' for s in songs)} written and on Suno, "
          f"{sum(s['location']=='local' and not s['prompt'] for s in songs)} written only, {sum(s['location']=='suno' for s in songs)} Suno only, "
          f"{sum(s['prompt'] for s in songs)} beat prompts); {len(data['takeSong'])} board takes; "
          f"{sum(1 for c in data['clips'] if not c['onBoard'] and not c['trashed'])} newer Suno takes not on the board -> {args.out}")


if __name__ == "__main__":
    main()
