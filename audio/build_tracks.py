#!/usr/bin/env python3
"""Build the Audio Board from a current Suno export and optional SBGLP match results."""
import argparse, collections, datetime, json, re, runpy, unicodedata
from pathlib import Path
from urllib.parse import urlparse
HERE = Path(__file__).resolve().parent

def playable(url):
    if not isinstance(url,str): return None
    parsed = urlparse(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.query or parsed.fragment: return None
    if 'forbidden' in parsed.path.lower(): return None
    if not (parsed.hostname.endswith('.suno.ai') or parsed.hostname.endswith('.suno.com') or parsed.hostname == 'd2lwuy8qc234o3.cloudfront.net'): return None
    return url

def build(library, matches, lyric_catalogue):
    clips = json.loads(Path(library).read_text(encoding='utf-8-sig'))
    if not isinstance(clips,list) or not clips: raise ValueError('Empty or invalid Suno library; current catalogue is kept.')
    match_data = json.loads(Path(matches).read_text(encoding='utf-8-sig')) if matches else {}
    match_rows = {r['clip_id']:r for r in match_data.get('rows',[])}
    text = Path(lyric_catalogue).read_text(encoding='utf-8-sig')
    packet_data = json.loads(re.search(r'^window.ALBUM_SONGS = (.*);$',text,re.M).group(1))
    by_source = {'02 Album Project/Writing Sessions/'+v['source']:(s['slug'],v['stem']) for s in packet_data for v in s['versions']}
    def normalize(text): return ' '.join(unicodedata.normalize('NFKC',text or '').split())
    by_text = collections.defaultdict(list)
    for song in packet_data:
        for version in song['versions']:
            by_text[(version['writer'],str(version['version']),normalize(version['suno'].get('lyrics') or version['lyrics']))].append((song['slug'],version['stem']))
    profiles_file=HERE/'voice-personas.json'
    profiles=json.loads(profiles_file.read_text(encoding='utf-8-sig')).get('personas',{}) if profiles_file.is_file() else {}
    old_titles = {}
    snapshot = HERE.parent/'lyrics/suno-titles.csv'
    if snapshot.exists():
        import csv
        with snapshot.open(encoding='utf-8-sig', newline='') as f: old_titles = {r['clip_id']:r['old_title'] for r in csv.DictReader(f)}
    songs, ids = [], set()
    for clip in clips:
        cid = clip.get('id')
        if not isinstance(cid,str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',cid): raise ValueError('Invalid Suno clip ID')
        if cid in ids: raise ValueError('Repeated Suno clip ID')
        ids.add(cid)
        meta = clip.get('metadata') or {}; row = match_rows.get(cid,{})
        title = clip.get('title') or 'Untitled take'
        suffix = re.search(r'\.(i?)([CMS])(\d+(?:\.\d+)?)\.(\d+)$',title)
        stem = bool(re.search(r'\((Vocals|Backing Vocals|Drums|Bass|Strings|Guitar|Keyboard|Brass|Synth|Woodwinds|Percussion|FX)\)\s*$',title,re.I))
        kind = row.get('type') or ('Stem' if stem else 'Instrumental' if meta.get('make_instrumental') or (suffix and suffix[1]) else 'Vocal')
        session = {'Vocal':'Vocals','Instrumental':'Instrumentals','Stem':'Stems'}.get(kind,'Other')
        source = row.get('source','')
        writer = row.get('writer') or ({'C':'Cue','M':'Misc','S':'Scatta'}.get(suffix[2]) if suffix else 'Unknown')
        base = row.get('base_title') or (title[:suffix.start()] if suffix else re.sub(r'\s*\([^)]*\)\s*$','',title))
        packet_version = row.get('version','').removeprefix('v') or (suffix[3] if suffix else '')
        target = by_source.get(source)
        if not target and source and row.get('sbglp_lyrics'):
            # Vault promotion copies and session packets may live at different paths.
            # Link only when writer, lyric version and full text identify one imported packet.
            candidates = by_text.get((writer,packet_version,normalize(row['sbglp_lyrics'])),[])
            if len(candidates)==1: target=candidates[0]
        persona=clip.get('persona') or {}
        persona_id=persona.get('id') or meta.get('persona_id')
        profile=profiles.get(persona_id,{})
        voice_name=persona.get('name') or profile.get('name') or ('Unidentified voice persona' if persona_id else '')
        voice_checked='persona' in clip or 'persona_id' in meta or 'is_persona_root' in clip
        audio_url=playable(clip.get('audio_url'))
        if not audio_url:
            for media in clip.get('media_urls',[]):
                if not media.get('encoding') and media.get('delivery')=='progressive' and media.get('content_type') in ('m4a-opus','m4a','mp3','audio/mp4','audio/mpeg'):
                    audio_url=playable(media.get('url'))
                    if audio_url: break
        sources=[dict(id=c['id'],title=c.get('title') or 'Source take') for c in (clip.get('clip_roots') or {}).get('clips',[]) if re.fullmatch(r'[0-9a-f-]{36}',c.get('id',''))]
        duration = meta.get('duration')
        v = dict(stem=cid,version=0,writer=writer,session=session,title=title,lyrics=meta.get('prompt') or '',
                 suno=dict(title=title,lyrics=meta.get('prompt') or '',style=meta.get('tags') or '',exclude=meta.get('negative_tags') or ''),
                 type=kind,source=source,match=row.get('match') or 'Lyric packet not confirmed',packetVersion=packet_version,
                 take=int(suffix[4]) if suffix else row.get('take'),duration=duration if isinstance(duration,(int,float)) else None,
                 createdAt=clip.get('created_at') or '',oldTitle=old_titles.get(cid,''),audioUrl=audio_url,voiceName=voice_name,voiceChecked=voice_checked,personalVoice=persona_id=='a51442f3-be46-4d4d-adaf-28d74f71b0ec',sources=sources,
                 lyricSlug=target[0] if target else None,lyricStem=target[1] if target else None,header='',model=clip.get('model_name') or '')
        songs.append(dict(slug=cid,title=title,baseTitle=base,session=session,ep=False,latest=cid,versions=[v]))
    songs.sort(key=lambda s:(s['title'].casefold(),s['slug']))
    sessions = [dict(label=name,versions=sum(s['session']==name for s in songs)) for name in ('Vocals','Instrumentals','Stems','Other') if any(s['session']==name for s in songs)]
    return songs,sessions,match_data.get('exported') or datetime.datetime.now().astimezone().isoformat(timespec='minutes')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--library',required=True,type=Path)
    p.add_argument('--matches',type=Path)
    p.add_argument('--lyrics-catalogue',type=Path,default=HERE.parent/'lyrics/songs.js')
    p.add_argument('--output',type=Path,default=HERE/'tracks.js')
    args = p.parse_args()
    try: songs,sessions,built=build(args.library,args.matches,args.lyrics_catalogue)
    except (ValueError,OSError,KeyError,AttributeError) as err: p.error(str(err))
    content='// Generated by build_tracks.py. No credentials or signed download URLs.\nwindow.BOARD_KIND = "audio";\n'
    for key,value in [('ALBUM_BUILT',built),('ALBUM_SESSIONS',sessions),('ALBUM_SONGS',songs)]: content+=f'window.{key} = {json.dumps(value,ensure_ascii=False)};\n'
    tmp=args.output.with_suffix('.js.tmp');tmp.write_text(content,encoding='utf-8');tmp.replace(args.output)
    if args.output.resolve()==(HERE/'tracks.js').resolve():
        counts=dict(collections.Counter(s['versions'][0]['lyricStem'] for s in songs if s['versions'][0]['lyricStem']))
        (HERE.parent/'lyrics/audio-links.js').write_text('window.LYRIC_AUDIO_COUNTS = '+json.dumps(counts)+';\n')
        runpy.run_path(str(HERE.parent/'scripts/refresh-board-cache.py'),run_name='__main__')
    print(f'{len(songs)} audio takes; '+', '.join(str(s["versions"])+" "+s["label"] for s in sessions))
if __name__=='__main__': main()
