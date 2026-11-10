"""Fail-closed coverage, exact-version links, deduplication, and source immutability."""
import csv
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('boards_sync', Path(__file__).resolve().parents[1]/'scripts/sync-studio-boards.py')
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


class CatalogSyncTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo, self.studio, self.catalog, self.private = [self.base/n for n in ['repo', 'studio', 'catalog', 'private']]
        self.old_root = sync.ROOT
        sync.ROOT = self.repo
        self.addCleanup(setattr, sync, 'ROOT', self.old_root)
        for rel in ['lyrics', 'audio', 'scripts']:
            (self.repo/rel).mkdir(parents=True)
        for rel in ['data', 'dist', '.private/runs/20261109T120000000000Z']:
            (self.catalog/rel).mkdir(parents=True)
        self.batch = self.studio/'07 Batches/Writing/2026-11-05-Cue-Test'
        (self.batch/'Suno Pass').mkdir(parents=True)
        self.rows = []
        for name, version, text in [('song', '01', 'First lyric'), ('song', '02', 'Second lyric'), ('clear', '01b', 'Corrected lyric')]:
            p = self.batch/f'{name}_v{version}_Cue_lyrics.md'
            p.write_text('# '+name.title()+'\n\n'+text, encoding='utf-8')
            self.add_file(p, name, 'v'+version)
        duplicate = self.studio/'98 Working/export/song_v02_Cue_lyrics.md'
        duplicate.parent.mkdir(parents=True)
        duplicate.write_bytes((self.batch/'song_v02_Cue_lyrics.md').read_bytes())
        self.add_file(duplicate, 'song', 'v02')
        legacy = dict(stem='legacy-song-v1', file_stem='song_v01_Cue', version=1, writer='Cue', folder='2026-11-05-Cue-Test', session='Nov 5 Cue Test', source='song_v01_Cue_lyrics.md', title='Song', lyrics='First lyric', suno={'title':'Song','lyrics':None,'style':'','exclude':''}, header='', chars=11)
        (self.repo/'lyrics/songs.js').write_text(sync.encode_js('ALBUM_SONGS', [dict(slug='song', title='Song', ep=False, latest=legacy['stem'], session=legacy['session'], versions=[legacy])]), encoding='utf-8')
        (self.repo/'audio/tracks.js').write_text(sync.encode_js('ALBUM_SONGS', []), encoding='utf-8')
        (self.repo/'lyrics/audio-links.js').write_text(sync.encode_js('LYRIC_AUDIO_COUNTS', {}), encoding='utf-8')
        (self.repo/'audio/voice-personas.json').write_text('{"personas":{}}', encoding='utf-8')
        (self.repo/'scripts/refresh-board-cache.py').write_text('', encoding='utf-8')
        self.cid = '1062c997-8fff-4e93-bcac-dabb89ccee21'
        coverage = dict(started='2026-11-09T12:00:00+00:00', sources={'studio':{'status':'scanned'}, 'Suno active':{'status':'exhausted'}, 'Suno trash':{'status':'exhausted'}, 'exact_ids':{'status':'checked'}}, counts={'stale_takes':0}, unresolved_ids=[])
        self.dataset = dict(built='2026-11-09T12:00:01+00:00', coverage=coverage, clips=[dict(id=self.cid, title='Song v1_cue', base_title='Song', writer='Cue', version='v1', trashed=False, duration=120, mode='Vocal / unspecified')], files=self.rows)
        raw = {'data':{'clips':[dict(id=self.cid, title='Song v1_cue', metadata={'prompt':'First lyric'})]}}
        (self.catalog/'.private/runs/20261109T120000000000Z/0001-clip-list.json').write_text(json.dumps(raw), encoding='utf-8')
        self.save_catalog()

    def add_file(self, path, title, version):
        self.rows.append(dict(id=str(len(self.rows)), title=title, writer='Cue', version=version, kind='lyrics', path=path.relative_to(self.studio).as_posix(), sha256=hashlib.sha256(path.read_bytes()).hexdigest()))

    def save_catalog(self):
        (self.catalog/'data/catalog.json').write_text(json.dumps(self.dataset), encoding='utf-8')
        with (self.catalog/'dist/suno-track-list.csv').open('w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['Suno clip ID', 'Trashed'])
            writer.writeheader(); writer.writerow({'Suno clip ID':self.cid, 'Trashed':'False'})
        with (self.catalog/'dist/studio-file-list.csv').open('w', encoding='utf-8', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=['Relative path', 'Writer', 'Version', 'SHA256'])
            writer.writeheader()
            for row in self.rows:
                writer.writerow(dict(zip(writer.fieldnames, [row['path'], row['writer'], row['version'], row['sha256']])))

    def test_preserves_ids_and_source_bytes_deduplicates_and_links_the_exact_version(self):
        before = {p:p.read_bytes() for p in self.studio.rglob('*') if p.is_file()}
        r = sync.sync(self.studio, self.catalog, self.private, write=True)
        songs = sync.read_js(self.repo/'lyrics/songs.js')
        song = next(s for s in songs if s['slug']=='song')
        self.assertEqual(len(song['versions']), 2)
        self.assertIn('legacy-song-v1', [v['stem'] for v in song['versions']])
        self.assertIn('_v02_Cue', song['latest'])
        take = sync.read_js(self.repo/'audio/tracks.js')[0]['versions'][0]
        self.assertEqual(take['lyricStem'], 'legacy-song-v1')
        self.assertEqual(take['packetVersion'], '1')
        clear = next(s for s in songs if s['slug']=='clear')
        self.assertTrue(clear['versions'][0]['versionLabel'].startswith('v01b Cue'))
        self.assertEqual(len(r['duplicates']), 1)
        self.assertTrue(r['duplicates'][0]['canonical'].startswith('07 Batches/Writing/'))
        self.assertEqual(before, {p:p.read_bytes() for p in self.studio.rglob('*') if p.is_file()})
        first = (self.repo/'lyrics/songs.js').read_bytes()
        sync.sync(self.studio, self.catalog, self.private/'again', write=True)
        self.assertEqual(first, (self.repo/'lyrics/songs.js').read_bytes())

    def test_partial_feed_stops_before_board_writes(self):
        self.dataset['coverage']['sources']['Suno active']['status']='partial'
        self.save_catalog()
        before=(self.repo/'lyrics/songs.js').read_bytes()
        with self.assertRaisesRegex(ValueError, 'Incomplete catalog'):
            sync.sync(self.studio, self.catalog, self.private, write=True)
        self.assertEqual(before, (self.repo/'lyrics/songs.js').read_bytes())

    def test_a_missing_board_take_requires_separate_user_approval(self):
        missing='22222222-2222-4222-8222-222222222222'
        (self.repo/'audio/tracks.js').write_text(sync.encode_js('ALBUM_SONGS',[{'slug':missing,'title':'Existing take','versions':[{'stem':missing}]}]),encoding='utf-8')
        before=(self.repo/'audio/tracks.js').read_bytes()
        with self.assertRaisesRegex(ValueError,'removals require user GO'):
            sync.sync(self.studio,self.catalog,self.private,write=True)
        self.assertEqual(before,(self.repo/'audio/tracks.js').read_bytes())

    def test_disagreeing_blueprint_and_export_stop_before_board_writes(self):
        (self.batch/'song_v02_Cue_blueprint.md').write_text('### Suno Style\n\n```text\nOne style\n```', encoding='utf-8')
        (self.batch/'Suno Pass/song_v02_Cue_suno-style.txt').write_text('Different style', encoding='utf-8')
        before=(self.repo/'lyrics/songs.js').read_bytes()
        with self.assertRaisesRegex(ValueError, 'disagree'):
            sync.sync(self.studio, self.catalog, self.private, write=True)
        self.assertEqual(before, (self.repo/'lyrics/songs.js').read_bytes())

    def test_private_receipts_cannot_be_written_in_studio_or_repo(self):
        for private in [self.repo/'report', self.studio/'report']:
            with self.assertRaisesRegex(ValueError, 'outside'):
                sync.sync(self.studio, self.catalog, private, write=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
