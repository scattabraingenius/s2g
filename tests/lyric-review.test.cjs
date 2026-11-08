const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),BASE=process.env.APP_BASE_URL||'http://127.0.0.1:8765',OUT=path.join(ROOT,'test-artifacts/lyric-review');
const R=require('../lyrics/review-tools.js'),Sync=require('../lyrics/sync.js');
const w={window:{}};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'lyrics/songs.js'),'utf8'),w);
const songs=w.window.ALBUM_SONGS,links=w.window.LYRIC_REVIEW_TAKES;
const song=songs.find(s=>s.slug==='the-scattabrain-genius');const version=song.versions.find(v=>(links[v.stem]||[]).length>=2),take=links[version.stem][0],other=links[version.stem][1];
const text=version.suno?.lyrics??version.lyrics;
const empty=()=>({v:2,ratings:{},custom:{},collections:{},tracklist:[],pick:{}});
function check(label){console.log('PASS '+label);}
function pureTests(){
 const mark={start:0,end:5,quote:'hello',color:'green',fingerprint:R.fingerprint('hello world'),comment:'Keep'};
 assert(R.valid(mark,'hello world'));assert(!R.valid(mark,'hello world!'));assert(!R.valid({...mark,quote:'nope'},'hello world'));
 assert.equal(R.html('<script>\nhello',{}).includes('<script>'),false);
 assert.equal(R.html('hello world',{'mark:x':mark}).replace(/<[^>]+>/g,''),'hello world');
 const base=Sync.prepare(empty()),a=structuredClone(base),b=structuredClone(base);
 a.ratings.v={readiness:'heavy',songScore:72,'mark:a':mark,note:'PC'};b.ratings.v={'mark:b':{...mark,color:'blue'},score:90};
 const ar=Sync.capture(base,a,'pc',100),br=Sync.capture(base,b,'phone',100);
 const merged=Sync.project(base,Sync.merge(ar._sync.records,br._sync.records),'u');
 assert(merged.ratings.v['mark:a']);assert(merged.ratings.v['mark:b']);assert.equal(merged.ratings.v.readiness,'heavy');assert.equal(merged.ratings.v.score,90);assert.equal(merged.ratings.v.songScore,72);
 const deleted=structuredClone(merged);deleted.ratings.v['mark:a']=null;
 const next=Sync.capture(merged,deleted,'pc',200), projected=Sync.project(next,Sync.merge(ar._sync.records,next._sync.records),'u');
 assert.equal(projected.ratings.v['mark:a'],null);assert(projected.ratings.v['mark:b']);Sync.recordsOf(next._sync);
 check('Plain-text anchors, escaping, concurrent marks/readiness/notes and non-resurrecting removal');
}
(async()=>{
 pureTests();fs.mkdirSync(OUT,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(BASE).origin?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+'/lyrics/',{waitUntil:'networkidle'});
  const lyricSeed=empty();lyricSeed.ratings[version.stem]={score:97,note:'Keep this private review note'};
  const audioSeed=empty();audioSeed.ratings[take.id]={score:86,note:'Existing audio note'};audioSeed.ratings[other.id]={score:43};
  await page.evaluate(({lyricSeed,audioSeed})=>{localStorage.setItem('grind.album.v1',JSON.stringify(lyricSeed));localStorage.setItem('grind.audio.v1',JSON.stringify(audioSeed));},{lyricSeed,audioSeed});
  await page.goto(BASE+`/lyrics/?song=${song.slug}&version=${encodeURIComponent(version.stem)}`,{waitUntil:'networkidle'});
  assert.equal(await page.locator('#songScoreNum').inputValue(),'86');assert.match(await page.locator('.legacy-score').textContent(),/97/);
  assert.equal(await page.locator('#scoreNum').count(),0);
  await page.locator('#songScoreNum').fill('92');await page.locator('#songScoreNum').press('Tab');
  assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('grind.audio.v1')).ratings[id].score,take.id),92);
  assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('grind.audio.v1')).ratings[id].note,take.id),'Existing audio note');
  assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('grind.album.v1')).ratings[id].score,version.stem),97);
  await page.locator('#reviewTake').selectOption(other.id);assert.equal(await page.locator('#songScoreNum').inputValue(),'43');
  await page.locator('#reviewTake').selectOption(take.id);
  check('One song score per exact take; independent takes and old lyric scores/notes preserved');
  await page.locator('#versionReadiness').selectOption('heavy');await page.locator('#takeReadiness').selectOption('aside');
  await page.locator('[data-review-tag="Great writing"]').click();
  await page.locator('#detail [data-review-status="preferred"]').click();
  assert.equal(await page.locator('#versionReadiness').inputValue(),'heavy');
  assert.equal(await page.locator('#takeReadiness').inputValue(),'aside');
  assert.equal(await page.locator('#note').inputValue(),'Keep this private review note');
  await page.locator('#readinessFilter').selectOption('heavy');assert(await page.locator('#list .row').count()>0);
  await page.locator('#readinessFilter').selectOption('ready');assert.equal(await page.locator('#list .row').count(),0);
  await page.locator('#readinessFilter').selectOption('');
  check('Four readiness choices, independent version/take values, quick tags and filtering');
  const line=page.locator('#reviewLyrics .review-line').filter({hasText:/\S/}).first();
  await line.click();await page.locator('#markComment').fill('Keep this passage');await page.locator('[data-mark-color="green"]').click();
  assert(await page.locator('#reviewLyrics mark.mark-green').count()>0);assert.match(await page.locator('.passage-note').textContent(),/Keep this passage/);
  // Select a precise fragment spanning a text node, rather than only whole lines.
  await page.evaluate(()=>{const p=document.querySelector('#reviewLyrics');const walker=document.createTreeWalker(p,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(n.textContent.trim().length>8){const r=document.createRange();r.setStart(n,1);r.setEnd(n,7);const s=getSelection();s.removeAllRanges();s.addRange(r);p.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true,key:'Shift'}));break;}}});
  await page.locator('[data-mark-color="blue"]').click();assert(await page.locator('#reviewLyrics mark.mark-blue').count()>0);
  await page.reload({waitUntil:'networkidle'});assert(await page.locator('#reviewLyrics mark.mark-green').count()>0);assert(await page.locator('#reviewLyrics mark.mark-blue').count()>0);
  const plain=await page.locator('#reviewLyrics').textContent();assert.equal(plain,text);
  await page.locator('#editColorLabels').click();await page.locator('#colorLabelsDialog input[name="green"]').fill('Gold lines');await page.locator('#colorLabelsDialog button[type="submit"]').click();
  assert.equal(await page.locator('[data-mark-color="green"]').textContent(),'Gold lines');
  await page.locator('[data-delete-mark]').first().click();await page.locator('#undoReview').click();assert.equal(await page.locator('.passage-note').count(),2);
  check('Line and word selections, multiple colours, comments, custom labels, reload and Undo without changing lyrics');
  const downloadPromise=page.waitForEvent('download');await page.locator('#reviewExport').click();const download=await downloadPromise;const file=path.join(OUT,'synthetic-review-backup.json');await download.saveAs(file);
  const exported=JSON.parse(fs.readFileSync(file));assert.equal(exported.app,'lyric-review-backup');assert.equal(exported.audio.ratings[take.id].score,92);assert(exported.lyrics.ratings[version.stem]['mark:'+Object.keys(exported.lyrics.ratings[version.stem]).find(k=>k.startsWith('mark:'))?.slice(5)]);
  await page.locator('#reviewImportFile').setInputFiles(file);await page.waitForTimeout(100);assert.equal(await page.locator('.passage-note').count(),2);
  await page.evaluate(()=>{scrollTo(0,0);document.querySelector('#detail').scrollTop=0;});await page.screenshot({path:path.join(OUT,'desktop.png')});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.querySelector('.markup-panel').scrollIntoView({block:'start'}));await page.screenshot({path:path.join(OUT,'phone.png')});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  check('Combined backup/restore and phone layout without horizontal overflow');
  // A custom edit gets no automatic inherited markup and no inherited recording after text changes.
  await page.locator('#copyEdit').click();assert.equal(await page.locator('.passage-note').count(),0);
  await page.locator('#edLyrics').fill('A different lyric\nSecond line');await page.locator('#edLyrics').press('Tab');
  await page.goto(BASE+'/lyrics/',{waitUntil:'networkidle'});assert(await page.locator('#detail').isHidden());await page.locator(`.row[data-slug="${song.slug}"] .t`).click();assert.equal(await page.locator('#reviewTake').count(),0);assert.equal(await page.locator('#songScoreNum').inputValue(),'');
  check('Revised custom lyrics never inherit an old recording or highlights');
  // Every unrecorded version can be rated without creating or changing a take rating.
  const noAudio=songs.flatMap(s=>s.versions.map(v=>({s,v}))).find(({v})=>!links[v.stem]);
  await page.goto(BASE+`/lyrics/?song=${noAudio.s.slug}&version=${encodeURIComponent(noAudio.v.stem)}`,{waitUntil:'networkidle'});assert.equal(await page.locator('#songScoreNum').inputValue(),'');await page.locator('#songScoreNum').fill('88');await page.locator('#detailBack').click();assert(await page.locator('#detail').isHidden());await page.reload({waitUntil:'networkidle'});assert(await page.locator('#detail').isHidden());await page.locator(`.row[data-slug="${noAudio.s.slug}"] .t`).click();assert.equal(await page.locator('#songScoreNum').inputValue(),'88');
  // The same take score/readiness is visible and editable in Audio Board.
  await page.goto(BASE+'/audio/album/?take='+take.id,{waitUntil:'networkidle'});
  const card=page.locator(`.card[data-stem="${take.id}"]`).first();assert.equal(await card.locator('.score-in').inputValue(),'92');assert.equal(await card.locator('.take-readiness').inputValue(),'aside');
  await card.locator('.take-readiness').selectOption('ready');await card.locator('.score-in').fill('94');await card.locator('.score-in').press('Tab');
  await page.goto(BASE+`/lyrics/?song=${song.slug}&version=${encodeURIComponent(version.stem)}`,{waitUntil:'networkidle'});
  assert.equal(await page.locator('#songScoreNum').inputValue(),'94');assert.equal(await page.locator('#takeReadiness').inputValue(),'ready');
  const audioPage=await context.newPage();await audioPage.goto(BASE+'/audio/album/?take='+take.id,{waitUntil:'networkidle'});
  const audioCard=audioPage.locator(`.card[data-stem="${take.id}"]`).first();await audioCard.locator('.score-in').fill('95');await audioCard.locator('.score-in').press('Tab');
  await page.waitForFunction(()=>document.querySelector('#songScoreNum')?.value==='95');
  await page.locator('#songScoreNum').fill('96');await page.locator('#songScoreNum').press('Tab');
  await audioPage.waitForFunction(id=>document.querySelector(`.card[data-stem="${id}"] .score-in`)?.value==='96',take.id);await audioPage.close();
  await page.locator('#q').fill('Keep this private review note');assert.equal(await page.locator('#list .row').count(),1);await page.locator('#q').fill('');
  check('Live same-account tabs exchange score changes, and review notes are searchable');
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#reviewLyrics');assert.equal(await page.locator('#songScoreNum').inputValue(),'96');assert.equal(await page.locator('.passage-note').count(),2);await context.setOffline(false);
  check('Offline reload retains the catalogue, song rating and coloured passage notes');
  assert.deepEqual(errors,[]);check('Unrecorded versions retain their ratings; linked ratings/readiness round-trip through Audio Board; no JS errors');
 } finally {await browser.close();}
})().catch(err=>{console.error(err);process.exit(1);});
