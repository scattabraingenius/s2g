"""Coverage and identity checks for the reorganized Studio importer."""
import copy,hashlib,json,re,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'lyrics'))
from studio_import import build_studio,catalogue,audio_index

class StudioTest(unittest.TestCase):
    def test_library_book_edited_variants_and_reference_lyrics_are_included(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);batch=root/'07 Batches/Writing/2026-10-23-Misc-Test';batch.mkdir(parents=True)
            lib=root/'01 Songs/Older/Lyrics';lib.mkdir(parents=True)
            ref=root/'05 Reference/Song Ideas';ref.mkdir(parents=True)
            (batch/'song_v01_Misc_lyrics.md').write_text('# Song\n\nOne lyric',encoding='utf-8')
            (batch/'song_v01_Misc_lyrics SBG edit.md').write_text('# Song\n\nA changed lyric',encoding='utf-8')
            (batch/'06-Test-Lyric-Book.md').write_text('# Book\n\n## 1. Book One\nFirst\n\n## 2. Book Two\nSecond\n',encoding='utf-8')
            (lib/'Older - Lyrics - v00 full - Scatta - orig.txt').write_text('Original',encoding='utf-8')
            (ref/'another_v01_cg_lyrics.md').write_text('# Another\n\nAnother lyric',encoding='utf-8')
            songs,sessions,hashes,receipt=build_studio(root,[])
            self.assertEqual(sum(len(s['versions']) for s in songs),6)
            self.assertEqual({s['slug'] for s in songs},{'song','book-one','book-two','older','another'})
            again=build_studio(root,songs)[0]
            self.assertEqual(sum(len(s['versions']) for s in again),6)
            self.assertEqual({v['stem'] for s in songs for v in s['versions']},{v['stem'] for s in again for v in s['versions']})
            for relative,digest in hashes.items():self.assertEqual(hashlib.sha256((root/relative).read_bytes()).hexdigest(),digest)

    def test_internal_working_packets_and_exports_are_not_published(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);batch=root/'07 Batches/Writing/2026-10-29-Misc-Test';batch.mkdir(parents=True)
            (root/'01 Songs').mkdir()
            (batch/'song_v01_Misc_lyrics.md').write_text('# Song\n\nDelivered lyric',encoding='utf-8')
            for folder in ('_checks/drafts','working-history/first-candidate'):
                draft=batch/folder;draft.mkdir(parents=True)
                (draft/'song_v01_Misc_lyrics.md').write_text('# Song\n\nInternal draft',encoding='utf-8')
                (draft/'song_v01_Misc_suno-lyrics.txt').write_text('Internal export',encoding='utf-8')
            songs,_,hashes,receipt=build_studio(root,[])
            self.assertEqual([v['lyrics'] for song in songs for v in song['versions']],['Delivered lyric'])
            self.assertFalse(any('_checks/' in row['source'] or 'working-history/' in row['source'] for row in receipt))
            self.assertFalse(any('_checks/' in name or 'working-history/' in name for name in hashes))

    def test_ep_revision_aliases_keep_existing_song_and_version_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);batch=root/'07 Batches/Writing/2026-10-29-Misc-Test';batch.mkdir(parents=True)
            (root/'01 Songs').mkdir()
            for slug in ('horns','exorcism'):
                (batch/(slug+'_v02_Misc_lyrics.md')).write_text('# '+slug+'\n\nNew '+slug,encoding='utf-8')
            before=[dict(slug=slug,title=title,ep=True,versions=[dict(stem=slug+'_v01_Cue',writer='Cue',version=1,folder='2026-10-08-Reset',session='Oct 8 Reset',lyrics='Older '+title,suno={})]) for slug,title in [('ep1-horns','Horns'),('ep2b-exorcism','Exorcism')]]
            songs,_,_,_=build_studio(root,before)
            self.assertEqual({s['slug'] for s in songs},{'ep1-horns','ep2b-exorcism'})
            for song in songs:
                self.assertEqual(len(song['versions']),2)
                self.assertIn(song['slug']+'_v01_Cue',{v['stem'] for v in song['versions']})
                self.assertTrue(any(v['stem'].startswith('2026-10-29-Misc-Test/') for v in song['versions']))

    def test_live_import_retains_every_original_id_text_and_prompt(self):
        # Git's baseline predates this feature; compare all 132 old versions, not a sample.
        raw=subprocess.check_output(['git','show','HEAD:lyrics/songs.js'],cwd=ROOT).decode('utf-8')
        original=json.loads(re.search(r'^window.ALBUM_SONGS = (.*);$',raw,re.M)[1])
        current=catalogue(ROOT/'lyrics/songs.js');by_id={v['stem']:v for s in current for v in s['versions']}
        for song in original:
            for old in song['versions']:
                self.assertIn(old['stem'],by_id)
                for key in ('lyrics','suno','writer','version'):self.assertEqual(by_id[old['stem']][key],old[key],old['stem']+' '+key)
        self.assertEqual(len(by_id),sum(len(s['versions']) for s in current))

    def test_live_import_is_idempotent_and_receipt_sources_unchanged(self):
        receipt_path=ROOT/'test-artifacts/lyric-review/studio-import.json'
        if not receipt_path.is_file():self.skipTest('Private Studio receipt not available')
        receipt=json.loads(receipt_path.read_text(encoding='utf-8'));root=Path(receipt['source'])
        before=catalogue(ROOT/'lyrics/songs.js');again=build_studio(root,before)[0]
        ids=lambda rows:{v['stem'] for s in rows for v in s['versions']}
        self.assertEqual(ids(before),ids(again))
        for relative,digest in receipt['sha256'].items():self.assertEqual(hashlib.sha256((root/relative).read_bytes()).hexdigest(),digest,relative)

if __name__=='__main__':unittest.main(verbosity=2)
