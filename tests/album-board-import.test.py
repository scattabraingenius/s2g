"""Regressions for rating identity and preservation during session imports."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("builder", Path(__file__).resolve().parents[1] / "lyrics" / "build_songs.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class ImportTest(unittest.TestCase):
    def test_monthly_rewrites_and_exact_clip_source_keep_versions_distinct(self):
        import csv
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for folder in ('2026-10-08-Reset', '2026-10-Cue-Rewrites'):
                directory = root / folder; directory.mkdir()
                (directory / 'song_v01_Cue_lyrics.md').write_text('# Song\n\nLyrics')
            songs, sessions, _ = builder.build(root)
            snapshot = root / 'clips.csv'
            with snapshot.open('w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=['clip_id','title','old_title','result','source'])
                writer.writeheader()
                writer.writerow(dict(clip_id='1062c997-8fff-4e93-bcac-dabb89ccee21',title='Song.C1.3',old_title='Song',result='renamed and verified',source='02 Album Project/Writing Sessions/2026-10-Cue-Rewrites/song_v01_Cue_lyrics.md'))
            builder.attach_clips(songs, snapshot)
            versions = {v['folder']:v for v in songs[0]['versions']}
            self.assertEqual(versions['2026-10-08-Reset']['clips'], [])
            self.assertEqual(versions['2026-10-Cue-Rewrites']['suno']['title'], 'Song')
            self.assertEqual(versions['2026-10-Cue-Rewrites']['clips'][0]['title'], 'Song.C1.3')
            self.assertEqual(versions['2026-10-08-Reset']['stem'], 'song_v01_Cue')
            self.assertEqual(len(sessions), 2)

    def test_same_filename_in_new_session_keeps_old_rating_id(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for folder in ("2026-10-08-Reset", "2026-10-10-Cue-Battle01"):
                directory = root / folder
                directory.mkdir()
                (directory / "song_v01_Cue_lyrics.md").write_text("# Song\n\nDraft " + folder, encoding="utf-8")
            songs, sessions, hashes = builder.build(root)
            versions = songs[0]["versions"]
            self.assertEqual(versions[0]["stem"], "song_v01_Cue")
            self.assertNotEqual(versions[0]["stem"], versions[1]["stem"])
            self.assertEqual(len(sessions), 2)
            self.assertEqual(len(hashes), 2)

    def test_suno_copy_text_keeps_trailing_newline_and_source_stays_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            directory = root / "2026-10-11-New-Session"
            (directory / "Suno Pass").mkdir(parents=True)
            packet = directory / "song_v01_Misc_lyrics.md"
            packet.write_text("# Song\n\nLyrics", encoding="utf-8")
            suno = directory / "Suno Pass" / "song_v01_Misc_suno-lyrics.txt"
            suno.write_text("Lyrics\n", encoding="utf-8")
            before = {p: p.read_bytes() for p in (packet, suno)}
            songs, sessions, _ = builder.build(root)
            self.assertEqual(songs[0]["versions"][0]["suno"]["lyrics"], "Lyrics\n")
            self.assertEqual(sessions[0]["folder"], directory.name)
            self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_unavailable_or_empty_source_does_not_replace_catalogue(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "songs.js"
            output.write_text("existing catalogue", encoding="utf-8")
            for source in (Path(temp) / "missing", Path(temp)):
                with self.assertRaises(SystemExit):
                    builder.main([str(source), "--output", str(output)])
                self.assertEqual(output.read_text(encoding="utf-8"), "existing catalogue")

if __name__ == "__main__":
    unittest.main(verbosity=2)
