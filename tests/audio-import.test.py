import importlib.util, json, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("builder",Path(__file__).resolve().parents[1]/"audio/build_tracks.py")
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
class AudioImportTest(unittest.TestCase):
    def test_private_and_signed_urls_are_not_exported_as_players(self):
        self.assertIsNone(builder.playable("https://studio-api.prod.suno.com/api/forbidden"))
        self.assertIsNone(builder.playable("https://cdn1.suno.ai/audio.mp3?token=secret"))
        self.assertIsNone(builder.playable("javascript:alert(1)"))
        self.assertIsNone(builder.playable("https://fake.cloudfront.net/secret.m4a"))
        self.assertEqual(builder.playable("https://d2lwuy8qc234o3.cloudfront.net/1/clip/test.m4a"),"https://d2lwuy8qc234o3.cloudfront.net/1/clip/test.m4a")
        self.assertEqual(builder.playable("https://cdn1.suno.ai/audio.mp3"),"https://cdn1.suno.ai/audio.mp3")
    def test_encoded_media_is_rejected_and_persona_name_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);library=root/"library.json";lyrics=root/"songs.js"
            lyrics.write_text('window.ALBUM_SONGS = [];\n')
            clip=dict(id="1062c997-8fff-4e93-bcac-dabb89ccee21",title="Song.C1.1",metadata={},is_persona_root=False,persona=dict(id="a51442f3-be46-4d4d-adaf-28d74f71b0ec",name="Write what I can"),media_urls=[dict(url="https://d2lwuy8qc234o3.cloudfront.net/test.m4a",content_type="m4a-opus",delivery="progressive",encoding="1.0.0")])
            library.write_text(json.dumps([clip]));songs,_,_=builder.build(library,None,lyrics)
            version=songs[0]["versions"][0]
            self.assertIsNone(version["audioUrl"]);self.assertEqual(version["voiceName"],"Write what I can");self.assertTrue(version["personalVoice"])
            self.assertNotIn("voiceVersion",version)
    def test_utf8_library_and_match_text_are_preserved_on_windows(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);library=root/"library.json";lyrics=root/"songs.js";matches=root/"matches.json"
            lyrics.write_text('window.ALBUM_SONGS = [];\n',encoding="utf-8")
            cid="1062c997-8fff-4e93-bcac-dabb89ccee21"
            title="Café — “Breathing”";prompt="Don’t lose these words 🎵"
            library.write_text(json.dumps([dict(id=cid,title=title,metadata=dict(prompt=prompt))],ensure_ascii=False),encoding="utf-8-sig")
            matches.write_text(json.dumps(dict(rows=[dict(clip_id=cid,match="Vérifié")]),ensure_ascii=False),encoding="utf-8")
            songs,_,_=builder.build(library,matches,lyrics)
            self.assertEqual(songs[0]["title"],title)
            self.assertEqual(songs[0]["versions"][0]["lyrics"],prompt)
            self.assertEqual(songs[0]["versions"][0]["match"],"Vérifié")
    def test_repeated_titles_remain_separate_tracks_and_duplicate_ids_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);library=root/"library.json";lyrics=root/"songs.js"
            lyrics.write_text('window.ALBUM_SONGS = [];\n')
            clips=[dict(id="1062c997-8fff-4e93-bcac-dabb89ccee21",title="Same name",metadata={}),dict(id="448931ef-3de6-4717-8941-b048ea5ec381",title="Same name",metadata={})]
            library.write_text(json.dumps(clips));songs,_,_=builder.build(library,None,lyrics)
            self.assertEqual(len(songs),2);self.assertNotEqual(songs[0]["slug"],songs[1]["slug"])
            library.write_text(json.dumps([clips[0],clips[0]]))
            with self.assertRaises(ValueError):builder.build(library,None,lyrics)
if __name__=="__main__":unittest.main(verbosity=2)
