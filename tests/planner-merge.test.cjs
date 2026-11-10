const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),vm=require('vm');
const BASE=process.env.APP_BASE_URL,ROOT=path.join(__dirname,'..');
const checked=message=>console.log('PASS '+message);
const ctx={window:{}};vm.runInNewContext(fs.readFileSync(path.join(ROOT,'audio/tracks.js'),'utf8'),ctx);
const hasWords=t=>/[\p{L}\p{N}]/u.test(String(t||'').replace(/\[[^\]]*\]|\([^)]*\)/g,' ')),kind=s=>{const v=s.versions[0];return v.type==='Vocal'&&!hasWords(v.suno?.lyrics??v.lyrics)?'Instrumental':v.type;};
const SONGS=ctx.window.ALBUM_SONGS,vocals=SONGS.filter(s=>kind(s)==='Vocal');
const withLyrics=vocals.find(s=>s.versions[0].lyrics);
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  try {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(BASE).origin?route.continue():route.abort());
    // Album picks shows the takes in the planner; put every catalogue take in it.
    await context.addInitScript(seed=>{if(!localStorage.getItem('seeded')){localStorage.setItem('grind.planner.v1',seed);localStorage.setItem('seeded','1');}},JSON.stringify({considered:Object.fromEntries(SONGS.map(s=>[s.slug,{added:1}])),sessions:{},albums:{}}));
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',d=>d.type()==='prompt'?d.accept('Planner nickname'):d.accept());

    await page.goto(BASE+'/audio/?view=consider',{waitUntil:'networkidle'});
    assert.match(page.url(),/\/audio\/album\/\?/);
    assert.equal(await page.locator('#considerList .card').count(),vocals.length);
    checked('Audio Board opens the planner; Album picks starts with every considered vocal take as Unreviewed');

    await page.locator('#typeFilter').selectOption('all');
    assert.equal(await page.locator('#considerList .card').count(),SONGS.length);
    await page.locator('#typeFilter').selectOption('Vocal');

    // Inline lyrics: one Lyrics control that opens the text and the Lyric Board link.
    const card=page.locator(`.card[data-stem="${withLyrics.slug}"]`);
    const lyrics=card.locator('.lyrics-body');
    assert.equal(await lyrics.isHidden(),true);
    await card.locator('[data-act="lyrics"]').click();
    assert.equal(await lyrics.isVisible(),true);
    assert((await lyrics.locator('pre.lyrics').textContent()).length>20);
    await page.click('#sortDir');
    assert.equal(await page.locator(`.card[data-stem="${withLyrics.slug}"] .lyrics-body`).isVisible(),true,'lyrics stay open through redraws');
    checked('Each card has one Lyrics control that stays open through redraws');

    // Grouping choices.
    await page.locator('#groupBy').selectOption('album');
    assert((await page.locator('.group header h3').allTextContents()).some(t=>/Not on an album/.test(t)));
    await page.locator('#groupBy').selectOption('song');
    checked('Group by song or album');

    // Rename and Delete work from the card and the ⋯ menu.
    const target=vocals[3].slug,mine=page.locator(`.card[data-stem="${target}"]`);
    await mine.locator('[data-act="rename"]').click();
    assert.match(await mine.locator('.t b').textContent(),/Planner nickname/);
    await mine.locator('[data-act="menu"]').click();
    await mine.locator('[data-act="delete"]').click();
    await page.waitForTimeout(450);
    assert.equal(await page.locator(`.card[data-stem="${target}"]`).count(),0,'a delete-tagged take leaves the buckets');
    await page.click('#tabCleanup');
    assert.equal(await page.locator(`.clean-row[data-stem="${target}"]`).count()>=1,true);
    await page.click('#tabConsider');
    checked('Rename and Delete work on a take; delete-tagged takes leave the buckets and appear in Suno cleanup');

    // One-take and lyric-source links.
    await page.goto(BASE+'/audio/classic.html?take='+vocals[0].slug,{waitUntil:'networkidle'});
    await page.goto(BASE+'/audio/?take='+vocals[0].slug,{waitUntil:'networkidle'});
    assert.equal(await page.locator('#considerList .card').count(),1);
    await page.click('#clearOnly');
    assert(await page.locator('#considerList .card').count()>100);
    const matched=vocals.find(s=>s.versions[0].lyricStem);
    await page.goto(BASE+'/audio/?lyrics='+encodeURIComponent(matched.versions[0].lyricStem),{waitUntil:'networkidle'});
    const n=await page.locator('#considerList .card').count();
    assert(n>=1&&n<vocals.length);
    checked('Links from Lyric Board and old Audio Board URLs open just the right takes');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
