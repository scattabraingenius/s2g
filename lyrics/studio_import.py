"""Import Studio lyrics with stable legacy IDs and a private reconciliation receipt."""
import collections
import copy
import hashlib
import json
import re
import unicodedata
from pathlib import Path

PACKET = re.compile(r'^(?P<slug>[a-z0-9-]+)_v(?P<ver>\d+)_(?P<writer>[A-Za-z]+)_lyrics(?P<variant>.*)\.md$', re.I)
ALIASES = {'me-though-thought-the-wake-of-hells-birth': 'the-wake-of-hells-birth',
           'horns': 'ep1-horns', 'exorcism': 'ep2b-exorcism'}

def slugify(text):
    text = unicodedata.normalize('NFKD', text).lower().replace('’', '').replace("'", '')
    return re.sub(r'[^a-z0-9]+', '-', text).strip('-')

def catalogue(path):
    text = Path(path).read_text(encoding='utf-8-sig')
    match = re.search(r'^window.ALBUM_SONGS = (.*);\s*$', text, re.M)
    if not match: raise ValueError('Existing catalogue could not be read; preserve it.')
    return json.loads(match[1])

def build_studio(root, previous):
    root = Path(root)
    if not (root/'07 Batches/Writing').is_dir() or not (root/'01 Songs').is_dir():
        raise ValueError('Studio writing and song folders must both be available.')
    songs = {s['slug']:copy.deepcopy(s) for s in previous}
    old = {v['stem']:(s,v) for s in songs.values() for v in s['versions']}
    inputs, receipt, candidates = {}, [], []
    def read(p):
        data = p.read_bytes(); inputs[str(p.relative_to(root))] = hashlib.sha256(data).hexdigest()
        return data.decode('utf-8-sig').replace('\r\n','\n')
    def add_candidate(path, **extra):
        # Internal validation drafts and saved working candidates are not deliveries.
        if any(part.casefold() in {'_checks', 'working-history', '.git'} for part in path.relative_to(root).parts):
            return
        candidates.append((path,extra))
    for path in sorted((root/'07 Batches/Writing').rglob('*_lyrics*.md')):
        if PACKET.fullmatch(path.name): add_candidate(path, kind='packet')
    # Explicitly named song drafts filed as reference, never raw source messages or mining briefs.
    for path in sorted((root/'05 Reference').rglob('*_lyrics*.md')):
        if PACKET.fullmatch(path.name): add_candidate(path,kind='reference-lyric')
    for path in sorted((root/'01 Songs').rglob('*')):
        if path.is_file() and path.suffix.lower() in ('.md','.txt') and ('Lyrics' in path.parts or '00 Scatta Anchors' in path.parts or ' - Lyrics+Notes - ' in path.name):
            add_candidate(path, kind='library')
    # A dated lyric book contains twelve explicitly headed songs, not source material.
    for path in sorted((root/'07 Batches/Writing').rglob('*Lyric-Book.md')):
        raw = read(path)
        for section in re.finditer(r'^## \d+\. ([^\n]+)\n(.*?)(?=^## \d+\. |\Z)', raw, re.M|re.S):
            add_candidate(path, kind='book', title=section[1].strip(), text=section[2].strip(), section=section[1].strip())
    for path in sorted((root/'07 Batches').rglob('*_suno-lyrics.txt')):
        add_candidate(path,kind='export')
    if not candidates: raise ValueError('No Studio lyric candidates found.')
    for path, info in candidates:
        relative=path.relative_to(root).as_posix(); raw=info.get('text') if info['kind']=='book' else read(path)
        if not raw or not raw.strip():
            receipt.append(dict(source=relative,result='empty')); continue
        body=re.sub(r'\A# [^\n]*\n+', '',raw).strip('\n')
        match=PACKET.fullmatch(path.name)
        if info['kind']=='export': match=re.fullmatch(r'(?P<slug>[a-z0-9-]+)_v(?P<ver>\d+)_(?P<writer>[A-Za-z]+)_suno-lyrics.txt',path.name,re.I)
        folder=path.relative_to(root/'07 Batches/Writing').parts[0] if path.is_relative_to(root/'07 Batches/Writing') else ('Library' if info['kind']=='library' else path.parent.name)
        if match:
            slug=ALIASES.get(match['slug'],match['slug']); ver=int(match['ver']); writer={'cg':'Misc','misc':'Misc','cue':'Cue','que':'Cue','scatta':'Scatta'}.get(match['writer'].lower(),match['writer'])
            file_stem=path.name[:path.name.lower().index('_lyrics')] if info['kind']!='export' else path.name[:-len('_suno-lyrics.txt')]
            stem=file_stem if folder in ('2026-10-08-Reset','2026-10-09-Lyric-Mine') else folder+'/'+file_stem
            variant=match.groupdict().get('variant','')
            if variant: stem+='@'+slugify(variant)
            if info['kind']=='reference-lyric': stem='studio/'+relative
            title=(re.match(r'# (.+)\n',raw)[1].strip() if re.match(r'# (.+)\n',raw) else slug.replace('-',' ').title())
        else:
            name=path.stem
            title=info.get('title') or name.split(' - Lyrics')[0]
            writer_match=re.search(r' - (Scatta|Cue|Que|Misc|UNK) - ',name,re.I) or re.search(r'\b(Cue|Misc|Scatta)$',name,re.I)
            writer={'que':'Cue','unk':'Unknown'}.get(writer_match[1].lower(),writer_match[1]) if writer_match else ('Misc' if info['kind']=='book' else 'Unknown')
            title=re.sub(r'\s+v\d+\s+(Cue|Misc|Scatta)$|\s+(Cue|Misc|Scatta)$','',title,flags=re.I)
            slug=ALIASES.get(slugify(title),slugify(title)); ver_match=re.search(r'\bv(\d+)',name); ver=int(ver_match[1]) if ver_match else 0
            file_stem=path.stem; stem='studio/'+relative+(('#'+slugify(info['section'])) if info.get('section') else '')
        if not slug: raise ValueError('Cannot identify lyric: '+relative)
        su={}
        if info['kind']=='packet' and not match.groupdict().get('variant'):
            for key,suffix in [('title','title'),('lyrics','lyrics'),('style','style'),('exclude','exclude'),('instrumental','style-instrumental')]:
                p=path.parent/'Suno Pass'/f'{file_stem}_suno-{suffix}.txt'
                if p.is_file(): su[key]=read(p)
        if info['kind']=='export': su['lyrics']=raw
        text=su.get('lyrics') or body
        # Equal text copies share a source link. Different prompts remain distinct packet versions.
        duplicate=None
        for song in songs.values():
            if song['slug']!=slug: continue
            for v in song['versions']:
                if v.get('writer')!=writer: continue
                if (v.get('suno',{}).get('lyrics') or v['lyrics']).strip()!=text.strip(): continue
                if info['kind']=='packet' and v['stem']!=stem and any(su.get(k,'') != (v.get('suno') or {}).get(k,'') for k in ('style','exclude','instrumental')): continue
                duplicate=(song,v); break
            if duplicate: break
        existing=old.get(stem)
        if existing and existing[1]['lyrics'].strip()==body.strip():
            song,v=existing
            v['sourceLocations']=sorted(set(v.get('sourceLocations',[])+[relative])); v['studioSource']=relative
            v['contentHash']=hashlib.sha256(text.encode()).hexdigest()
            receipt.append(dict(source=relative,stem=v['stem'],result='preserved-id')); continue
        if duplicate:
            song,v=duplicate; v['sourceLocations']=sorted(set(v.get('sourceLocations',[])+[relative]))
            receipt.append(dict(source=relative,stem=v['stem'],result='identical-text-copy')); continue
        if existing: stem += '@'+hashlib.sha256(raw.encode()).hexdigest()[:12]
        if stem in old: raise ValueError('Version ID collision: '+stem)
        session=folder
        if re.match(r'^\d{4}-\d{2}',folder):
            import build_songs
            session=build_songs.label(folder)
        su.setdefault('title',title); su.setdefault('lyrics',None); su.setdefault('style',''); su.setdefault('exclude','')
        if su.get('lyrics')==body: su['lyrics']=None
        v=dict(stem=stem,file_stem=file_stem,version=ver,versionLabel=path.stem if info['kind']!='packet' or match.groupdict().get('variant') else '',writer=writer,session=session,folder=folder,source=relative,studioSource=relative,sourceLocations=[relative],title=title,lyrics=body,suno=su,header='Imported '+info['kind']+' version. Approval not inferred.',chars=len(text.encode('utf-16-le'))//2,contentHash=hashlib.sha256(text.encode()).hexdigest())
        if info.get('section'): v['sourceSection']=info['section']
        song=songs.setdefault(slug,dict(slug=slug,title=title,ep=slug.startswith('ep'),versions=[]))
        song['versions'].append(v); old[stem]=(song,v)
        receipt.append(dict(source=relative,stem=stem,result='added',kind=info['kind']))
    out=list(songs.values())
    for s in out:
        s['versions'].sort(key=lambda v:(bool(re.match(r'^\d{4}-\d{2}',v.get('folder',''))),v.get('folder',''),v.get('version',0),v['stem']))
        latest=s['versions'][-1]; s.update(latest=latest['stem'],session=latest['session'])
    out.sort(key=lambda s:s['title'].lower()); out.sort(key=lambda s:max((v.get('folder','') if re.match(r'^\d{4}-\d{2}',v.get('folder','')) else '') for v in s['versions']),reverse=True)
    sessions=collections.Counter(v['session'] for s in out for v in s['versions'])
    for relative,digest in inputs.items():
        if hashlib.sha256((root/relative).read_bytes()).hexdigest()!=digest: raise ValueError('Studio input changed during import: '+relative)
    retained={v['stem'] for s in out for v in s['versions']}
    if any(v['stem'] not in retained for s in previous for v in s['versions']): raise ValueError('A legacy ID was lost.')
    folders={v['session']:v['folder'] for s in out for v in s['versions']}
    return out,[dict(label=k,folder=folders[k],versions=n) for k,n in sorted(sessions.items())],inputs,receipt

def audio_index(songs, audio_path):
    takes=catalogue(audio_path); by_stem={v['stem']:(s,v) for s in songs for v in s['versions']}
    by_text=collections.defaultdict(list)
    for s,v in by_stem.values(): by_text[(v.get('suno',{}).get('lyrics') or v['lyrics']).strip()].append((s,v))
    links=collections.defaultdict(list)
    for song in takes:
        take=song['versions'][0]; stem=take.get('lyricStem')
        matches=[by_stem[stem]] if stem in by_stem else []
        if not matches:
            text=(take.get('suno',{}).get('lyrics') or take.get('lyrics','')).strip()
            possible=by_text.get(text,[])
            if text and len(possible)==1: matches=possible
        for _,v in matches: links[v['stem']].append(dict(id=take['stem'],title=song['title'],writer=take.get('writer',''),match='existing exact link' if stem in by_stem else 'unique exact text'))
    return dict(links)
