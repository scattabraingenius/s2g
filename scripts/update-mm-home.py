from pathlib import Path
import re
import hashlib
import shutil
root=Path(__file__).resolve().parents[1]
fp_root=root.parent/'MM..HOME'
source=(fp_root/'index.html').read_text(encoding='utf-8')
old=(root/'mm-home/index.html').read_text(encoding='utf-8')
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
source=source.replace('src="./icons/nav/', 'src="../icons/nav/').replace('url("./icons/nav/', 'url("../icons/nav/')
(root/'mm-home/index.html').write_text(source,encoding='utf-8',newline='\r\n')
icons=root/'icons/nav'
icons.mkdir(parents=True,exist_ok=True)
for icon in sorted((fp_root/'icons/nav').iterdir()):
    if icon.suffix.lower() not in ('.png', '.svg'): continue
    shutil.copyfile(icon,icons/icon.name)
p=root/'service-worker.js'
s=p.read_text(encoding='utf-8')
version='scattabrain-unified-shell-v5-'+hashlib.sha256(source.encode()).hexdigest()[:12]
s=re.sub(r'const CACHE_NAME = \"[^\"]+\";', 'const CACHE_NAME = \"'+version+'\";', s, count=1)
p.write_text(s,encoding='utf-8',newline='\r\n')
print('Updated embedded FP, nav icons and the app-shell version. Review and publish both repositories.')
