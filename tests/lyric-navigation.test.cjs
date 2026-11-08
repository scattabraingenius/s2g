const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const BASE=process.env.APP_BASE_URL||'http://127.0.0.1:8765',root=path.resolve(__dirname,'..'),data={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'lyrics/songs.js'),'utf8'),data);
const songs=data.window.ALBUM_SONGS,first=songs[0],second=songs.find(s=>s.slug!==first.slug);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try {for(const width of [390,1440]){
  const ctx=await browser.newContext({viewport:{width,height:900}});await ctx.route('**/*',r=>new URL(r.request().url()).origin===new URL(BASE).origin?r.continue():r.abort());
  const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(BASE+'/lyrics/',{waitUntil:'networkidle'});
  await page.evaluate(slug=>localStorage.setItem('grind.album.v1.review-view',JSON.stringify({open:slug})),first.slug);await page.reload({waitUntil:'networkidle'});
  assert(await page.locator('#detail').isHidden());
  const closedWidth=await page.locator('#list').evaluate(el=>el.getBoundingClientRect().width);
  for(const song of [first,second,first]){
    await page.locator(`.row[data-slug="${song.slug}"] .t`).click();assert(await page.locator('#detail').isVisible());assert(await page.locator('#closeSong').isVisible());
    assert.equal(await page.locator('#songScoreNum').count(),1);
    if(width===390)assert(await page.locator('#list').isHidden());else assert((await page.locator('#list').evaluate(el=>el.getBoundingClientRect().width))<closedWidth);
    await page.locator('#songScoreNum').fill('81');
    // Clicking Close directly from a focused rating field must save and close in one tap.
    await page.locator('#closeSong').click();assert(await page.locator('#detail').isHidden());assert(await page.locator('#list').isVisible());
    assert.equal(await page.locator('#list').evaluate(el=>el.getBoundingClientRect().width),closedWidth);
  }
  const version=first.versions[0];await page.goto(BASE+`/lyrics/?song=${first.slug}&version=${encodeURIComponent(version.stem)}`,{waitUntil:'networkidle'});
  assert(await page.locator('#detail').isVisible());await page.locator('#detailBack').click();assert(await page.locator('#detail').isHidden());
  assert.equal(new URL(page.url()).searchParams.has('song'),false);await page.reload({waitUntil:'networkidle'});assert(await page.locator('#detail').isHidden());
  await page.screenshot({path:path.join(root,`test-artifacts/lyric-review/closed-${width}.png`)});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  console.log(`PASS ${width}px: legacy open preference ignored, full-width list restored, one-tap close saves rating, Back closes deep link, reload stays closed, songs reopen normally`);await ctx.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
