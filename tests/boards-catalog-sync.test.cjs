// Catalog reconciliation and browser-state preservation. Uses an isolated browser
// and the local catalog companion. No real sign-in, cloud write, or Suno request.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {chromium} = require('playwright');
const {createBackend, browserPath} = require('./helpers/fake-firebase.cjs');
const Sync = require('../lyrics/sync.js'), Planner = require('../audio/album/planner-sync.js');
const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.APP_BASE_URL;
const PRIVATE = process.env.SYNC_PRIVATE_DIR;
const CATALOG = process.env.CATALOG_DIR;
assert(BASE && PRIVATE && CATALOG, 'Provide the local companion URL and private validation folders.');
function load(file) { const ctx = {window:{}}; vm.runInNewContext(fs.readFileSync(file, 'utf8'), ctx); return JSON.parse(JSON.stringify(ctx.window)); }
const lyricData = load(path.join(ROOT, 'lyrics/songs.js'));
const songs = lyricData.ALBUM_SONGS;
const audio = load(path.join(ROOT, 'audio/tracks.js')).ALBUM_SONGS;
const baseline = load(path.join(PRIVATE, 'before/lyrics/songs.js')).ALBUM_SONGS;
const oldAudio = load(path.join(PRIVATE, 'before/audio/tracks.js')).ALBUM_SONGS;
const catalog = JSON.parse(fs.readFileSync(path.join(CATALOG, 'data/catalog.json'), 'utf8'));
const active = catalog.clips.filter(c => c.trashed === false);
const ids = new Set(audio.map(s => s.slug)), oldIds = new Set(oldAudio.map(s => s.slug));
const versions = Object.fromEntries(songs.flatMap(s => s.versions).map(v => [v.stem, v]));
const report = JSON.parse(fs.readFileSync(path.join(PRIVATE, 'report.json'), 'utf8'));
const pass = message => console.log('PASS ' + message);
assert.deepEqual([...ids].sort(), active.map(c => c.id).sort());
assert.equal(ids.size, audio.length);
assert([...oldIds].every(id=>ids.has(id)), 'No original Audio Board take is removed');
for (const song of baseline) for (const v of song.versions) {
  assert(versions[v.stem], 'Legacy lyric ID retained');
  assert.equal(versions[v.stem].lyrics, v.lyrics, 'Legacy lyric text retained');
  assert.equal(versions[v.stem].writer, v.writer);
  assert.equal(versions[v.stem].version, v.version);
}
for (const song of audio) {
  const v = song.versions[0], lyric = versions[v.lyricStem];
  if (!v.lyricStem) { assert.equal(v.lyricSlug,null); continue; }
  assert(lyric, song.title + ' has a known lyric version');
  assert.equal(String(lyric.version), String(v.packetVersion));
  assert.equal(lyric.writer, v.writer);
  assert.equal((lyric.suno?.lyrics ?? lyric.lyrics).normalize('NFKC').split(/\s+/).filter(Boolean).join(' '), v.lyrics.normalize('NFKC').split(/\s+/).filter(Boolean).join(' '));
}
for (const v of Object.values(versions)) {
  assert(!('contentHash' in v || 'sourceLocations' in v || 'studioSource' in v));
  assert(!/[\\/]/.test(v.source || ''), 'Public provenance uses a filename');
}
for (const slug of ['the-words-left-unsaid','the-uneven-scale','three-asks','edge-on','one-of-one']) {
  const song = songs.find(s => s.slug === slug), current = versions[song.latest];
  assert.equal(current.version, 2);
  assert.equal((lyricData.LYRIC_REVIEW_TAKES[current.stem] || []).length, 0);
}
pass('Catalog counts, all legacy lyric IDs/text, public fields, and exact lyric-version audio links');

const retained = audio.filter(s => oldIds.has(s.slug) && s.versions[0].lyricStem).slice(0, 4).map(s => s.slug);
assert.equal(retained.length, 4);
const removed = '00000000-0000-4000-8000-000000000099';
assert(!ids.has(removed), 'Unavailable-take fixture is separate from real takes');
const added = audio.find(s => !oldIds.has(s.slug)).slug;
const empty = () => ({v:2, ratings:{}, tracklist:[], pick:{}, custom:{}, collections:{}});
const audioSeed = empty();
for (let i=0; i<retained.length; i++) audioSeed.ratings[retained[i]] = {score:[0,86,100,41][i], status:['short','maybe','cut','short'][i], note:'Synthetic saved take '+i, at:100};
audioSeed.ratings[removed] = {score:73, status:'short', note:'Preserve unavailable take record', at:100};
audioSeed.tracklist = [retained[0], removed];
audioSeed.collections.saved = {name:'Saved listening session', created:100, members:[retained[0],retained[1],removed]};
const lyricSeed = empty(), savedLyric = audio.find(s => s.slug === retained[0]).versions[0].lyricStem;
const lyricSong = songs.find(s => s.versions.some(v => v.stem === savedLyric));
lyricSeed.ratings[savedLyric] = {score:94, status:'short', note:'Synthetic lyric note', at:100};
lyricSeed.tracklist = [lyricSong.slug];
lyricSeed.pick[lyricSong.slug] = savedLyric;
lyricSeed.collections.saved = {name:'Saved lyric session', created:100, members:[savedLyric]};
lyricSeed.custom[lyricSong.slug] = [{...versions[savedLyric], stem:'synthetic-copy', custom:true, copiedFrom:savedLyric, label:'Saved copy'}];
const planSeed = {
  considered:Object.fromEntries([...retained,removed].map((id,i) => [id,{added:100+i,...(i===1?{marks:{debut:'short'}}:{}),...(i===2?{marks:{debut:'maybe'}}:{})}])),
  sessions:{saved:{name:'Saved planner session', created:100, members:[retained[0],retained[1],removed], note:'Synthetic session note'}},
  albums:{debut:{name:'Saved album', created:1, order:[retained[0],removed], cut:[retained[3]], target:12, statusV:2}}
};
function content(s) { const {_sync, ...value} = s; return value; }

(async () => {
  const out = path.join(PRIVATE, 'browser'); fs.mkdirSync(out, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:browserPath()});
  const errors = [];
  try {
    const context = await browser.newContext({viewport:{width:1440,height:1000}, serviceWorkers:'block'});
    await createBackend().install(context, {user:null});
    await context.addInitScript(seeds => {
      if (localStorage.getItem('catalog-sync-seeded')) return;
      for (const [key,value] of Object.entries(seeds)) localStorage.setItem(key,JSON.stringify(value));
      localStorage.setItem('catalog-sync-seeded','1');
    }, {'grind.album.v1':Sync.prepare(lyricSeed),'grind.audio.v1':Sync.prepare(audioSeed),'grind.planner.v1':Planner.prepare(planSeed)});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if(m.type()==='error') errors.push(m.text()); });
    await page.goto(BASE+'/lyrics/', {waitUntil:'networkidle'});
    await page.locator('.row[data-slug="the-voice-that-is-not-me"] .t').click();
    assert.match(await page.locator('#detail').getAttribute('data-stem'), /the-voice-that-is-not-me_v02_Cue$/);
    assert.match(await page.locator('#summary').textContent(), new RegExp('^'+songs.length+' songs'));
    const voice = songs.find(s => s.slug==='the-voice-that-is-not-me');
    assert.equal(await page.locator('#reviewLyrics').textContent(), versions[voice.latest].suno.lyrics ?? versions[voice.latest].lyrics);
    await page.goto(BASE+'/lyrics/', {waitUntil:'networkidle'});
    await page.locator('.row[data-slug="clear"] .t').click();
    assert.equal(await page.locator('#detail').getAttribute('data-stem'), 'clear_v01b_Cue');
    for(const slug of ['the-voice-that-is-not-me-alternate','the-uneven-scale-alternate','edge-on-alternate']) {
      const s=songs.find(x=>x.slug===slug); assert(s);
      await page.goto(BASE+'/lyrics/', {waitUntil:'networkidle'});
      await page.locator(`.row[data-slug="${slug}"] .t`).click();
      assert.equal(await page.locator('#detail').getAttribute('data-stem'),s.latest);
    }
    await page.goto(BASE+'/audio/classic.html?take='+retained[0], {waitUntil:'networkidle'});
    assert.equal(await page.locator('#scoreNum').inputValue(),'0');
    assert.equal(await page.locator('#scoreNum').getAttribute('max'),'100');
    await page.goto(BASE+'/audio/classic.html?take='+retained[1], {waitUntil:'networkidle'});
    assert.equal(await page.locator('#scoreNum').inputValue(),'86');
    await page.goto(BASE+'/audio/classic.html?take='+retained[2], {waitUntil:'networkidle'});
    assert.equal(await page.locator('#scoreNum').inputValue(),'100');
    await page.goto(BASE+'/audio/album/?scope=all&view=sort', {waitUntil:'networkidle'});
    await page.selectOption('#sortType','all');
    const state = await page.evaluate(() => ({lyric:JSON.parse(localStorage.getItem('grind.album.v1')), audio:JSON.parse(localStorage.getItem('grind.audio.v1')), plan:JSON.parse(localStorage.getItem('grind.planner.v1'))}));
    assert.deepEqual(content(state.lyric),lyricSeed);
    assert.deepEqual(content(state.audio),audioSeed);
    assert.deepEqual(content(state.plan),planSeed);
    assert.equal(await page.evaluate(id=>statusOf(id),added),'unreviewed');
    assert.equal(await page.evaluate(id=>audio.ratings[id]?.score??null,added),null);
    assert.equal(await page.locator(`[data-stem="${removed}"]`).count(),0);
    assert.equal(await page.locator(`[data-stem="${added}"] .score-in`).inputValue(),'');
    await page.click('#tabSessions'); await page.click('[data-session="saved"]');
    assert.equal(await page.locator(`#sessionDetail [data-stem="${removed}"]`).count(),0);
    assert(await page.locator('#sessionName').isVisible());
    await page.click('#tabAlbums');
    assert.equal(await page.locator(`#albumTracks [data-stem="${removed}"]`).count(),0);
    assert.equal(await page.locator(`#albumTracks [data-stem="${retained[0]}"] .score-in`).inputValue(),'0');
    await page.reload({waitUntil:'networkidle'});
    const preserved = await page.evaluate(() => JSON.parse(localStorage.getItem('grind.planner.v1')));
    assert.deepEqual(content(preserved),planSeed);
    pass('Saved 0/86/100 scores, statuses, copied lyrics, sessions and album order survive both boards and reload; unavailable records stay stored and off screen');
    await page.screenshot({path:path.join(out,'saved-album.png')});

    const fresh = await browser.newContext({viewport:{width:1440,height:1000}, serviceWorkers:'block'});
    await createBackend().install(fresh,{user:null});
    const clean = await fresh.newPage();
    clean.on('pageerror', e=>errors.push(e.message));
    clean.on('console', m=>{if(m.type()==='error')errors.push(m.text());});
    await clean.goto(BASE+'/audio/album/?scope=all&view=sort', {waitUntil:'networkidle'});
    await clean.selectOption('#sortType','all');
    assert.equal(await clean.locator('#sortList .card').count(),active.length);
    assert.equal(await clean.locator('#countSort').textContent(),'('+active.length+')');
    assert.equal(await clean.locator('#countConsider').textContent(),'(0)');
    assert.match(await clean.locator('#summary').textContent(),new RegExp('^'+active.length+' unreviewed'));
    assert((await clean.locator('#sortList .score-in').evaluateAll(els=>els.map(e=>e.value))).every(v=>v===''));
    assert((await clean.evaluate(()=>Object.keys(TAKES).map(id=>statusOf(id)))).every(s=>s==='unreviewed'));
    await clean.screenshot({path:path.join(out,'audio-sort.png')});
    await clean.goto(BASE+'/lyrics/', {waitUntil:'networkidle'});
    await clean.locator('.row[data-slug="the-voice-that-is-not-me"] .t').click();
    await clean.screenshot({path:path.join(out,'voice-v02.png')});
    await clean.setViewportSize({width:390,height:844});
    assert(await clean.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await clean.screenshot({path:path.join(out,'voice-v02-phone.png')});
    assert.deepEqual(errors,[]);
    pass('Fresh boards show all '+songs.length+' songs and '+active.length+' unreviewed, unscored takes; desktop and phone load without console errors');
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({lyricSongs:songs.length,lyricVersions:Object.keys(versions).length,audioTakes:active.length,consoleErrors:errors,preservation:'synthetic state using retained and removed production IDs'},null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
