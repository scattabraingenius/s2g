const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const BASE=process.env.APP_BASE_URL;
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
  try {
    const context=await browser.newContext();
    await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(BASE).origin?route.continue():route.abort());
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(BASE+'/audio/classic.html',{waitUntil:'networkidle'});
    // The live catalogue may have only one surviving take of a formerly used
    // example. Select a current pair with source disclosures for this UI test.
    const song = await page.evaluate(() => {
      const groups = new Map();
      for (const s of SONGS.filter(s => s.session === 'Vocals')) {
        if (!groups.has(s.baseTitle)) groups.set(s.baseTitle, []);
        groups.get(s.baseTitle).push(s);
      }
      return [...groups].find(([, rows]) => rows.length >= 2 && rows.every(s => s.versions[0].source))?.[0];
    });
    assert(song, 'Need two current vocal takes with source disclosures');
    await page.locator('#songFilter').selectOption(song);
    const rows=page.locator('#list .row');
    await rows.first().click();
    const panel=page.locator('[data-panel="audio-fields"]');
    assert.equal(await panel.evaluate(el=>el.open),true,'Lyrics must open by default');
    await panel.locator('summary').click();
    assert.equal(await panel.evaluate(el=>el.open),false);
    await page.locator('#note').focus();
    // Exercise the same deferred repaint as a cloud acknowledgment while editing notes.
    await page.evaluate(()=>replaceSyncedState(structuredClone(state)));
    assert.equal(await page.evaluate(()=>pendingRemoteDetail),true);
    await panel.locator('summary').click();
    await page.locator('#note').evaluate(el=>el.blur());
    // A summary may receive focus before its click/default toggle finishes in Firefox/Zen.
    // Release focus only after the toggle, so a pending repaint cannot replace its click target.
    await page.locator('#q').focus();
    await page.waitForFunction(()=>!pendingRemoteDetail);
    assert.equal(await panel.evaluate(el=>el.open),true,'Deferred focusout repaint must not undo opening');
    const source=page.locator('[data-panel="sbglp-source"]');
    await source.locator('summary').click();
    await page.locator('[data-status="short"]').click();
    assert.equal(await panel.evaluate(el=>el.open),true,'Status repaint keeps lyrics open');
    assert.equal(await source.evaluate(el=>el.open),true,'Source disclosure also survives repaint');
    await panel.locator('summary').click();
    await page.evaluate(()=>replaceSyncedState(structuredClone(state)));
    assert.equal(await panel.evaluate(el=>el.open),false,'A deliberately closed section stays closed');
    await rows.nth(1).click();
    assert.equal(await panel.evaluate(el=>el.open),true,'A different take starts expanded');
    assert.equal(await source.evaluate(el=>el.open),false,'Other disclosure choices are local to the selected take');
    assert.deepEqual(errors,[]);
    console.log('PASS Expanded-by-default lyrics and deliberate toggles survive deferred focusout, sync and status repaints');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
