#!/usr/bin/env python3
"""Refresh the shared offline shell after either board or its assets change."""
import hashlib, re
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
paths = [ROOT/'index.html',ROOT/'mm/index.html']
for folder in ('lyrics','audio','dash','studio','capture','sync'):
    paths += [p for p in (ROOT/folder).rglob('*') if p.is_file() and p.suffix in ('.html','.css','.js','.webmanifest','.png')]
digest = hashlib.sha256()
for p in sorted(paths):
    digest.update(str(p.relative_to(ROOT)).encode());digest.update(p.read_bytes())
worker = ROOT/'service-worker.js'
name = 'scattabrain-unified-shell-v5-'+digest.hexdigest()[:12]
text = re.sub(r'const CACHE_NAME = "[^"]+";',f'const CACHE_NAME = "{name}";',worker.read_text(),count=1)
worker.write_text(text,encoding='utf-8')
print('Offline cache refreshed: '+name)
