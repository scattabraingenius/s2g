// Two independent browser contexts against an isolated transactional test backend.
// Firebase SDK network calls and clipboard access are replaced; no real account is used.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const BASE=process.env.APP_BASE_URL;
const ARTIFACTS=process.env.ARTIFACT_DIR || path.resolve(__dirname,'../../album-sync-verification');
const fakeSDK=String.raw`
(() => {
 const listeners=new Map(), authListeners=[];
 let user=window.__initialUser || null, online=true;
 const snap=value=>({val:()=>structuredClone(value)});
 const auth={currentUser:user,
  setPersistence:()=>Promise.resolve(),
  onAuthStateChanged(fn){authListeners.push(fn);queueMicrotask(()=>fn(user));return()=>authListeners.splice(authListeners.indexOf(fn),1);},
  signInWithPopup:async()=>{if(window.__popupBlocked)throw Object.assign(Error('blocked'),{code:'auth/popup-blocked'});window.__fake.setUser({uid:'test-owner',email:'owner@example.test'});},
  signInWithRedirect:async()=>{window.__redirectUsed=true;window.__fake.setUser({uid:'test-owner',email:'owner@example.test'});},
  signOut:async()=>window.__fake.setUser(null)
 };
 function ref(target){return {target,
  on(event,fn,cancel){
   listeners.set(target,[...(listeners.get(target)||[]),fn]);
   if(target==='.info/connected'){queueMicrotask(()=>fn(snap(online)));return;}
   if(window.__denyRead){queueMicrotask(()=>cancel({code:'PERMISSION_DENIED'}));return;}
   if(online)window.__backendRead(target).then(result=>{if(listeners.get(target)?.includes(fn))fn(snap(result.value));});
  },
  off(){listeners.delete(target);},
  async transaction(update,unused,fireLocalEvents){
   if(fireLocalEvents!==false)throw Error('Optimistic transaction events must be disabled');
   if(window.__denyWrite)throw {code:'PERMISSION_DENIED'};
   if(!online)throw Error('offline');
   for(let i=0;i<30;i++){
    const current=await window.__backendRead(target), next=update(current.value);
    const result=await window.__backendCommit(target,current.version,next);
    if(result.committed)return {committed:true,snapshot:snap(result.value)};
   }
   throw Error('Too many retries');
  }
 };}
 window.__fake={
  setUser(next){user=auth.currentUser=next;authListeners.forEach(fn=>fn(next));},
  setOnline(value){online=value;(listeners.get('.info/connected')||[]).forEach(fn=>fn(snap(value)));if(value)for(const target of listeners.keys())if(target!=='.info/connected')window.__backendRead(target).then(result=>window.__fake.deliver(target,result.value));},
  deliver(target,value){if(online)(listeners.get(target)||[]).forEach(fn=>fn(snap(value)));}
 };
 function authFactory(){return auth;}
 authFactory.GoogleAuthProvider=function(){};
 authFactory.Auth={Persistence:{LOCAL:'local'}};
 window.firebase={apps:[],initializeApp(config){this.apps.push({config});},auth:authFactory,database:()=>({ref})};
})();`;
const checks=[];
function checked(text){checks.push(text);console.log('PASS '+text);}
const wait=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Timed out waiting for sync');};
(async()=>{
 fs.mkdirSync(ARTIFACTS,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const server=new Map(), versions=new Map(), pages=[], errors=[], writes=[];
 const sentinel={tasks:[{id:'untouched'}],otherGrindSettings:{wakingHours:16}};
 server.set('planners/the-grind-scattabrain-2026',structuredClone(sentinel));
 try {
  async function client(seed,user={uid:'test-owner',email:'owner@example.test'},denyRead=false,viewport={width:1440,height:1000}){
   const context=await browser.newContext({viewport});
   await context.route('**/*',route=>{
    const url=route.request().url();
    if(url.includes('firebase-app-compat.js'))return route.fulfill({contentType:'application/javascript',body:fakeSDK});
    if(url.startsWith('https://www.gstatic.com/firebasejs/'))return route.fulfill({contentType:'application/javascript',body:''});
    return new URL(url).origin===new URL(BASE).origin?route.continue():route.abort();
   });
   await context.exposeBinding('__backendRead',(_,target)=>({version:versions.get(target)||0,value:structuredClone(server.get(target)??null)}));
   await context.exposeBinding('__backendCommit',(_,target,version,value)=>{
    assert.match(target,/^planners\/the-grind-scattabrain-2026\/album\/accounts\//);
    if((versions.get(target)||0)!==version)return {committed:false};
    server.set(target,structuredClone(value));versions.set(target,version+1);writes.push(target);
    setTimeout(()=>{for(const page of pages)if(!page.isClosed())page.evaluate(({target,value})=>window.__fake?.deliver(target,value),{target,value}).catch(()=>{});},0);
    return {committed:true,value:structuredClone(value)};
   });
   await context.addInitScript(({seed,user,denyRead})=>{
    window.__initialUser=user;window.__denyRead=denyRead;
    if(seed && !localStorage.getItem('grind.album.v1'))localStorage.setItem('grind.album.v1',JSON.stringify(seed));
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}});
   },{seed,user,denyRead});
   const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
   await page.goto(BASE+'/lyrics/',{waitUntil:'networkidle'});
   return page;
  }
  const phone=await client({v:2,ratings:{'check-out_v01_Cue':{score:86,note:'Already rated on phone',at:100}},tracklist:['check-out'],pick:{},custom:{}},undefined,false,{width:390,height:844});
  await wait(()=>phone.locator('#syncStatus').textContent().then(text=>text.startsWith('Synced')));
  const pc=await client(null);
  await wait(()=>pc.locator('#syncStatus').textContent().then(text=>text.startsWith('Synced')));
  await pc.locator('.row[data-slug="check-out"]').click();
  assert.equal(await pc.locator('#scoreNum').inputValue(),'86');assert.equal(await pc.locator('#note').inputValue(),'Already rated on phone');
  assert.equal(await pc.locator('#albumToggle').textContent(),'Remove from album');
  assert(await phone.evaluate(()=>!!localStorage.getItem('grind.album.v1.before-cloud-sync')));
  checked('An empty PC receives existing phone ratings, notes and tracklist; the original device backup is retained');
  await phone.locator('.row[data-slug="check-out"]').click();
  await phone.locator('#scoreNum').fill('92');
  await pc.locator('#note').fill('Added on PC while phone changes score');
  await pc.locator('#note').blur();await phone.locator('#scoreNum').blur();
  await wait(()=>pc.locator('#scoreNum').inputValue().then(value=>value==='92'));
  await wait(()=>phone.locator('#note').inputValue().then(value=>value==='Added on PC while phone changes score'));
  checked('Simultaneous phone score and PC note edits both reach the other device');
  await phone.evaluate(()=>window.__fake.setOnline(false));
  await phone.locator('#scoreNum').fill('94');await phone.locator('#scoreNum').blur();
  assert.match(await phone.locator('#syncStatus').textContent(),/Offline/);
  const pending=await phone.evaluate(()=>JSON.parse(localStorage.getItem('grind.album.v1')));
  assert.equal(pending.ratings['check-out_v01_Cue'].score,94);
  await pc.locator('.row[data-slug="a-to-z"]').click();await pc.locator('#scoreNum').fill('81');await pc.locator('#scoreNum').blur();
  await wait(()=>pc.locator('#syncStatus').textContent().then(text=>text.startsWith('Synced')));
  await phone.reload({waitUntil:'networkidle'});
  await wait(()=>phone.locator('#syncStatus').textContent().then(text=>text.startsWith('Synced')));
  await pc.locator('.row[data-slug="check-out"]').click();
  await wait(()=>pc.locator('#scoreNum').inputValue().then(value=>value==='94'));
  await phone.locator('.row[data-slug="a-to-z"]').click();assert.equal(await phone.locator('#scoreNum').inputValue(),'81');
  checked('Offline phone edits survive reload and merge with changes made on the PC');
  await pc.locator('#scoreNum').fill('');await pc.locator('#scoreNum').blur();
  await phone.locator('.row[data-slug="check-out"]').click();
  await wait(()=>phone.locator('#scoreNum').inputValue().then(value=>value===''));
  checked('Clearing a rating propagates instead of restoring an old score');
  await pc.locator('#copyEdit').click();await pc.locator('#edStyle').fill('Private synced style');await pc.locator('#edStyle').blur();
  await wait(()=>phone.locator('#detail [data-ver^="mine-"]').count().then(count=>count===1));
  const stem=await pc.locator('#detail [data-ver^="mine-"]').getAttribute('data-ver');
  await phone.locator(`[data-ver="${stem}"]`).click();assert.equal(await phone.locator('#edStyle').inputValue(),'Private synced style');
  pc.once('dialog',dialog=>dialog.accept());await pc.locator('#delMine').click();
  await wait(()=>phone.locator('#detail [data-ver^="mine-"]').count().then(count=>count===0));
  checked('Editable copies sync; deleting a copy removes it from the other device');
  await pc.locator('#albumToggle').click();
  await wait(()=>phone.locator('#albumToggle').textContent().then(text=>text==='+ Add to album'));
  checked('Tracklist removals sync without being resurrected by the phone');
  await pc.evaluate(()=>window.__denyWrite=true);
  await pc.locator('#scoreNum').fill('77');await pc.locator('#scoreNum').blur();
  await wait(()=>pc.locator('#syncStatus').textContent().then(text=>text.includes('not authorized')));
  assert.equal((await pc.evaluate(()=>JSON.parse(localStorage.getItem('grind.album.v1')))).ratings['check-out_v01_Cue'].score,77);
  await pc.evaluate(()=>window.__denyWrite=false);await pc.locator('#retrySyncBtn').click();
  await wait(()=>phone.locator('#scoreNum').inputValue().then(value=>value==='77'));
  checked('A denied write reports failure, preserves local changes and succeeds after retry');
  await phone.getByRole('button',{name:'Oct 10 Cue Battle 01',exact:true}).click();
  await phone.locator('.row[data-slug="missing-person"]').click();await phone.locator('#scoreNum').fill('35');await phone.locator('#scoreNum').blur();
  await wait(()=>phone.locator('#syncStatus').textContent().then(text=>text.startsWith('Synced')));
  assert.equal(await phone.locator('#sessionChips [aria-pressed=true]').getAttribute('data-scope'),'session:Oct 10 Cue Battle 01');
  assert.equal(await phone.locator('#list .row').count(),7);
  checked('Source session scope stays selected after the cloud acknowledges a rating');
  await phone.getByRole('button',{name:'All',exact:true}).click();
  await phone.locator('#newSession').click();await phone.locator('#sessionName').fill('Synced album');
  await phone.locator('#sessionSearch').fill('Check Out');await phone.locator('#sessionVersionOptions [data-member="check-out_v01_Cue"]').check();
  await phone.getByRole('button',{name:'Save session',exact:true}).click();
  const albumScope=await phone.locator('#sessionChips [aria-pressed=true]').getAttribute('data-scope');
  await wait(()=>pc.getByRole('button',{name:'Synced album',exact:true}).count().then(count=>count===1));
  await pc.getByRole('button',{name:'Synced album',exact:true}).click();assert.equal(await pc.locator('#list .row').count(),1);
  await pc.locator('.row[data-slug="check-out"]').click();await pc.locator('#scoreNum').fill('83');await pc.locator('#scoreNum').blur();
  await phone.locator('.row[data-slug="check-out"]').click();
  await wait(()=>phone.locator('#scoreNum').inputValue().then(value=>value==='83'));
  assert.equal(await pc.locator('#sessionChips [aria-pressed=true]').getAttribute('data-scope'),albumScope);
  assert.equal(await phone.locator('#sessionChips [aria-pressed=true]').getAttribute('data-scope'),albumScope);
  await pc.locator('#manageSession').click();await pc.locator('#sessionName').fill('Synced album renamed');
  await pc.locator('#sessionSearch').fill('A to Z');await pc.locator('#sessionVersionOptions [data-member="a-to-z_v01_Cue"]').check();
  await pc.getByRole('button',{name:'Save session',exact:true}).click();
  await wait(()=>phone.locator('#list .row').count().then(count=>count===2));
  assert.equal(await phone.locator('#sessionChips [aria-pressed=true]').textContent(),'Synced album renamed');
  await pc.locator('#manageSession').click();pc.once('dialog',dialog=>dialog.accept());await pc.locator('#deleteSession').click();
  await wait(()=>phone.getByRole('button',{name:'Synced album renamed',exact:true}).count().then(count=>count===0));
  assert.equal(await phone.locator('#scoreNum').inputValue(),'83');
  checked('Custom sessions, names and individual version memberships sync without resetting an active workspace; deletion keeps ratings');
  const originalWrites=writes.length;
  const denied=await client({v:2,ratings:{'check-out_v01_Cue':{score:44}},tracklist:[],custom:{},pick:{}},{uid:'denied-user',email:'denied@example.test'},true);
  await wait(()=>denied.locator('#syncStatus').textContent().then(text=>text.includes('not authorized')));
  assert.equal(writes.length,originalWrites);assert.equal(await denied.evaluate(()=>JSON.parse(localStorage.getItem('grind.album.v1')).ratings['check-out_v01_Cue'].score),44);
  checked('A denied cloud read never seeds or overwrites the cloud');
  await pc.locator('#signOutBtn').click();
  await wait(()=>pc.locator('#signInBtn').isVisible());
  await pc.locator('#scoreNum').fill('79');await pc.locator('#scoreNum').blur();
  await pc.evaluate(()=>window.__fake.setUser({uid:'second-owner',email:'second@example.test'}));
  await wait(()=>pc.locator('#syncStatus').textContent().then(text=>text.startsWith('Synced')));
  await pc.locator('.row[data-slug="check-out"]').click();assert.equal(await pc.locator('#scoreNum').inputValue(),'');
  assert(!server.has('planners/the-grind-scattabrain-2026/album/accounts/second-owner'));
  await pc.evaluate(()=>window.__fake.setUser({uid:'test-owner',email:'owner@example.test'}));
  await wait(()=>pc.locator('#syncStatus').textContent().then(text=>text.startsWith('Synced')));
  await pc.locator('.row[data-slug="check-out"]').click();assert.equal(await pc.locator('#scoreNum').inputValue(),'79');
  checked('Signing out keeps offline edits; switching accounts does not upload the first account’s data');
  const signedOut=await client(null,null);
  await wait(()=>signedOut.locator('#signInBtn').isVisible());
  await signedOut.evaluate(()=>window.__popupBlocked=true);await signedOut.locator('#signInBtn').click();
  await wait(()=>signedOut.evaluate(()=>window.__redirectUsed===true));
  await wait(()=>signedOut.locator('#syncStatus').textContent().then(text=>text.startsWith('Synced')));
  checked('Blocked Google popup falls back to redirect sign-in');
  assert.deepEqual(server.get('planners/the-grind-scattabrain-2026'),sentinel);
  assert.deepEqual(errors,[]);
  await phone.locator('#detailBack').click();
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await phone.locator('#syncStatus').scrollIntoViewIfNeeded();
  await phone.screenshot({path:path.join(ARTIFACTS,'synced-phone.png'),fullPage:false});
  await pc.locator('#syncStatus').scrollIntoViewIfNeeded();
  await pc.screenshot({path:path.join(ARTIFACTS,'synced-desktop.png'),fullPage:false});
  checked('Planner data stays untouched, mobile layout fits, and neither browser reports script errors');
  fs.mkdirSync(ARTIFACTS,{recursive:true});
  fs.writeFileSync(path.join(ARTIFACTS,'sync-browser-results.json'),JSON.stringify({checks,errors,backend:'isolated fake transactional backend',writes:writes.length},null,2));
 } finally {await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
