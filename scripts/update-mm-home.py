from pathlib import Path
import re
import hashlib
import shutil
root=Path(__file__).resolve().parents[1]
fp_root=root.parent/'MM..HOME'
source=(fp_root/'index.html').read_text(encoding='utf-8')
old=(root/'mm/index.html').read_text(encoding='utf-8')
sb2g=(root/'index.html').read_text(encoding='utf-8')
for pattern in [r'const FIREBASE_CONFIG\s*=\s*\{.*?\};',r'const FAMILY_ID\s*=.*?;']:
    assert re.search(pattern,source,re.S).group()==re.search(pattern,old,re.S).group(),'Cloud configuration differs; review before embedding'
# The app bar and its nav script are one shared component. Refuse to embed while the copies differ.
for start,end in [('/* shared-appbar:start','/* shared-appbar:end */'),('/* shared-appnav-js:start','/* shared-appnav-js:end */')]:
    blocks=[text[text.index(start):text.index(end)+len(end)] for text in (source,sb2g)]
    assert blocks[0]==blocks[1],f'Shared block {start[3:]} differs between MM..HOME and SB2G; make them identical first'
replacements={
 '<meta name="application-name" content="MM..HOME">':'<meta name="application-name" content="ScattaBrain to Genius">',
 '<meta name="apple-mobile-web-app-title" content="MM..HOME">':'<meta name="apple-mobile-web-app-title" content="ScattaBrain">',
 'href="./manifest.webmanifest"':'href="../manifest.webmanifest"',
 'href="./icons/favicon-32.png"':'href="../favicon-32.png"',
 'href="./icons/apple-touch-icon.png"':'href="../apple-touch-icon.png"',
 'navigator.serviceWorker.register("./service-worker.js"':'navigator.serviceWorker.register("../service-worker.js"',
 # Inside the unified app: SB2G button + Time destination, and the nav icons from the root copy.
 'const SB2G_URL="";':'const SB2G_URL="../";',
 'const NAV_ICON_BASE="./icons/nav/";':'const NAV_ICON_BASE="../icons/nav/";',
}
for a,b in replacements.items():
    assert source.count(a)==1,a
    source=source.replace(a,b)
# The old Lyric and Audio boards are archived in place; MM Home points at the Studio Board instead.
old_lyrics='  if(SB2G_URL) items.push({id:"album", label:"Lyrics", icon:"agenda", href:SB2G_URL+"lyrics/"});'
old_album='  if(SB2G_URL) items.push({id:"album", label:"Album", icon:"agenda", href:SB2G_URL+"lyrics/"});'
old_audio='  if(SB2G_URL) items.push({id:"audio", label:"Audio", icon:"time", href:SB2G_URL+"audio/"});'
studio_link='  if(SB2G_URL) items.push({id:"studio", label:"Studio", icon:"agenda", href:SB2G_URL+"studio/"});'
for stale in (old_lyrics,old_album,old_audio):
    source=source.replace(stale+'\r\n','').replace(stale+'\n','').replace(stale,'')
if 'id:"studio"' not in source:
    anchor='  const items=["home","calendar","agenda"].map(item);'
    assert source.count(anchor)==1,'Nav items line missing from family planner'
    source=source.replace(anchor,anchor+'\n'+studio_link)
assert '"lyrics/"' not in source and '"audio/"' not in source,'Old board links are still in MM Home'
source=source.replace('src="./icons/nav/', 'src="../icons/nav/').replace('url("./icons/nav/', 'url("../icons/nav/')
(root/'mm/index.html').write_text(source,encoding='utf-8',newline='\r\n')
icons=root/'icons/nav'
icons.mkdir(parents=True,exist_ok=True)
for icon in sorted((fp_root/'icons/nav').iterdir()):
    if icon.suffix.lower() not in ('.png', '.svg'): continue
    shutil.copyfile(icon,icons/icon.name)
import runpy
runpy.run_path(str(root/'scripts/refresh-board-cache.py'),run_name='__main__')
print('Updated embedded FP, nav icons and the app-shell version. Review and publish both repositories.')
