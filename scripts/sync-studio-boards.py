#!/usr/bin/env python3
"""Sync board data from a complete, read-only Studio catalog snapshot.

No Suno requests and no Studio writes. Browser state and existing lyric IDs are
never migrated. Private source receipts must be written outside the repository.
"""
import argparse
import collections
import copy
import csv
import datetime
import hashlib
import json
from pathlib import Path
import re
import runpy
import unicodedata

ROOT = Path(__file__).resolve().parents[1]
PACKET = re.compile(r'^(?P<slug>.+?)_v(?P<version>[^_]+)_(?P<writer>[^_]+)_lyrics(?P<variant>.*)\.md$', re.I)
ALIASES = {'horns': 'ep1-horns', 'exorcism': 'ep2b-exorcism',
           'me-though-thought-the-wake-of-hells-birth': 'the-wake-of-hells-birth'}
FIELDS = [('title', 'title', 'Suno Title'), ('lyrics', 'lyrics', 'Suno Lyrics'),
          ('style', 'style', 'Suno Style'), ('exclude', 'exclude', 'Suno Exclude'),
          ('instrumental', 'style-instrumental', 'Suno Style (Instrumental)')]


def read_js(path, name='ALBUM_SONGS'):
    text = Path(path).read_text(encoding='utf-8-sig')
    match = re.search(r'window\.' + name + r'\s*=\s*', text)
    if not match:
        raise ValueError('Missing board data: ' + name)
    return json.JSONDecoder().raw_decode(text[match.end():])[0]


def encode_js(name, data):
    value = json.dumps(data, ensure_ascii=False).replace('<', '\\u003c').replace('\u2028', '\\u2028').replace('\u2029', '\\u2029')
    return 'window.' + name + ' = ' + value + ';\n'


def key(text):
    text = unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().lower()
    value = re.sub(r'[^a-z0-9]', '', text)
    return {'methoughthought': 'thewakeofhellsbirth'}.get(value, value)


def version_key(value):
    value = str(value).lower().removeprefix('v')
    return re.sub(r'^0+(?=\d)', '', value)


def display_title(title):
    return re.sub(r'\s+v\d+(?:\.\d+)?[_\s-]+(?:cue|misc|cg|scatta)(?:-\d{2}-\d{2})?$', '', title, flags=re.I).strip()


def words(text):
    # Line wrapping and spacing do not identify a different lyric edition.
    return ' '.join(unicodedata.normalize('NFKC', text or '').split())


def lyric_body(raw):
    """Copy lyric lines, excluding document title and explicitly headed notes."""
    body = re.sub(r'\A\ufeff?\s*# [^\n]*\n+', '', raw)
    section = re.search(r'^## Lyrics\s*\n', body, re.M | re.I)
    if section:
        body = body[section.end():]
    notes = re.search(r'^#{1,3}\s+(?:Source map|Left in the pile|Source and adaptation notes|Revision Notes|Source details preserved|Pocket key)\b', body, re.M | re.I)
    if notes:
        body = body[:notes.start()]
    return body.strip('\n')


def session_label(folder):
    legacy = {'2026-10-08-Reset': 'Oct 8 Reset', '2026-10-09-Lyric-Mine': 'Oct 9 Lyric Mine'}
    if folder in legacy:
        return legacy[folder]
    if re.match(r'^\d{4}-\d{2}', folder):
        date = datetime.date.fromisoformat(folder[:10] if re.match(r'^\d{4}-\d{2}-\d{2}', folder) else folder[:7]+'-01')
        tail = re.sub(r'Battle(\d+)', r'Battle \1', folder[10:].strip('-').replace('-', ' '))
        return f'{date:%b} {date.day}' + (' ' + tail if tail else '')
    return folder


def sync(studio, catalog_dir, private_dir, write=False):
    studio, catalog_dir, private_dir = Path(studio).resolve(), Path(catalog_dir).resolve(), Path(private_dir).resolve()
    if private_dir.is_relative_to(ROOT) or private_dir.is_relative_to(studio):
        raise ValueError('Private receipts must be outside the repo and Studio.')
    dataset = json.loads((catalog_dir/'data/catalog.json').read_text(encoding='utf-8-sig'))
    coverage = dataset['coverage']
    sources = coverage['sources']
    required = {'studio': 'scanned', 'Suno active': 'exhausted', 'Suno trash': 'exhausted', 'exact_ids': 'checked'}
    if 'board_ids' in sources:
        required['board_ids'] = 'checked'
    if any(sources.get(k, {}).get('status') != v for k, v in required.items()) or coverage['counts'].get('stale_takes') or coverage.get('unresolved_ids'):
        raise ValueError('Incomplete catalog coverage. Stop for user review.')
    with (catalog_dir/'dist/suno-track-list.csv').open(encoding='utf-8-sig', newline='') as f:
        csv_clips = list(csv.DictReader(f))
    with (catalog_dir/'dist/studio-file-list.csv').open(encoding='utf-8-sig', newline='') as f:
        csv_files = list(csv.DictReader(f))
    clips = {c['id']: c for c in dataset['clips'] if c.get('trashed') is False}
    if set(clips) != {c['Suno clip ID'] for c in csv_clips if c['Trashed'] == 'False'}:
        raise ValueError('Catalog and Suno CSV disagree.')
    file_rows = {f['path']: f for f in dataset['files']}
    for row in csv_files:
        f = file_rows[row['Relative path']]
        if (row['Writer'], row['Version'], row['SHA256']) != (f['writer'], f['version'], f.get('sha256', '')):
            raise ValueError('Catalog and Studio CSV disagree.')
    before_lyrics = read_js(ROOT/'lyrics/songs.js')
    before_audio = read_js(ROOT/'audio/tracks.js')
    # Removal requires a separate user decision, including a verified trash flag.
    current_clips = {c['id']: c for c in dataset['clips']}
    removals = [dict(title=s['title'], clip_id=s['slug'],
                     why='Trashed on Suno' if current_clips.get(s['slug'], {}).get('trashed') is True else 'Not verified active in the repaired catalog')
                for s in before_audio if s['slug'] not in clips]
    if removals:
        print(json.dumps({'STOP_REMOVAL_APPROVAL_REQUIRED': removals}, ensure_ascii=True))
        raise ValueError('Board removals require user GO. No board files were changed.')
    songs = {s['slug']: copy.deepcopy(s) for s in before_lyrics}
    original_ids = {v['stem'] for s in before_lyrics for v in s['versions']}
    by_id = {v['stem']: (s, v) for s in songs.values() for v in s['versions']}
    inputs, candidates, duplicates, excluded, flags = {}, [], [], [], []

    def read(path):
        path = path.resolve()
        if not path.is_relative_to(studio) or any('telegram' in p.casefold() for p in path.parts):
            raise ValueError('Disallowed source.')
        data = path.read_bytes()
        inputs[path.relative_to(studio).as_posix()] = hashlib.sha256(data).hexdigest()
        return data.decode('utf-8-sig').replace('\r\n', '\n')

    rows = [f for f in file_rows.values() if ('lyric' in f['kind'].lower() and f['kind'] not in {'suno-lyrics', 'lyrics+notes'}) or f['kind'] == 'anchor']
    rows.sort(key=lambda f: (not f['path'].startswith('07 Batches/Writing/'), not f['path'].startswith('01 Songs/'), f['path']))
    seen_hashes = {}
    for f in rows:
        rel = f['path']
        if any(p.casefold() in {'_checks', 'working-history'} for p in Path(rel).parts):
            excluded.append(rel)
            continue
        digest = f.get('sha256')
        if digest and digest in seen_hashes:
            duplicates.append({'source': rel, 'canonical': seen_hashes[digest]})
            continue
        if digest:
            seen_hashes[digest] = rel
        path = studio/rel
        raw = read(path)
        if digest and inputs[rel] != digest:
            raise ValueError('Studio changed after catalog refresh: ' + path.name)
        body = lyric_body(raw)
        if not body.strip():
            raise ValueError('Empty lyric file: ' + path.name)
        for i, line in enumerate(raw.splitlines(), 1):
            if re.search(r'\bmortgage\b', line, re.I):
                flags.append({'file': rel, 'line': i, 'rule': 'housing reference'})
            if re.search(r"\b(?:aged?|turned|turning|I.m|I am)\s+(?:\d{2}|(?:twenty|thirty|forty|fifty|sixty|seventy)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)\b|\b\d{2}[- ]years?[- ]old\b", line, re.I):
                flags.append({'file': rel, 'line': i, 'rule': 'possible exact age'})
        if re.search(r'^#{1,4}\s*Pocket\s+key\b', body, re.M | re.I):
            raise ValueError('Pocket key section in lyrics: ' + path.name)
        m = PACKET.fullmatch(path.name)
        if m:
            slug = ALIASES.get(m['slug'], m['slug'])
            raw_version = f['version']
            version = int(re.match(r'\d+', raw_version.removeprefix('v'))[0]) if re.match(r'\d+', raw_version.removeprefix('v')) else 0
            file_stem = path.name[:path.name.lower().index('_lyrics')]
            folder = next((p for p in Path(rel).parts if re.match(r'^\d{4}-\d{2}(?:-|$)', p)), 'Library')
            stem = file_stem if folder in {'2026-10-08-Reset', '2026-10-09-Lyric-Mine'} else folder+'/'+file_stem
            if m['variant']:
                stem += '@' + re.sub(r'[^a-z0-9]+', '-', m['variant'].lower()).strip('-')
        else:
            title = f['title']
            slug = re.sub(r'[^a-z0-9]+', '-', unicodedata.normalize('NFKD', title).encode('ascii', 'ignore').decode().lower().replace("'", '')).strip('-')
            slug = ALIASES.get(slug, slug)
            raw_version = f['version']
            v = re.search(r'\d+', raw_version)
            version = int(v[0]) if v else 0
            file_stem, folder, stem = path.stem, 'Library', 'studio/'+rel
        writer = {'cg': 'Misc', 'que': 'Cue', 'unk': 'Unknown'}.get(f['writer'].lower(), f['writer'] or 'Unknown')
        title_match = re.match(r'\s*# (.+)\n', raw)
        title = display_title(title_match[1]) if title_match and m else (slug.replace('-', ' ').title() if m else f['title'])
        fields = {}
        blueprint = path.with_name(file_stem+'_blueprint.md')
        blueprint_fields = {}
        if m and blueprint.is_file():
            bp = read(blueprint)
            for field, _, heading in FIELDS:
                match = re.search(r'^###\s+'+re.escape(heading)+r'\s*\n+```[^\n]*\n(.*?)\n```', bp, re.M | re.S)
                if match:
                    blueprint_fields[field] = match[1]
        for field, suffix, _ in FIELDS:
            export = path.parent/'Suno Pass'/(file_stem+'_suno-'+suffix+'.txt')
            if export.is_file():
                fields[field] = read(export)
                if field in blueprint_fields and fields[field].rstrip('\n') != blueprint_fields[field].rstrip('\n'):
                    raise ValueError('Blueprint and Suno Pass disagree: ' + export.name)
            elif field in blueprint_fields:
                fields[field] = blueprint_fields[field]
        session = session_label(folder)
        candidate = {'source': rel, 'slug': slug, 'writer': writer, 'raw_version': raw_version,
                     'body': body, 'fields': fields, 'title': title, 'folder': folder, 'stem': stem}
        candidates.append(candidate)
        song = songs.setdefault(slug, dict(slug=slug, title=title, ep=slug.startswith('ep'), versions=[]))
        matches = [v for v in song['versions'] if v.get('writer') == writer
                   and v.get('lyrics', '').replace('\r\n', '\n').strip('\n') == body
                   and (Path(v.get('studioSource') or v.get('source', '')).name == path.name
                        or version_key((v.get('versionLabel') or str(v.get('version', ''))).split(' ')[0]) == version_key(raw_version))]
        existing = by_id.get(stem)
        if existing and existing[0]['slug'] == slug and existing[1] in matches:
            target = existing[1]
        elif matches:
            target = next((v for v in matches if Path(v.get('studioSource') or v.get('source', '')).name == path.name), matches[0])
        else:
            if stem in by_id:
                stem += '@' + hashlib.sha256(raw.encode()).hexdigest()[:12]
            if stem in by_id:
                raise ValueError('Lyric identity collision.')
            su = dict(title=fields.get('title', title), lyrics=fields.get('lyrics'), style=fields.get('style', ''), exclude=fields.get('exclude', ''))
            if 'instrumental' in fields:
                su['instrumental'] = fields['instrumental']
            if su.get('lyrics') == body:
                su['lyrics'] = None
            target = dict(stem=stem, file_stem=file_stem, version=version, writer=writer,
                          session=session, folder=folder, source=path.name, title=title,
                          lyrics=body, suno=su, header='', chars=len((su.get('lyrics') or body).encode('utf-16-le'))//2,
                          clips=[], versionLabel=(raw_version+' '+writer+' · '+session).strip())
            song['versions'].append(target)
            by_id[stem] = (song, target)
        candidate['target'] = target['stem']
        if fields:
            target['suno'] = {**target.get('suno', {}), **fields}
            if target['suno'].get('lyrics') == target['lyrics']:
                target['suno']['lyrics'] = None

    # Keep every legacy identity and lyric field. Source locations and hashes are
    # private metadata, so public provenance contains filenames only.
    for song in songs.values():
        for v in song['versions']:
            v['source'] = Path(v.get('studioSource') or v.get('source', '')).name
            for name in ['studioSource', 'sourceLocations', 'contentHash']:
                v.pop(name, None)
        def order(v):
            label = v.get('versionLabel') or str(v.get('version', 0))
            suffix = re.match(r'v?0*(\d+)([a-z]*)', label, re.I)
            return (bool(re.match(r'^\d{4}-\d{2}', v.get('folder', ''))), v.get('folder', ''), v.get('version', 0), suffix[2] if suffix else '', v['stem'])
        song['versions'].sort(key=order)
        newest = song['versions'][-1]
        song.update(latest=newest['stem'], session=newest['session'])
        if any(c['slug'] == song['slug'] for c in candidates):
            current = next((c for c in reversed(candidates) if c['target'] == newest['stem']), None)
            if current:
                song['title'] = current['title']
    if not original_ids.issubset(by_id):
        raise ValueError('A saved lyric ID would be orphaned.')

    # Current catalog receipts supply generation text. Only already published
    # take fields are copied; account details and raw responses stay private.
    raw_clips = {}
    runs = catalog_dir/'.private/runs'
    run = next((p for p in sorted(runs.iterdir(), reverse=True) if re.sub(r'[^0-9]', '', p.name).startswith(re.sub(r'[^0-9]', '', coverage['started'])[:14])), None)
    if run is None:
        raise ValueError('Current read-only receipts are unavailable.')
    def collect(value):
        if isinstance(value, dict):
            if value.get('id') in clips and 'metadata' in value:
                raw_clips[value['id']] = value
            for k, val in value.items():
                if k not in {'prompt', 'lyrics', 'tags', 'negative_tags'}:
                    collect(val)
        elif isinstance(value, list):
            for val in value:
                collect(val)
    for p in sorted(run.glob('*-clip-*.json')):
        collect(json.loads(p.read_text(encoding='utf-8-sig')))
    if set(raw_clips) != set(clips):
        raise ValueError('Current receipts do not cover all active takes.')
    old_audio = {s['slug']: s for s in before_audio}
    audio, unmatched_titles, unmatched_versions, review_links = [], [], [], collections.defaultdict(list)
    profiles = json.loads((ROOT/'audio/voice-personas.json').read_text(encoding='utf-8-sig')).get('personas', {})
    for cid, c in clips.items():
        raw = raw_clips[cid]
        meta = raw.get('metadata') or {}
        previous = old_audio.get(cid, {}).get('versions', [{}])[0]
        title, base = c['title'], c['base_title']
        writer = c.get('writer') or previous.get('writer') or 'Unknown'
        pv = c.get('version', '').removeprefix('v') or str(previous.get('packetVersion') or '')
        if previous.get('type') == 'Stem':
            base = old_audio[cid].get('baseTitle') or base
        text = meta.get('prompt') or ''
        kind = 'Instrumental' if meta.get('make_instrumental') is True or c.get('mode') == 'Instrumental requested' or re.search(r'\.i[CMS]\d', title) else previous.get('type', 'Vocal')
        session = {'Vocal': 'Vocals', 'Instrumental': 'Instrumentals', 'Stem': 'Stems'}.get(kind, 'Other')
        possible = [(s, v) for s in songs.values() for v in s['versions'] if key(display_title(s['title'])) == key(base) and v['writer'] == writer]
        if not possible:
            unmatched_titles.append(title)
        exact = [(s, v) for s, v in possible if version_key(next((x['raw_version'] for x in candidates if x['target'] == v['stem']), v.get('version', ''))) == version_key(pv)
                 and words(v.get('suno', {}).get('lyrics') or v['lyrics']) == words(text)]
        target = next(((s, v) for s, v in exact if v['stem'] == previous.get('lyricStem')), None)
        if not target and exact:
            target = exact[-1]
        if possible and not target:
            unmatched_versions.append(title)
        persona = raw.get('persona') or {}
        persona_id = persona.get('id') or meta.get('persona_id')
        voice_name = persona.get('name') or profiles.get(persona_id, {}).get('name') or previous.get('voiceName', '')
        v = dict(stem=cid, version=0, writer=writer, session=session, title=title, lyrics=text,
                 suno=dict(title=title, lyrics=text, style=meta.get('tags') or '', exclude=meta.get('negative_tags') or ''),
                 type=kind, source=target[1]['source'] if target else '', match='Title, writer, version and identical generation words' if target else 'Lyric packet not confirmed',
                 packetVersion=pv, take=previous.get('take'), duration=c.get('duration'), createdAt=c.get('created') or '',
                 oldTitle=previous.get('oldTitle') or (previous.get('title') if previous.get('title') != title else '') or '',
                 audioUrl=previous.get('audioUrl'), voiceName=voice_name,
                 voiceChecked=bool(persona_id or 'is_persona_root' in raw or previous.get('voiceChecked')),
                 personalVoice=bool(persona_id == 'a51442f3-be46-4d4d-adaf-28d74f71b0ec' or previous.get('personalVoice')),
                 sources=copy.deepcopy(previous.get('sources', [])), lyricSlug=target[0]['slug'] if target else None,
                 lyricStem=target[1]['stem'] if target else None, header='', model=c.get('model') or '')
        audio.append(dict(slug=cid, title=title, baseTitle=base, session=session, ep=False, latest=cid, versions=[v]))
        if target:
            review_links[target[1]['stem']].append(dict(id=cid, title=title, writer=writer, match='Title, writer, version and identical generation words'))
    audio.sort(key=lambda s: (s['title'].casefold(), s['slug']))
    for song in songs.values():
        for v in song['versions']:
            v['clips'] = [dict(id=t['id'], title=t['title'], oldTitle='', result='active') for t in review_links.get(v['stem'], [])]
    lyrics = list(songs.values())
    lyrics.sort(key=lambda s: s['title'].lower())
    lyrics.sort(key=lambda s: max((v.get('folder', '') if re.match(r'^\d{4}-\d{2}', v.get('folder', '')) else '') for v in s['versions']), reverse=True)
    lyric_sessions = collections.Counter(v['session'] for s in lyrics for v in s['versions'])
    folders = {v['session']: v.get('folder', '') for s in lyrics for v in s['versions']}
    ls = [dict(label=k, folder=folders[k], versions=n) for k, n in sorted(lyric_sessions.items())]
    aus = [dict(label=name, versions=sum(s['session'] == name for s in audio)) for name in ('Vocals', 'Instrumentals', 'Stems', 'Other') if any(s['session'] == name for s in audio)]
    public_clips = [dict(id=s['slug'], title=s['title'], oldTitle=s['versions'][0]['oldTitle'], result='active') for s in audio]
    lyric_js = '// Generated by scripts/sync-studio-boards.py. Studio sources are read only.\n'
    for name, data in [('ALBUM_BUILT', dataset['built']), ('ALBUM_SESSIONS', ls), ('ALBUM_SONGS', lyrics), ('ALBUM_CLIPS', public_clips), ('LYRIC_REVIEW_TAKES', review_links)]:
        lyric_js += encode_js(name, data)
    audio_js = '// Generated by scripts/sync-studio-boards.py. No private account data.\n' + encode_js('BOARD_KIND', 'audio')
    for name, data in [('ALBUM_BUILT', dataset['built']), ('ALBUM_SESSIONS', aus), ('ALBUM_SONGS', audio)]:
        audio_js += encode_js(name, data)
    links_js = encode_js('LYRIC_AUDIO_COUNTS', {k: len(v) for k, v in review_links.items()})
    # Verify sources have not changed while preparing the update.
    for rel, digest in inputs.items():
        if hashlib.sha256((studio/rel).read_bytes()).hexdigest() != digest:
            raise ValueError('Studio changed during import.')
    old_lyrics = {s['slug']: s for s in before_lyrics}
    report = dict(catalog_built=dataset['built'], before=dict(lyric_songs=len(before_lyrics), lyric_versions=len(original_ids), audio_takes=len(before_audio)),
                  after=dict(lyric_songs=len(lyrics), lyric_versions=sum(len(s['versions']) for s in lyrics), audio_takes=len(audio), audio_titles=len({s['baseTitle'] for s in audio})),
                  lyric_songs_added=[s['title'] for s in lyrics if s['slug'] not in old_lyrics], lyric_songs_changed=[s['title'] for s in lyrics if s['slug'] in old_lyrics and s != old_lyrics[s['slug']]], lyric_songs_removed=[],
                  lyric_versions_added=sorted(set(by_id)-original_ids), audio_added=sorted(set(clips)-set(old_audio)), audio_removed=sorted(set(old_audio)-set(clips)),
                  audio_changed=sorted(s['slug'] for s in audio if s['slug'] in old_audio and s != old_audio[s['slug']]),
                  unmatched_titles=sorted(set(unmatched_titles)), unmatched_versions=sorted(set(unmatched_versions)),
                  duplicates=duplicates, excluded_working_drafts=excluded, rule_flags=flags, source_hashes=inputs,
                  coverage=coverage, existing_lyric_ids_preserved=len(original_ids))
    private_dir.mkdir(parents=True, exist_ok=True)
    (private_dir/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    if write:
        for rel, content in [('lyrics/songs.js', lyric_js), ('audio/tracks.js', audio_js), ('lyrics/audio-links.js', links_js)]:
            path = ROOT/rel
            backup = private_dir/'before'/rel
            backup.parent.mkdir(parents=True, exist_ok=True)
            if not backup.exists():
                backup.write_bytes(path.read_bytes())
            path.write_text(content, encoding='utf-8', newline='\n')
        runpy.run_path(str(ROOT/'scripts/refresh-board-cache.py'), run_name='__main__')
    print(json.dumps({k: v for k, v in report.items() if k not in {'source_hashes', 'coverage', 'duplicates', 'excluded_working_drafts', 'audio_removed', 'audio_added', 'audio_changed', 'lyric_versions_added', 'lyric_songs_changed', 'rule_flags'}}, ensure_ascii=True))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--studio', required=True, type=Path)
    parser.add_argument('--catalog', required=True, type=Path)
    parser.add_argument('--private-dir', required=True, type=Path)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    sync(args.studio, args.catalog, args.private_dir, args.write)
