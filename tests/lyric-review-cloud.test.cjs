// Two devices against the existing isolated transactional backend, never a real Firebase account.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const BASE=process.env.APP_BASE_URL||'http://127.0.0.1:8765',root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(__dirname,'album-sync-browser.test.cjs'),'utf8');
const fakeSDK=source.match(/const fakeSDK=String.raw`([\s\S]*?)`;\r?\nconst checks/)[1];
const data={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'lyrics/songs.js'),'utf8'),data);
const song=data.window.ALBUM_SONGS.find(s=>s.slug==='the-scattabrain-genius'),v=song.versions.find(v=>data.window.LYRIC_REVIEW_TAKES[v.stem]?.length>=2),take=data.window.LYRIC_REVIEW_TAKES[v.stem][0];
const wait=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out waiting for review sync');};
const stored=(page,key)=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const server=new Map(),revisions=new Map(),pages=[],errors=[];
 try {
  const sentinel={tasks:[{id:'preserve'}]};server.set('planners/the-grind-scattabrain-2026',structuredClone(sentinel));
  async function client(){
   const ctx=await browser.newContext();await ctx.route('**/*',r=>r.request().url().startsWith('https://www.gstatic.com/firebasejs/')?r.fulfill({contentType:'application/javascript',body:''}):new URL(r.request().url()).origin===new URL(BASE).origin?r.continue():r.abort());
   await ctx.exposeBinding('__backendRead',(_,target)=>({version:revisions.get(target)||0,value:structuredClone(server.get(target)??null)}));
   await ctx.exposeBinding('__backendCommit',(_,target,version,value)=>{
    assert.match(target,/^planners\/the-grind-scattabrain-2026\/album\/(audio\/)?accounts\//);
    if((revisions.get(target)||0)!==version)return{committed:false};server.set(target,structuredClone(value));revisions.set(target,version+1);
    setTimeout(()=>{for(const p of pages)if(!p.isClosed())p.evaluate(({target,value})=>window.__fake?.deliver(target,value),{target,value}).catch(()=>{});},0);
    return{committed:true,value:structuredClone(value)};
   });
   await ctx.addInitScript(()=>{window.__initialUser={uid:'review-owner',email:'review@example.test'};});await ctx.addInitScript(fakeSDK);
   const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));pages.push(p);
   await p.goto(BASE+`/lyrics/?song=${song.slug}&version=${encodeURIComponent(v.stem)}`,{waitUntil:'networkidle'});
   await wait(async()=>((await p.locator('#syncStatus').textContent()).startsWith('Synced')&&(await p.locator('#audioReviewStatus').textContent()).startsWith('Synced')));return p;
  }
  const a=await client(),b=await client();
  await a.locator('#songScoreNum').fill('91');await a.locator('#songScoreNum').press('Tab');
  await b.locator('#note').fill('Concurrent lyric note');await b.locator('#note').press('Tab');
  await wait(async()=>((await stored(b,'grind.audio.v1')).ratings[take.id]?.score===91&&(await stored(a,'grind.album.v1')).ratings[v.stem]?.note==='Concurrent lyric note'));
  console.log('PASS Two devices sync shared take ratings and independent lyric notes through separate account children');
  await a.evaluate(()=>window.__fake.setOnline(false));await b.evaluate(()=>window.__fake.setOnline(false));
  for(const [p,color] of [[a,'green'],[b,'purple']]){await p.locator('#reviewLyrics .review-line').filter({hasText:/\S/}).first().click();await p.locator(`[data-mark-color="${color}"]`).click();}
  await a.locator('#versionReadiness').selectOption('heavy');await b.locator('#takeReadiness').selectOption('aside');
  await a.evaluate(()=>window.__fake.setOnline(true));await b.evaluate(()=>window.__fake.setOnline(true));
  await wait(async()=>{const x=(await stored(a,'grind.album.v1')).ratings[v.stem],y=(await stored(b,'grind.album.v1')).ratings[v.stem];return Object.keys(x||{}).filter(k=>k.startsWith('mark:')).length===2&&Object.keys(y||{}).filter(k=>k.startsWith('mark:')).length===2&&y.readiness==='heavy'&&(await stored(a,'grind.audio.v1')).ratings[take.id]?.readiness==='aside';});
  console.log('PASS Concurrent offline highlights merge without losing either passage or independent readiness');
  await a.evaluate(()=>window.__fake.setUser({uid:'other-owner',email:'other@example.test'}));
  await wait(async()=>(await stored(a,'grind.album.v1'))._sync.owner==='other-owner'&&(await stored(a,'grind.audio.v1'))._sync.owner==='other-owner');
  assert.equal((await stored(a,'grind.audio.v1')).ratings[take.id]?.score,undefined);
  assert.equal((await stored(a,'grind.album.v1')).ratings[v.stem]?.note,undefined);
  await a.evaluate(()=>window.__fake.setUser({uid:'review-owner',email:'review@example.test'}));
  await wait(async()=>(await stored(a,'grind.audio.v1')).ratings[take.id]?.score===91);
  assert.deepEqual(server.get('planners/the-grind-scattabrain-2026'),sentinel);assert.deepEqual(errors,[]);
  console.log('PASS Switching accounts separates both stores and restores the original account; unrelated planner data untouched');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
