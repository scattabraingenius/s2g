/* Lyric review UI. Ratings for rendered songs always use the existing Audio Board store. */
(function() {
  'use strict';
  if (AUDIO_BOARD) return;
  const R=ReviewTools, clone=x=>JSON.parse(JSON.stringify(x));
  const AUDIO_KEY='grind.audio.v1', PREFS='__review_preferences__';
  const blank=x=>({v:2,ratings:{},tracklist:[],pick:{},custom:{},collections:{},...(x||{})});
  function readAudio(key=AUDIO_KEY) { try { return JSON.parse(localStorage.getItem(key)); } catch(e) { return null; } }
  let audio=AlbumSync.prepare(blank(readAudio())), prior=clone(audio), audioSync=null;
  if (state._sync.owner && audio._sync.owner && state._sync.owner!==audio._sync.owner) audio=AlbumSync.prepare(blank());
  prior=clone(audio);
  let prefs={}; try { prefs=JSON.parse(localStorage.getItem(KEY+'.review-view'))||{}; } catch(e) {}
  prefs.takes ||= {}; prefs.readiness ||= ''; prefs.tag ||= ''; prefs.color ||= 'green'; prefs.labels ||= {};
  let allScopes=Array.isArray(prefs.scopes)?prefs.allScopes===true:ui.scope==='all';
  const selectedScopes=new Set(Array.isArray(prefs.scopes)?prefs.scopes:ui.scope==='all'?[]:[ui.scope]);
  const linkedVersion=new URLSearchParams(location.search).get('version');
  const linked=linkedVersion&&SONGS.flatMap(s=>s.versions).find(v=>v.stem===linkedVersion);
  if(linked&&!allScopes&&![...selectedScopes].some(key=>key.startsWith('session:')?linked.session===key.slice(8):(state.collections[key.slice(11)]?.members||[]).includes(linked.stem)))selectedScopes.add('session:'+linked.session);
  function scopeState() {
    ui.scope=allScopes?'all':selectedScopes.size===1?[...selectedScopes][0]:'multi';
    prefs.scopes=[...selectedScopes];prefs.allScopes=allScopes;savePrefs();saveView();
  }
  scopeState();
  let selection=null, undoStack=[];
  const baseDetail=renderDetail, baseList=renderList;
  const baseEditing=editingDetail;
  editingDetail=function(){const pre=$('reviewLyrics'),sel=getSelection();return baseEditing() || !!(selection&&$('detail').contains(document.activeElement)) || !!(pre&&sel?.rangeCount&&!sel.isCollapsed&&pre.contains(sel.anchorNode));};
  FILTERS.push(['revision','Needs revision'],['preferred','Preferred']);
  const liveText=v=>v.suno?.lyrics ?? v.lyrics;
  function takes(v) {
    if (v.custom) { const source=Object.values(BY).flatMap(s=>s.versions).find(x=>x.stem===v.copiedFrom); return source && liveText(source)===liveText(v) ? (window.LYRIC_REVIEW_TAKES?.[source.stem]||[]) : []; }
    return window.LYRIC_REVIEW_TAKES?.[v.stem]||[];
  }
  function chosen(v) { const list=takes(v); return list.find(t=>t.id===prefs.takes[v.stem]) || list[0]; }
  function score(v) { const t=chosen(v); return t ? audio.ratings[t.id]?.score : rating(v.stem).songScore; }
  function labels() { return {...Object.fromEntries(R.colors),...(rating(PREFS).colorLabels||{})}; }
  function savePrefs() { try { localStorage.setItem(KEY+'.review-view',JSON.stringify(prefs)); } catch(e) {} }
  function remember() { prefs.open=ui.open; prefs.song=ui.song; if(ui.open) prefs.version=state.pick[ui.open]; savePrefs(); }
  function detailLayout(open) {
    const detail=$('detail'),grid=detail.closest('.grid');
    detail.hidden=!open;grid.classList.toggle('review-open',open);grid.classList.toggle('review-closed',!open);
  }
  function closeSong() {
    const slug=ui.open;selection=null;getSelection()?.removeAllRanges();ui.open=null;pendingRemoteDetail=false;delete $('detail').dataset.stem;
    const url=new URL(location.href);url.searchParams.delete('song');url.searchParams.delete('version');history.replaceState(history.state,'',url);
    remember();redraw();
    const row=$('list').querySelector(`[data-slug="${CSS.escape(slug||'')}"]`);
    (row||$('list')).scrollIntoView({block:'nearest'});row?.focus({preventScroll:true});
  }
  function saveAudio(changed=true) {
    audio=AlbumSync.capture(prior,audio,deviceId); prior=clone(audio);
    try {
      if(audio._sync.owner) localStorage.setItem(AUDIO_KEY+'.account.'+audio._sync.owner,JSON.stringify(audio));
      localStorage.setItem(AUDIO_KEY,JSON.stringify(audio));
      $('audioReviewStatus').textContent='Song rating saved on this device.';
    } catch(e) { $('audioReviewStatus').textContent='Song rating could not be saved. Export review backup before closing.'; $('audioReviewStatus').classList.add('failed'); }
    if(changed) audioSync?.changed();
  }
  function mergeAudioLocal() {
    const stored=readAudio();
    if(stored?._sync && stored._sync.owner===audio._sync.owner) {
      audio=AlbumSync.project(audio,AlbumSync.merge(audio._sync.records,AlbumSync.prepare(stored)._sync.records),audio._sync.owner); prior=clone(audio);
    }
  }
  function audioPatch(id,patch) { mergeAudioLocal(); audio.ratings[id]={...(audio.ratings[id]||{}),...patch,at:Date.now()}; saveAudio(); }
  function patch(id,values,store='lyrics',refresh=true) {
    const current=store==='audio' ? audio.ratings[id]||{} : rating(id);
    undoStack.push({store,id,values:Object.fromEntries(Object.keys(values).map(k=>[k,clone(current[k]??null)]))});
    if(undoStack.length>30) undoStack.shift();
    if(store==='audio') audioPatch(id,values); else setRating(id,values);
    if(refresh)redraw();else rerenderKeepDetail();
  }
  function undoReview() { const last=undoStack.pop(); if(!last) return; if(last.store==='audio') audioPatch(last.id,last.values); else setRating(last.id,last.values); redraw(); toast('Review change undone'); }
  function redraw() { renderList(); renderSummary(); renderDetail(); }
  best=function(s,versions=scopedVersions(s)) { const scores=versions.flatMap(v=>takes(v).length?takes(v).map(t=>audio.ratings[t.id]?.score):[rating(v.stem).songScore]).filter(Number.isFinite); return scores.length ? Math.max(...scores) : null; };
  const originalMatches=matches;
  scopedVersions=function(s) { return versionsOf(s).filter(v=>(allScopes||[...selectedScopes].some(key=>key.startsWith('session:')?v.session===key.slice(8):key.startsWith('collection:')&&(state.collections[key.slice(11)]?.members||[]).includes(v.stem)))&&(!prefs.readiness || (rating(v.stem).readiness||'unassessed')===prefs.readiness) && (!prefs.tag || (rating(v.stem).tags||[]).includes(prefs.tag))); };
  const baseChips=renderChips;
  renderChips=function() {
    for(const key of selectedScopes)if(key.startsWith('collection:')&&!state.collections[key.slice(11)])selectedScopes.delete(key);
    scopeState();baseChips();
    for(const b of $('sessionChips').querySelectorAll('[data-scope]'))b.setAttribute('aria-pressed',b.dataset.scope==='all'?allScopes:!allScopes&&selectedScopes.has(b.dataset.scope));
  };
  chooseScope=function(key) {
    if(key==='all'){selectedScopes.clear();allScopes=true;}
    else {allScopes=false;selectedScopes.has(key)?selectedScopes.delete(key):selectedScopes.add(key);}
    scopeState();renderChips();redraw();
  };
  const sortModes={title:['Title','asc'],score:['Rating','desc'],newest:['Date','desc'],status:['Status','asc'],length:['Lyric length','desc'],writer:['Writer','asc']};
  ui.sort=sortModes[viewPrefs.sort]?viewPrefs.sort:'newest';
  sortDir=function(){return ui.dir||sortModes[ui.sort]?.[1]||'asc';};
  function versionDate(v) {
    if(v.created)return new Date(v.created).toISOString();
    const folder=String(v.folder||'').match(/^(\d{4}-\d{2}(?:-\d{2})?)(?=\D|$)/);
    if(folder)return folder[1];
    return String(v.studioSource||v.source||'').split(/[\\/]/).at(-1).match(/(?:^|[^\d])(\d{4}-\d{2}-\d{2})(?=[^\d]|$)/)?.[1]||null;
  }
  function sortValue(s) {
    const versions=scopedVersions(s),v=version(s);
    if(ui.sort==='score')return best(s,versions);
    if(ui.sort==='newest')return versions.map(versionDate).filter(Boolean).sort().at(-1)||null;
    if(ui.sort==='status')return Math.min(...versions.map(v=>({preferred:0,short:1,maybe:2,revision:4,cut:5}[rating(v.stem).status]??3)));
    if(ui.sort==='length')return Math.max(...versions.map(v=>liveText(v).length));
    if(ui.sort==='writer')return v.writer&&v.writer!=='Unknown'?v.writer:null;
    return s.title;
  }
  sorted=function(rows) {return rows.slice().sort((a,b)=>{const x=sortValue(a),y=sortValue(b),tie=a.title.localeCompare(b.title,undefined,{numeric:true});if(x==null||y==null)return (x==null)-(y==null)||tie;const cmp=typeof x==='string'?x.localeCompare(y,undefined,{numeric:true}):x-y;return(sortDir()==='desc'?-cmp:cmp)||tie;});};
  renderSortDir=function(){const b=$('sortDir'),down=sortDir()==='desc';b.textContent=down?'↓ Desc':'↑ Asc';b.setAttribute('aria-label','Sort direction: '+(down?'descending':'ascending')+'. Click to flip.');b.title=ui.sort==='newest'?(down?'Newest first':'Oldest first'):(down?'Descending':'Ascending');};
  $('sort').value=ui.sort;renderSortDir();saveView();
  matches=function(s) {
    const filter=ui.filter;
    if(filter==='unrated') ui.filter='all';
    const query=ui.q,searchMatched=originalMatches(s);ui.q='';
    const matched=originalMatches(s);ui.q=query;ui.filter=filter;
    if(!matched) return false;
    if(query&&!searchMatched&&!scopedVersions(s).some(v=>[rating(v.stem).note,...(rating(v.stem).tags||[]),...R.marks(rating(v.stem)).map(m=>m.comment)].some(text=>String(text||'').toLowerCase().includes(query.toLowerCase()))))return false;
    if(filter==='unrated'&&scopedVersions(s).some(v=>score(v)!=null))return false;
    if(['revision','preferred'].includes(filter)&&!scopedVersions(s).some(v=>rating(v.stem).status===filter))return false;
    return scopedVersions(s).some(v=>(!prefs.readiness || (rating(v.stem).readiness||'unassessed')===prefs.readiness) && (!prefs.tag || (rating(v.stem).tags||[]).includes(prefs.tag)));
  };
  // The old lyric score remains untouched and is only labelled as a previous score.
  versionScoreHtml=function(s,v,current) { const n=score(v),r=rating(v.stem); return `<button class="version-score" data-open-ver="${esc(v.stem)}" aria-pressed="${ui.open===s.slug&&v.stem===current.stem}"><span>${esc(verLabel(v))}<small class="version-status">${esc(R.readiness.find(([k])=>k===(r.readiness||'unassessed'))?.[1]||'Not assessed')}${r.status?' · '+esc(STATUSES.find(([k])=>k===r.status)?.[1]||r.status):''}</small></span><strong title="Song rating for selected audio take">${n??'–'}</strong></button>`; };
  chipHtml=function(s,v,cur) { const n=score(v);return `<button class="btn small" data-ver="${esc(v.stem)}" aria-pressed="${v.stem===cur.stem}">${esc(verLabel(v))}${n!=null?' · '+n:''}</button>`; };
  renderList=function() {
    baseList();
    for(const row of $('list').querySelectorAll('.row')) {
      const s=BY[row.dataset.slug],v=version(s),r=rating(v.stem);
      const versions=row.querySelector('.version-scores');
      if(versions&&ui.sort==='score') {const byStem=Object.fromEntries(scopedVersions(s).map(v=>[v.stem,v]));for(const chip of [...versions.children].sort((a,b)=>(score(byStem[b.dataset.openVer])??-1)-(score(byStem[a.dataset.openVer])??-1)))versions.append(chip);}
      if(versions) {const d=document.createElement('details');d.className='row-version-history';d.open=ui.open===s.slug;const count=scopedVersions(s).length;d.innerHTML=`<summary>${count} ${count===1?'version':'versions'} · ${esc(verLabel(v))}</summary>`;versions.replaceWith(d);d.append(versions);}
      row.insertAdjacentHTML('beforeend',`<div class="review-quick" data-review-version="${esc(v.stem)}"><div class="review-quick-status">${[['short','Shortlist'],['maybe','Maybe'],['revision','Needs revision'],['preferred','Preferred']].map(([key,label])=>`<button class="btn small" data-quick-status="${key}" aria-pressed="${r.status===key}">${label}</button>`).join('')}</div><label>Listening <select data-quick-readiness aria-label="Listening readiness for ${esc(s.title)}">${R.options(r.readiness)}</select></label>${r.note?`<small class="review-note-preview">${esc(r.note.slice(0,140))}</small>`:''}</div>`);
    }
    const names=[...selectedScopes].map(key=>key.startsWith('session:')?key.slice(8):state.collections[key.slice(11)]?.name||'Custom session');
    $('scopeNote').textContent=(allScopes?'All sessions':names.length?names.join(' + '):'No sessions selected')+` · ${$('list').querySelectorAll('.row').length} songs · ${SONGS.reduce((n,s)=>n+scopedVersions(s).length,0)} versions`;
    remember();
  };
  const baseAlbum=renderAlbum;
  renderAlbum=function() {baseAlbum();for(const row of $('tracks').querySelectorAll('.track')){const s=BY[row.dataset.slug];if(!s)continue;const n=score(version(s)),box=row.querySelector('.score');box.textContent=n??'–';box.title='Song rating for selected audio take';box.className='score '+scoreClass(n);}};
  function markupPanel(v) {
    const text=liveText(v),r=rating(v.stem),all=R.marks(r),names=labels();
    return `<section class="markup-panel" aria-label="Lyric markup"><div class="field-head"><h3>Mark up lyrics</h3><button class="btn small" id="editColorLabels">Colour labels</button></div><p class="meta">Select words, or tap a line, then choose a colour. Source lyrics stay unchanged.</p><div class="markup-toolbar" role="toolbar" aria-label="Highlight colours">${R.colors.map(([key])=>`<button class="btn small swatch swatch-${key}" data-mark-color="${key}" aria-pressed="${prefs.color===key}">${esc(names[key])}</button>`).join('')}<button class="btn small" id="undoReview" ${undoStack.length?'':'disabled'}>Undo</button></div><p class="meta" id="selectionHint" role="status">Tap a line or select a passage to mark it.</p><label class="meta" for="markComment">Passage comment (optional)</label><input id="markComment" maxlength="1000" placeholder="What works or what should change?"><button class="btn small primary" id="applyMark">Highlight selection</button><pre id="reviewLyrics" class="lyrics review-lyrics" tabindex="0" aria-label="Lyrics to highlight">${R.html(text,r)}</pre>${all.length?`<details class="style" data-panel="annotations" open><summary>${all.length} passage notes</summary>${all.map(m=>`<div class="passage-note"><span class="badge swatch-${esc(m.color)}">${esc(names[m.color]||m.color)}</span> ${R.valid(m,text)?'':'<strong class="failed">Text changed: review anchor</strong>'}<blockquote>${esc(m.quote)}</blockquote><p>${esc(m.comment||'')}</p><button class="btn small" data-delete-mark="${esc(m.key)}">Remove highlight</button></div>`).join('')}</details>`:''}</section>`;
  }
  renderDetail=function() {
    const s=BY[ui.open],open=!!s&&scopedVersions(s).length>0;
    detailLayout(open);baseDetail();if(!open) {remember();return;}
    const v=version(s),r=rating(v.stem),t=chosen(v),tr=t?audio.ratings[t.id]||{}:{};
    $('detailBack').outerHTML='<div class="review-detail-nav"><button class="btn small" id="detailBack">← Back to songs</button><button class="btn small" id="closeSong" aria-label="Close song">Close song ✕</button></div>';
    const range=$('scoreRange'),scorebox=range?.closest('.scorebox');
    const heading=scorebox?.previousElementSibling; if(heading) heading.textContent='Song rating: how the finished Suno take comes together';
    if(scorebox) scorebox.outerHTML=`<section class="linked-song-rating">${takes(v).length?`<label for="reviewTake">Audio take</label><select id="reviewTake">${takes(v).map(x=>`<option value="${esc(x.id)}" ${x.id===t.id?'selected':''}>${esc(x.title)}${audio.ratings[x.id]?.score!=null?' · '+audio.ratings[x.id].score:''}</option>`).join('')}</select>`:'<p class="meta">No exact audio match yet. This rating stays with this lyric version.</p>'}<label for="songScoreNum">Song rating (0–100)</label><div class="scorebox"><input id="songScoreRange" type="range" min="0" max="100" value="${score(v)??50}" aria-label="Song rating"><input id="songScoreNum" type="number" min="0" max="100" inputmode="numeric" value="${score(v)??''}" placeholder="–" aria-label="Song rating from 0 to 100"></div>${t?`<a class="btn small" href="../audio/?take=${encodeURIComponent(t.id)}">Open in Audio Board</a> <a class="btn small" href="https://suno.com/song/${esc(t.id)}" target="_blank" rel="noopener">Play on Suno</a><label class="readiness-label">Take listening readiness <select id="takeReadiness">${R.options(tr.readiness)}</select></label>`:''}${r.score!=null?`<p class="meta legacy-score">Previous lyric-board score: ${esc(r.score)} (preserved)</p>`:''}</section>`;
    $('note').insertAdjacentHTML('beforebegin',`<div class="review-controls"><label class="readiness-label">Version listening readiness <select id="versionReadiness">${R.options(r.readiness)}</select></label><div class="review-tags" role="group" aria-label="Quick tags">${R.tags.map(tag=>`<button class="chip" data-review-tag="${esc(tag)}" aria-pressed="${(r.tags||[]).includes(tag)}">${esc(tag)}</button>`).join('')}</div><div class="status"><button class="btn" data-review-status="revision" aria-pressed="${r.status==='revision'}">Needs revision</button><button class="btn" data-review-status="preferred" aria-pressed="${r.status==='preferred'}">Preferred</button></div></div>`);
    const main=$('detail').querySelector('[data-field="lyrics"]');
    if(main) main.insertAdjacentHTML('afterend',markupPanel(v));
    if(!v.custom && main) main.classList.add('review-plain-copy');
    const versions=$('detail').querySelector('.versions'); if(versions) { const details=document.createElement('details'); details.className='style version-picker';details.dataset.panel='versions';details.innerHTML=`<summary>${scopedVersions(s).length} lyric versions · ${esc(verLabel(v))}</summary>`;versions.replaceWith(details);details.append(versions); }
    const sources=v.sourceLocations||[v.studioSource||v.source];
    $('detail').insertAdjacentHTML('beforeend',`<details class="style" data-panel="provenance"><summary>Version sources (${sources.length})</summary>${sources.map(p=>`<p class="source-path">${esc(p)}</p>`).join('')}<p class="meta">Source locations identify provenance; approval is not inferred.</p></details>`);
    selection=null;
    $('applyMark').disabled=true;
    remember();
  };
  function selectRange(start,end) {
    const s=BY[ui.open];if(!s) return;const v=version(s),text=liveText(v);
    if(end<=start||!text.slice(start,end).trim()) return;
    selection={stem:v.stem,start,end,quote:text.slice(start,end),fingerprint:R.fingerprint(text)};
    $('selectionHint').textContent='Selected: '+selection.quote.slice(0,100);$('applyMark').disabled=false;
  }
  function captureSelection() {
    const pre=$('reviewLyrics'),sel=window.getSelection();if(!pre||!sel.rangeCount||sel.isCollapsed) return false;
    const range=sel.getRangeAt(0);if(!pre.contains(range.startContainer)||!pre.contains(range.endContainer)) return false;
    const before=range.cloneRange();before.selectNodeContents(pre);before.setEnd(range.startContainer,range.startOffset);
    const start=before.toString().length;selectRange(start,start+range.toString().length);return true;
  }
  $('detail').addEventListener('pointerup',e=> { if(e.target.closest('#reviewLyrics')) captureSelection(); });
  $('detail').addEventListener('keyup',e=> { if(e.target.closest('#reviewLyrics')) captureSelection(); });
  $('detail').addEventListener('click',e=>{
    const s=BY[ui.open];if(!s) return; const v=version(s),r=rating(v.stem),line=e.target.closest('.review-line');
    if(line && !captureSelection()) selectRange(Number(line.dataset.start),Number(line.dataset.end));
    const color=e.target.closest('[data-mark-color]');
    if(color) { prefs.color=color.dataset.markColor;savePrefs();for(const b of $('detail').querySelectorAll('[data-mark-color]')) b.setAttribute('aria-pressed',b===color); if(selection) applyMark(v); }
    if(e.target.closest('#applyMark')) applyMark(v);
    if(e.target.closest('#undoReview')) undoReview();
    const del=e.target.closest('[data-delete-mark]');if(del) patch(v.stem,{[del.dataset.deleteMark]:null});
    const tag=e.target.closest('[data-review-tag]');if(tag) { const tags=new Set(r.tags||[]);tags.has(tag.dataset.reviewTag)?tags.delete(tag.dataset.reviewTag):tags.add(tag.dataset.reviewTag);patch(v.stem,{tags:[...tags]}); }
    const status=e.target.closest('[data-review-status]');if(status) patch(v.stem,{status:r.status===status.dataset.reviewStatus?null:status.dataset.reviewStatus});
    if(e.target.closest('#editColorLabels')) {
      const d=$('colorLabelsDialog');d.querySelector('form').innerHTML='<h2>Highlight colour labels</h2>'+R.colors.map(([key])=>`<label>${key}<input name="${key}" maxlength="50" value="${esc(labels()[key])}" required></label>`).join('')+'<div class="scope-tools"><button class="btn primary" type="submit">Save labels</button><button class="btn" type="button" id="cancelLabels">Cancel</button></div>';
      d.querySelector('#cancelLabels').onclick=()=>d.close();d.showModal();
    }
  });
  function applyMark(v) {
    if(!selection||selection.stem!==v.stem||selection.fingerprint!==R.fingerprint(liveText(v))) { toast('Select words or tap a line first');return; }
    const mark={...selection,color:prefs.color,comment:$('markComment').value};delete mark.stem;
    patch(v.stem,{['mark:'+crypto.randomUUID()]:mark});toast('Passage highlighted');
  }
  $('detail').addEventListener('change',e=>{
    const s=BY[ui.open];if(!s) return;const v=version(s),t=chosen(v);
    if(e.target.id==='reviewTake') { prefs.takes[v.stem]=e.target.value;savePrefs();redraw(); }
    if(e.target.id==='versionReadiness') patch(v.stem,{readiness:e.target.value});
    if(e.target.id==='takeReadiness'&&t) patch(t.id,{readiness:e.target.value},'audio');
    if(e.target.id==='songScoreNum'||e.target.id==='songScoreRange') { const value=e.target.value,n=value===''?null:Math.max(0,Math.min(100,parseInt(value,10)||0));$('songScoreNum').value=n??'';$('songScoreRange').value=n??50;if(t)patch(t.id,{score:n},'audio',false);else patch(v.stem,{songScore:n},'lyrics',false); }
  });
  $('detail').addEventListener('input',e=>{
    if(e.target.id==='songScoreRange') $('songScoreNum').value=e.target.value;
    if(e.target.id==='songScoreNum') $('songScoreRange').value=e.target.value||50;
    if(e.target.id==='edLyrics') { const v=version(BY[ui.open]);$('reviewLyrics').innerHTML=R.html(liveText(v),rating(v.stem));selection=null;$('applyMark').disabled=true;$('selectionHint').textContent='Text changed. Previous highlights stay with their original passage; review them before reusing.'; }
  });
  $('list').addEventListener('click',e=>{
    if(e.target.closest('.row-version-history summary')) {e.stopImmediatePropagation();return;}
    if(e.target.closest('.review-quick')) e.stopImmediatePropagation();
    const box=e.target.closest('[data-review-version]'),b=e.target.closest('[data-quick-status]');if(!box||!b) return;
    const id=box.dataset.reviewVersion;patch(id,{status:rating(id).status===b.dataset.quickStatus?null:b.dataset.quickStatus});
  },true);
  $('list').addEventListener('keydown',e=>{if(e.target.matches('select,input,textarea'))e.stopPropagation();},true);
  $('detail').addEventListener('click',e=>{if(e.target.closest('#detailBack,#closeSong')) {e.preventDefault();e.stopImmediatePropagation();closeSong();}},true);
  $('detail').addEventListener('click',e=>{const b=e.target.closest('[data-status]');if(!b||!BY[ui.open])return;undoStack.push({store:'lyrics',id:version(BY[ui.open]).stem,values:{status:rating(version(BY[ui.open]).stem).status??null}});},true);
  $('list').addEventListener('change',e=>{if(!e.target.matches('[data-quick-readiness]'))return;patch(e.target.closest('[data-review-version]').dataset.reviewVersion,{readiness:e.target.value});});
  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea,select,[contenteditable]')||e.ctrlKey||e.metaKey||e.altKey||document.querySelector('dialog[open]'))return;
    if(e.key==='Escape'&&ui.open){e.preventDefault();closeSong();return;}
    if(e.key.toLowerCase()==='z') {e.preventDefault();undoReview();return;}
    const rows=[...$('list').querySelectorAll('.row')],index=rows.findIndex(row=>row.dataset.slug===ui.open);
    if(e.key.toLowerCase()==='j'||e.key.toLowerCase()==='k') { e.preventDefault();rows[Math.max(0,Math.min(rows.length-1,index+(e.key.toLowerCase()==='j'?1:-1)))]?.click();return; }
    const s=BY[ui.open];if(!s)return;const status={s:'short',m:'maybe',r:'revision',p:'preferred',u:null}[e.key.toLowerCase()];
    if(status!==undefined) {e.preventDefault();patch(version(s).stem,{status});}
  });
  $('chips').insertAdjacentHTML('afterend',`<div class="review-filters"><label>Listening readiness <select id="readinessFilter"><option value="">All readiness</option>${R.options()}</select></label><label>Quick tag <select id="reviewTagFilter"><option value="">All tags</option>${R.tags.map(t=>`<option>${esc(t)}</option>`).join('')}</select></label><button class="btn small" id="reviewExport">Export review backup</button><button class="btn small" id="reviewImport">Restore review backup</button><input type="file" id="reviewImportFile" accept="application/json" hidden></div><p class="meta">S shortlist · M maybe · R revise · P preferred · U unreviewed · J/K next/previous · Z undo</p><p class="meta" id="audioReviewStatus" role="status">Song ratings use the Audio Board account.</p>`);
  $('readinessFilter').value=prefs.readiness;$('reviewTagFilter').value=prefs.tag;
  $('readinessFilter').onchange=e=>{prefs.readiness=e.target.value;savePrefs();redraw();};
  $('reviewTagFilter').onchange=e=>{prefs.tag=e.target.value;savePrefs();redraw();};
  $('reviewExport').onclick=()=>{
    const blob=new Blob([JSON.stringify({app:'lyric-review-backup',exported:new Date().toISOString(),lyrics:state,audio},null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='lyric-review-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(a.href);
  };
  $('reviewImport').onclick=()=>$('reviewImportFile').click();
  $('reviewImportFile').onchange=async e=>{
    try { const data=JSON.parse(await e.target.files[0].text());if(data.app!=='lyric-review-backup')throw Error('Choose a lyric review backup');
      const lyricRecords=AlbumSync.recordsOf(data.lyrics?._sync),audioRecords=AlbumSync.recordsOf(data.audio?._sync);
      for(const incoming of [data.lyrics,data.audio]) if(incoming._sync.owner && state._sync.owner && incoming._sync.owner!==state._sync.owner)throw Error('Backup belongs to a different account');
      replaceSyncedState(AlbumSync.project(state,AlbumSync.merge(state._sync.records,lyricRecords),state._sync.owner));
      audio=AlbumSync.project(audio,AlbumSync.merge(audio._sync.records,audioRecords),audio._sync.owner);prior=clone(audio);persist();cloud?.changed();saveAudio();redraw();toast('Review backup merged');
    } catch(err) {toast('Restore failed: '+err.message);}e.target.value='';
  };
  document.body.insertAdjacentHTML('beforeend','<dialog id="colorLabelsDialog"><form></form></dialog>');
  $('colorLabelsDialog').querySelector('form').onsubmit=e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));patch(PREFS,{colorLabels:data});$('colorLabelsDialog').close();};
  // Remember version choices, but only an explicit deep link opens a song on page load.
  prefs.open=null;savePrefs();
  if(prefs.song&&BY[prefs.song]) {ui.song=prefs.song;$('songFilter').value=ui.song;}
  $('songFilter').addEventListener('change',remember);
  const originalVerLabel=verLabel;verLabel=function(v) {return v.versionLabel || originalVerLabel(v);};
  // Long source histories stay available without filling the initial screen.
  $('sessionChips').outerHTML='<details class="style session-history"><summary>Writing sessions and batches</summary>'+$('sessionChips').outerHTML+'</details>';
  $('sessionChips').onclick=e=>{const b=e.target.closest('[data-scope]');if(b)chooseScope(b.dataset.scope);};
  $('sessionChips').insertAdjacentHTML('beforebegin','<p class="meta">Choose any sessions or batches together. Click a selected one to remove it. All clears the selection.</p>');
  if(typeof firebase!=='undefined'&&firebase.apps?.length) {
    audioSync=AlbumSync.create({firebase,board:'audio',account:()=>{},read:()=>audio,replace:next=>{audio=next;prior=clone(audio);saveAudio(false);renderList();renderSummary();if(!editingDetail())renderDetail();else pendingRemoteDetail=true;},selectAccount:uid=>{
      if(!audio._sync.owner) {try {if(!localStorage.getItem(AUDIO_KEY+'.before-cloud-sync')) localStorage.setItem(AUDIO_KEY+'.before-cloud-sync',JSON.stringify(audio));}catch(e){throw Error('Export review backup before enabling song-rating sync');}}
      if(audio._sync.owner&&audio._sync.owner!==uid) {saveAudio();const cached=readAudio(AUDIO_KEY+'.account.'+uid);audio=AlbumSync.prepare(blank(cached?._sync?.owner===uid?cached:null));prior=clone(audio);undoStack=[];selection=null;saveAudio(false);renderList();renderSummary();if(!editingDetail())renderDetail();}
    },status:(text,failed)=>{$('audioReviewStatus').textContent=text;$('audioReviewStatus').classList.toggle('failed',failed);}});
  }
  window.addEventListener('storage',e=>{
    if(e.key===AUDIO_KEY) {mergeAudioLocal();const local=readAudio();if(local?._sync?.owner===audio._sync.owner&&!AlbumSync.sameRecords(local._sync.records,audio._sync.records))saveAudio();renderList();renderSummary();if(!editingDetail())renderDetail();else pendingRemoteDetail=true;}
    if(e.key===KEY&&e.newValue) {try {const next=AlbumSync.prepare(JSON.parse(e.newValue));if(next._sync.owner===state._sync.owner)replaceSyncedState(AlbumSync.project(state,AlbumSync.merge(state._sync.records,next._sync.records),state._sync.owner));}catch(err){toast('Other-tab changes could not be read. Export a backup.');}}
  });
  renderChips();redraw();
})();
