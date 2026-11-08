const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),BASE=process.env.APP_BASE_URL||'http://127.0.0.1:8765',data={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(ROOT,'lyrics/songs.js'),'utf8'),data);
const songs=JSON.parse(JSON.stringify(data.window.ALBUM_SONGS)),A='Oct 8 Reset',B='Oct 9 Lyric Mine',C='Oct 10 Cue Battle 01';
const expected=names=>songs.flatMap(s=>s.versions.filter(v=>names.includes(v.session)).map(v=>v.stem)).sort();
const rowOrder=(names,down)=>songs.map(s=>({s,versions:s.versions.filter(v=>names.includes(v.session))})).filter(x=>x.versions.length).sort((a,b)=>{const x=a.versions.map(v=>v.folder.match(/^\d{4}-\d{2}(?:-\d{2})?/)[0]).sort().at(-1),y=b.versions.map(v=>v.folder.match(/^\d{4}-\d{2}(?:-\d{2})?/)[0]).sort().at(-1);return(down?y.localeCompare(x):x.localeCompare(y))||a.s.title.localeCompare(b.s.title,undefined,{numeric:true});}).map(x=>x.s.slug);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {for(const width of [390,1440]){
  const ctx=await browser.newContext({viewport:{width,height:900}});await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(BASE).origin?r.continue():r.abort());
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(BASE+'/lyrics/',{waitUntil:'networkidle'});
  const seed={v:2,ratings:{'some-existing-id':{score:78,note:'Keep me'}},tracklist:[],custom:{},collections:{test:{name:'My batch',created:1,members:expected([B]).slice(0,3)}},pick:{}};
  await page.evaluate(seed=>localStorage.setItem('grind.album.v1',JSON.stringify(seed)),seed);await page.reload({waitUntil:'networkidle'});
  const original=await page.evaluate(()=>localStorage.getItem('grind.album.v1'));
  const click=async name=>page.locator(`[data-scope=${JSON.stringify(name==='all'?'all':'session:'+name)}]`).click();
  const displayed=async()=> (await page.locator('#list [data-open-ver]').evaluateAll(nodes=>nodes.map(n=>n.dataset.openVer))).sort();
  await page.locator('.session-history>summary').click();await click(A);await click(B);await click(C);assert.deepEqual(await displayed(),expected([A,B,C]));
  for(const name of [A,B,C])assert.equal(await page.locator(`[data-scope=${JSON.stringify('session:'+name)}]`).getAttribute('aria-pressed'),'true');
  await click(B);assert.deepEqual(await displayed(),expected([A,C]));assert.equal(await page.locator('[data-scope="all"]').getAttribute('aria-pressed'),'false');
  await page.locator('#sort').selectOption('newest');assert.equal(await page.locator('#sortDir').textContent(),'↓ Desc');assert.deepEqual(await page.locator('#list .row').evaluateAll(rows=>rows.map(r=>r.dataset.slug)),rowOrder([A,C],true));
  await page.locator('#sortDir').click();assert.deepEqual(await page.locator('#list .row').evaluateAll(rows=>rows.map(r=>r.dataset.slug)),rowOrder([A,C],false));
  await page.reload({waitUntil:'networkidle'});assert.deepEqual(await displayed(),expected([A,C]));assert.equal(await page.locator('#sort').inputValue(),'newest');assert.equal(await page.locator('#sortDir').textContent(),'↑ Asc');
  await page.locator('.session-history>summary').click();await click(A);await click(C);assert.equal(await page.locator('#list .row').count(),0);assert.equal(await page.locator('[data-scope="all"]').getAttribute('aria-pressed'),'false');
  await click('all');assert.deepEqual(await displayed(),songs.flatMap(s=>s.versions.map(v=>v.stem)).sort());
  await click(A);await page.locator('[data-scope="collection:test"]').click();assert.deepEqual(await displayed(),[...new Set([...expected([A]),...seed.collections.test.members])].sort());
  await click('all');assert.equal(await page.locator('#sessionChips [aria-pressed="true"]').count(),1);
  assert.deepEqual(await page.locator('#sort option').evaluateAll(options=>options.map(o=>o.value)),['title','score','newest','status','length','writer']);
  for(const sort of ['title','score','status','length','writer'])await page.locator('#sort').selectOption(sort);
  assert.equal(await page.evaluate(()=>localStorage.getItem('grind.album.v1')),original);assert.deepEqual(errors,[]);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  console.log(`PASS ${width}px: A+B+C union, toggle B off, empty selection stays empty, All resets, custom batch union deduplicates, date directions and reload persist, all sort modes work, review data unchanged`);await ctx.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
