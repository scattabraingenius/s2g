"""Studio Board index builder: song joins, newer Suno takes, and no Studio file paths in the public output."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("studio_build", Path(__file__).resolve().parents[1] / "studio" / "build_studio.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

T1, T2, T3 = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"


class StudioBuildTest(unittest.TestCase):
    def build(self, songs, takes, catalog):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "songs.js").write_text('window.ALBUM_BUILT = "2026-10-29T15:40-04:00";\nwindow.ALBUM_SONGS = ' + json.dumps(songs) + ";\n", encoding="utf-8")
            (root / "tracks.js").write_text('window.ALBUM_BUILT = "2026-10-29T15:40-04:00";\nwindow.ALBUM_SONGS = ' + json.dumps(takes) + ";\n", encoding="utf-8")
            (root / "catalog.json").write_text(json.dumps(catalog), encoding="utf-8")
            return builder.build(root / "songs.js", root / "tracks.js", root / "catalog.json")

    def test_clean_title(self):
        self.assertEqual(builder.clean_title("Faceless v05_cue-10-08"), "Faceless")
        self.assertEqual(builder.clean_title("Dearly Beloved.iC2.1"), "Dearly Beloved")
        self.assertEqual(builder.clean_title("Fallen Petals v5 (Backing Vocals)"), "Fallen Petals")
        self.assertEqual(builder.clean_title("Two People to Mourn - Cue"), "Two People to Mourn")
        self.assertEqual(builder.tkey("Me Though Thought"), "thewakeofhellsbirth")

    def test_joins_and_privacy(self):
        songs = [{"slug": "clear", "title": "Clear", "versions": []}, {"slug": "carried", "title": "Carried", "versions": []}]
        takes = [{"slug": T1, "title": "Clear v01_cue-10-08", "baseTitle": "Clear", "versions": [{"lyricSlug": "clear"}]}]
        catalog = {"built": "2026-11-07", "songs": [
            {"id": "clear", "title": "Clear", "file_ids": ["file:1"], "clip_ids": [], "home": {"title": "Clear", "path": "01 Songs/Clear/00 Song Home.md", "fields": {"Status": "Unreviewed"}}, "status": "needs_review", "location": "local", "suggestions": []},
            {"id": "carried", "title": "Carried", "file_ids": ["file:2"], "clip_ids": [], "home": None, "status": "needs_review", "location": "local", "suggestions": []},
            {"id": "oneofone", "title": "one of one", "file_ids": [], "clip_ids": [T2, T3], "home": None, "status": "needs_review", "location": "suno", "suggestions": []}],
            "clips": [{"id": T2, "title": "One of One v1_cue", "base_title": "One of One", "trashed": False, "receipt_paths": ["07 Batches/x.json"]},
                      {"id": T3, "title": "One of One v1_cue", "base_title": "One of One", "trashed": True}],
            "files": [{"id": "file:1", "path": "07 Batches/Writing/secret/clear_v01_Cue_lyrics.md"}]}
        data = self.build(songs, takes, catalog)
        by = {s["key"]: s for s in data["songs"]}
        self.assertEqual(by["clear"]["location"], "both", "a board take means the song reached Suno even if the catalog missed it")
        self.assertEqual(by["carried"]["location"], "local")
        self.assertEqual(by["oneofone"]["title"], "One Of One")
        self.assertEqual((by["oneofone"]["newTakes"], by["oneofone"]["trashedTakes"]), (1, 1))
        text = json.dumps(data)
        for private in ("07 Batches", "00 Song Home.md", "receipt_paths", "file:1"):
            self.assertNotIn(private, text)

    def test_same_song_under_two_lyric_slugs(self):
        songs = [{"slug": "me-though-thought", "title": "Me, Though Thought", "versions": []}, {"slug": "the-wake-of-hells-birth", "title": "The Wake of Hell's Birth", "versions": []}]
        data = self.build(songs, [], {"songs": [], "clips": []})
        self.assertEqual(len(data["songs"]), 1)
        self.assertEqual(sorted(data["songs"][0]["lyrics"]), ["me-though-thought", "the-wake-of-hells-birth"])


if __name__ == "__main__":
    unittest.main()
