const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const BASE=process.env.APP_BASE_URL;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 try{
  const context=await browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(BASE).origin?route.continue():route.abort());
  const page=await context.newPage(),ids=[];
  const cases=[['/','/'],['/lyrics/','/s2g/lyrics/'],['/audio/','/s2g/audio/']];
  for(const [pagePath,expectedId] of cases){
   await page.goto(BASE+pagePath,{waitUntil:'networkidle'});
   const cdp=await context.newCDPSession(page),app=await cdp.send('Page.getAppManifest');
   assert.equal(app.errors.length,0);
   assert(app.manifest,'Chrome must expose the processed manifest, not only its JSON');
   assert.equal(new URL(app.manifest.id).pathname,expectedId);
   if(pagePath!=='/'){
    assert.equal(new URL(app.manifest.startUrl).pathname,pagePath);
    assert.equal(new URL(app.manifest.scope).pathname,pagePath);
    assert.equal((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.filter(e=>e.errorId!=='in-incognito').length,0);
   }
   ids.push(app.manifest.id);
   console.log('PASS Chrome computed app ID: '+app.manifest.id);
  }
  assert.equal(new Set(ids).size,3,'The Grind, Lyric Board and Audio Board must not share an installation identity');
  assert.equal(new URL('./',new URL(BASE).origin).pathname,'/','Regression: ./ is relative to the origin, not the manifest folder');
  console.log('PASS Three distinct Chrome identities; board start URLs, scopes and installability remain intact');
 }finally{await browser.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
