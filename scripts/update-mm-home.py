from pathlib import Path
import re
import hashlib
root=Path(__file__).resolve().parents[1]
source=(root.parent/'MM..HOME'/'index.html').read_text(encoding='utf-8')
old=(root/'mm-home/index.html').read_text(encoding='utf-8')
for pattern in [r'const FIREBASE_CONFIG\s*=\s*\{.*?\};',r'const FAMILY_ID\s*=.*?;']:
    assert re.search(pattern,source,re.S).group()==re.search(pattern,old,re.S).group(),'Cloud configuration differs; review before embedding'
replacements={
 '<meta name="application-name" content="MM..HOME">':'<meta name="application-name" content="ScattaBrain to Genius">',
 '<meta name="apple-mobile-web-app-title" content="MM..HOME">':'<meta name="apple-mobile-web-app-title" content="ScattaBrain">',
 'href="./manifest.webmanifest"':'href="../manifest.webmanifest"',
 'href="./icons/favicon-32.png"':'href="../favicon-32.png"',
 'href="./icons/apple-touch-icon.png"':'href="../apple-touch-icon.png"',
 'navigator.serviceWorker.register("./service-worker.js"':'navigator.serviceWorker.register("../service-worker.js"',
 '<nav class="ab-nav" id="appNav"':'<a class="btn sm app-switch-link" href="../" aria-label="Open ScattaBrain to Genius">🧠 SB2G</a>\n    <nav class="ab-nav" id="appNav"',
 '</style>':'.app-switch-link {text-decoration:none;white-space:nowrap;}\n</style>'
}
for a,b in replacements.items():
    assert a in source,a
    source=source.replace(a,b)
(root/'mm-home/index.html').write_text(source,encoding='utf-8',newline='\r\n')
p=root/'service-worker.js'
s=p.read_text(encoding='utf-8')
version='scattabrain-unified-shell-v5-'+hashlib.sha256(source.encode()).hexdigest()[:12]
s=re.sub(r'const CACHE_NAME = \"[^\"]+\";', 'const CACHE_NAME = \"'+version+'\";', s, count=1)
p.write_text(s,encoding='utf-8',newline='\r\n')
print('Updated embedded FP and its app-shell version. Review and publish both repositories.')
