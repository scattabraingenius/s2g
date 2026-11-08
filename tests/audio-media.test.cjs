const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const BASE=process.env.APP_BASE_URL,ROOT=path.resolve(__dirname,'..');
const original=fs.readFileSync(path.join(ROOT,'audio/tracks.js'),'utf8');
const data={window:{}};vm.runInNewContext(original,data);
assert(data.window.ALBUM_SONGS.every(s=>s.versions[0].audioUrl===null),'Current encoded Suno streams must not become broken players');
const song=data.window.ALBUM_SONGS.find(s=>s.title==='Dearly Beloved.C2.1');
const audioURL=BASE+'/test-plain-audio.wav';song.versions[0].audioUrl=audioURL;
let catalogue='window.BOARD_KIND="audio";\n';for(const key of ['ALBUM_BUILT','ALBUM_SESSIONS','ALBUM_SONGS'])catalogue+='window.'+key+'='+JSON.stringify(data.window[key])+';\n';
const wav=Buffer.alloc(44+16000*2*10);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE});
 try{
  const context=await browser.newContext();
  await context.route('**/*',route=>{
   const url=route.request().url();
   if(url===audioURL)return route.fulfill({contentType:'audio/wav',body:wav});
   if(url.endsWith('/audio/tracks.js'))return route.fulfill({contentType:'application/javascript',body:catalogue});
   return new URL(url).origin===new URL(BASE).origin?route.continue():route.abort();
  });
  const page=await context.newPage();await page.goto(BASE+'/audio/classic.html',{waitUntil:'networkidle'});
  await page.locator(`.row[data-slug="${song.slug}"]`).click();
  await page.locator('audio').evaluate(async audio=>{window.__player=audio;await audio.play();});
  await page.waitForTimeout(200);
  await page.locator('#scoreNum').fill('83');await page.locator('[data-status="maybe"]').click();
  assert(await page.evaluate(()=>document.querySelector('audio')===window.__player));
  assert.equal(await page.locator('audio').evaluate(a=>a.paused),false);
  await page.locator('audio').evaluate(a=>a.pause());
  console.log('PASS Encoded Suno streams stay excluded; a plain-audio fixture plays and continues during rating changes');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
