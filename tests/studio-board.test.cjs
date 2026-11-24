// Studio Board: the song model, the song-decision store, and compatibility of everything the Studio Board writes
// with the older boards' validators.  Pure Node, no browser:  node tests/studio-board.test.cjs
const assert = require('node:assert/strict');
globalThis.AlbumSync = require('../lyrics/sync.js');
globalThis.PlannerSync = require('../audio/album/planner-sync.js');
globalThis.StudioSync = require('../studio/studio-sync.js');
const Model = require('../studio/model.js');
const Stores = require('../studio/stores.js');
const pass = m => console.log('PASS ' + m);

const T1 = '11111111-1111-4111-8111-111111111111', T2 = '22222222-2222-4222-8222-222222222222', T3 = '33333333-3333-4333-8333-333333333333';
const V2 = '2026-10-Cue-Rewrites/dearly-beloved_v02_Cue';
const lyricSongs = [{slug:'dearly-beloved', title:'Dearly Beloved', versions:[
  {stem:V2, version:2, writer:'Cue', session:'Oct Cue Rewrites', title:'Dearly Beloved', lyrics:'[Hook]\nDearly beloved', suno:{title:'Dearly Beloved', lyrics:null, style:'boom-bap', exclude:''}},
  {stem:'studio/01 Songs/00 Scatta Anchors/Dearly Beloved Cue.md', version:0, writer:'Cue', session:'Library', versionLabel:'Dearly Beloved Cue', title:'Dearly Beloved', lyrics:'x', suno:{}},
]}];
const take = (id, title, extra) => ({slug:id, title, baseTitle:'Dearly Beloved', versions:[{stem:id, title, writer:'Cue', type:'Vocal', lyrics:'[Hook]\nDearly beloved', createdAt:'2026-10-11T00:00:00Z', duration:200, ...extra}]});
const takeSongs = [take(T1, 'Dearly Beloved.C2.1', {lyricSlug:'dearly-beloved', lyricStem:V2}), take(T2, 'Dearly Beloved.iC2.1', {lyrics:'[Instrumental]', lyricSlug:'dearly-beloved', lyricStem:V2})];
const studio = {songs:[{key:'dearlybeloved', title:'Dearly Beloved', lyrics:['dearly-beloved'], cat:{writers:['Cue'], updated:'2026-10-30'}, bases:['Dearly Beloved'], location:'both', prompt:false, newTakes:1, trashedTakes:0}],
  takeSong:{[T1]:'dearlybeloved', [T2]:'dearlybeloved'}, clips:[{id:T3, title:'Dearly Beloved v3_cue', song:'dearlybeloved', onBoard:false, trashed:false}]};

// ---- model ----
const M = Model.create({lyricSongs, takeSongs, studio});
const s = M.bySong.dearlybeloved;
assert.deepEqual(s.takeIds.sort(), [T1, T2].sort());
assert.equal(M.takes[T2].type, 'Instrumental', 'a "Vocal" take with no sung words counts as instrumental');
assert.deepEqual(M.takesForVersion(s, V2).sort(), [T1, T2].sort());
assert.equal(M.newClips(s).length, 1);
assert.equal(M.versionsOf(s, {'dearly-beloved':[{stem:'mine-x', label:'My copy 1'}]}).length, 3, 'custom copies join the song');
assert.equal(M.shortVersionLabel(lyricSongs[0].versions[0], s.title), 'v02 Cue');
assert.equal(M.shortVersionLabel({...lyricSongs[0].versions[1], slug:'dearly-beloved'}, s.title), 'Anchor Cue');
pass('model joins lyric versions, board takes and newer Suno clips into one song');

// ---- song-decision store ----
const S = StudioSync;
const a = S.capture(S.prepare(S.empty()), {songs:{dearlybeloved:{status:'complete', chosen:T1, next:'master it', junk:'x'}}, pick:{'dearly-beloved':V2}}, 'phone', 100);
assert.deepEqual(S.project(a._sync.records, 'u').songs.dearlybeloved, {status:'complete', chosen:T1, next:'master it'}, 'unknown fields are dropped');
const b = S.capture(a, {songs:{dearlybeloved:{status:'incomplete', chosen:T1, next:'master it'}}, pick:{}}, 'pc', 200);
const merged = S.project(S.merge(a._sync.records, b._sync.records), 'u');
assert.equal(merged.songs.dearlybeloved.status, 'incomplete'); assert.deepEqual(merged.pick, {}, 'deletions travel as tombstones');
assert.throws(() => S.recordsOf({v:1, records:{x:{kind:'rating', id:'a', rev:[1, 'd'], data:'1'}}}), /Invalid/);
assert.doesNotThrow(() => S.recordsOf({v:1, records:b._sync.records}));
pass('song decisions merge last-writer-wins with tombstones and validate their own records');

// ---- stores: what the Studio Board writes, and that the older boards accept it ----
function fakeStorage(init = {}) { const data = {...init}; return {data, getItem:k => (k in data ? data[k] : null), setItem:(k, v) => { data[k] = String(v); }, removeItem:k => { delete data[k]; }}; }
const storage = fakeStorage();
const stores = Stores.create({storage, firebase:null, lyricBySlug:M.lyricBySlug, planner:() => null});
stores.setLyric(V2, {status:'revision', tags:['Strong hook'], note:'verse 2 drags'});
stores.setLyric(V2, {'mark:abc-123':{start:0, end:6, quote:'[Hook]', fingerprint:'x', color:'green', comment:''}});
stores.addCustom('dearly-beloved', {stem:'mine-dearly-beloved-1', custom:true, version:0, label:'My copy 1', writer:'Me', lyrics:'new', suno:{lyrics:'new'}, created:1});
stores.updateCustom('dearly-beloved', 'mine-dearly-beloved-1', {lyrics:'newer', savedTo:'01 Songs/Dearly Beloved/Lyrics/Dearly Beloved - Lyrics - v03 - Scatta - 2026-11-09.md'});
stores.setLyric(V2, {'mark:abc-123':null});
assert.ok(stores.undoLyric(), 'lyric review changes undo');
assert.equal(stores.lyric().ratings[V2]['mark:abc-123'].color, 'green', 'undo brings the highlight back');
stores.setSong('dearlybeloved', {status:'complete', chosen:T1});
stores.setPick('dearly-beloved', 'mine-dearly-beloved-1');
const savedLyric = JSON.parse(storage.data['grind.album.v1']);
assert.equal(savedLyric.custom['dearly-beloved'][0].lyrics, 'newer');
assert.doesNotThrow(() => AlbumSync.recordsOf({v:1, records:savedLyric._sync.records}), 'the Lyric Board validator accepts every record the Studio Board writes');
for (const r of Object.values(savedLyric._sync.records)) assert.ok(['rating', 'custom', 'track', 'collection', 'member'].includes(r.kind));
const savedStudio = JSON.parse(storage.data['grind.studio.v1']);
assert.deepEqual(StudioSync.project(savedStudio._sync.records, null).songs.dearlybeloved, {status:'complete', chosen:T1});
assert.equal(storage.data['grind.audio.v1'], undefined, 'take scores are written by the planner, not this store');
pass('lyric edits stay in the Lyric Board format; song decisions go to their own store');

stores.deleteCustom('dearly-beloved', 'mine-dearly-beloved-1');
assert.equal(stores.lyric().custom['dearly-beloved'], undefined);
assert.equal(stores.studio().pick['dearly-beloved'], undefined, 'deleting a copy clears it as the remembered version');
pass('deleting your copy removes it and its pick');

// A signed-in device switching to another account shows that account's cache, never the other account's data.
const owned = AlbumSync.project(AlbumSync.prepare({v:2, ratings:{[V2]:{note:'mine', at:1}}}), AlbumSync.prepare({v:2, ratings:{[V2]:{note:'mine', at:1}}})._sync.records, 'someone-else');
const storage2 = fakeStorage({'grind.album.v1':JSON.stringify(owned)});
let replaced = null;
const stores2 = Stores.create({storage:storage2, firebase:{apps:[1], auth:() => ({onAuthStateChanged:() => {}}), database:() => ({})}, lyricBySlug:M.lyricBySlug, planner:() => null,
  AlbumSync:{...AlbumSync, create:o => { replaced = o; return {changed() {}, retry() {}}; }}, StudioSync:{...StudioSync, create:() => ({changed() {}, retry() {}})}});
stores2.start();
replaced.selectAccount('u1');
assert.equal(Object.keys(stores2.lyric().ratings).length, 0);
assert.ok(storage2.data['grind.album.v1.account.someone-else'], "the other account's data is kept in its own cache");
pass("switching accounts never shows another account's data");

const migrated = Stores.migrateLyric({ratings:{'dearly-beloved':{score:70}}, pick:{}}, M.lyricBySlug);
assert.equal(migrated.ratings['studio/01 Songs/00 Scatta Anchors/Dearly Beloved Cue.md'].score, 70);
pass('old slug-keyed lyric ratings migrate the same way as the Lyric Board');

// ---- Instrumentals, sorting and archived stems: run studio/app.js against the real published data in a stubbed page ----
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const ROOT = path.join(__dirname, '..');
function boot({search = '', prefs = null} = {}) {
  const els = {}, handlers = {};
  const el = id => els[id] || (els[id] = {id, innerHTML:'', textContent:'', value:'', checked:false, hidden:false, dataset:{}, style:{}, placeholder:'', classList:{toggle() {}, add() {}, remove() {}, contains:() => false},
    setAttribute() {}, addEventListener() {}, focus() {}, select() {}, querySelector:() => null, contains:() => false, showModal() {}, close() {}, click() {}});
  const store = {};
  if (prefs) store['grind.studio.v1.view'] = JSON.stringify(prefs);
  const document = {getElementById:el, querySelectorAll:() => [], querySelector:() => null, addEventListener:(t, f) => { (handlers[t] ||= []).push(f); }, body:{dataset:{}, classList:{toggle() {}, add() {}, remove() {}}}, activeElement:null, hidden:false, createElement:() => el('x' + Math.random())};
  const sandbox = {document, console, URLSearchParams, URL, CSS:{escape:x => x}, JSON, Math, Date, Set, Map, Promise, Object, Array, String, Number, setTimeout, clearTimeout, crypto:require('node:crypto').webcrypto,
    navigator:{}, localStorage:{getItem:k => (k in store ? store[k] : null), setItem:(k, v) => { store[k] = String(v); }, removeItem:k => { delete store[k]; }},
    location:{pathname:'/s2g/studio/', search}, history:{state:null, replaceState() {}, pushState() {}}, addEventListener() {}, confirm:() => true,
    getSelection:() => null, requestAnimationFrame:f => f()};
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  sandbox.PlannerApp = {ui:{view:'sort', album:null}, card:id => `<div class="card" data-stem="${id}"></div>`, nameOf:id => id, takeLabel:() => '', toast() {}, show() {}, restore() {}};
  const ctx = vm.createContext(sandbox);
  const load = f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, {filename:f});
  load('lyrics/songs.js'); sandbox.LYRIC_SONGS = sandbox.ALBUM_SONGS;
  load('audio/tracks.js'); sandbox.TAKE_SONGS = sandbox.ALBUM_SONGS;
  for (const f of ['studio/catalog.js', 'lyrics/review-tools.js', 'lyrics/sync.js', 'audio/album/planner-sync.js', 'studio/studio-sync.js', 'studio/model.js', 'studio/stores.js', 'studio/app.js']) load(f);
  return {els, store, ctx, handlers};
}
const keysIn = html => [...String(html).matchAll(/data-song="([^"]+)"/g)].map(m => m[1]);
{
  const probe = boot();
  const data = probe.ctx;
  const MD = Model.create({lyricSongs:data.LYRIC_SONGS, takeSongs:data.TAKE_SONGS, studio:data.STUDIO});
  const instrOf = s => !MD.versionsOf(s, {}).some(v => Model.hasWords(v.lyrics ?? v.suno?.lyrics ?? ''));
  const expSongs = MD.songs.filter(s => !instrOf(s)), expInstr = MD.songs.filter(s => instrOf(s) && !s.prompt), expPrompts = MD.songs.filter(s => s.prompt);
  const titleKey = t => MD.songs.find(s => s.title === t).key;

  // sections
  const defaults = boot();
  assert.equal(defaults.els.countSongs.textContent, expSongs.length, 'Songs count is the songs with sung words');
  assert.equal(defaults.els.countInstr.textContent, expInstr.length, 'Instrumentals count leaves the beat prompts out until they are shown');
  const songKeys = keysIn(defaults.els.songList.innerHTML);
  assert.equal(songKeys.length, expSongs.length);
  assert.ok(songKeys.every(k => !instrOf(MD.bySong[k])), 'an instrumental never appears in Songs');
  for (const t of ['Clouds Beneath the Moon', 'Emberlight Reverie', 'Weightless Until Dawn']) { assert.ok(!songKeys.includes(titleKey(t)), t + ' is not in Songs'); assert.ok(instrOf(MD.bySong[titleKey(t)]), t + ' counts as an instrumental'); }
  assert.equal(expPrompts.length, 18); assert.ok(expPrompts.every(instrOf), 'every beat prompt is an instrumental');
  const instr = boot({search:'?view=instrumentals'});
  const instrKeys = keysIn(instr.els.songList.innerHTML);
  assert.equal(instrKeys.length, expInstr.length);
  assert.ok(instrKeys.includes(titleKey('Clouds Beneath the Moon')) && instrKeys.every(k => instrOf(MD.bySong[k])));
  assert.ok(instrKeys.every(k => !MD.bySong[k].prompt), 'beat prompts stay hidden by default');
  assert.equal(instr.els.fPromptsWrap.hidden, false, 'the beat-prompt switch lives in Instrumentals');
  assert.equal(defaults.els.fPromptsWrap.hidden, true);
  const withPrompts = boot({search:'?view=instrumentals', prefs:{prompts:true}});
  assert.equal(keysIn(withPrompts.els.songList.innerHTML).length, expInstr.length + 18, 'shown beat prompts go in Instrumentals');
  assert.equal(withPrompts.els.countInstr.textContent, expInstr.length + 18);
  assert.equal(boot({prefs:{prompts:true}}).els.countSongs.textContent, expSongs.length, 'beat prompts never join Songs');
  pass(`Songs (${expSongs.length}) and Instrumentals (${expInstr.length} + ${expPrompts.length} beat prompts) are separate lists`);

  // song pages
  const clouds = boot({search:'?song=' + titleKey('Clouds Beneath the Moon')});
  const page = clouds.els.page.innerHTML;
  assert.ok(/prompt-pane/.test(page) && !/lyrics-pane|id="lyricText"|data-edit|data-lyric-status|Chosen lyric/.test(page), 'instrumental page has a prompt panel and no lyric panel');
  assert.ok(/Style and prompt/.test(page) && /Instrumental/.test(page) && /Song status/.test(page) && /Song notes/.test(page) && /class="takes-pane"|takes-pane/.test(page), 'it keeps style/prompt, status, notes and takes');
  assert.ok(/← Instrumentals/.test(page));
  const vocal = boot({search:'?song=' + expSongs[0].key}).els.page.innerHTML;
  assert.ok(/lyrics-pane/.test(vocal) && !/prompt-pane/.test(vocal) && /← Songs/.test(vocal), 'a song with words keeps the lyric panel');
  pass('an instrumental page shows its prompt as a prompt, with no lyric panel; songs keep theirs');

  // sorting
  const order = (section, sorts) => keysIn(boot({search:section === 'songs' ? '' : '?view=instrumentals', prefs:{sorts}}).els.songList.innerHTML);
  const titles = ks => ks.map(k => MD.bySong[k].title);
  const az = titles(order('instrumentals', {instrumentals:{by:'title', dir:'asc'}})), za = titles(order('instrumentals', {instrumentals:{by:'title', dir:'desc'}}));
  assert.deepEqual(az, [...az].sort((a, b) => a.localeCompare(b, undefined, {numeric:true})), 'A to Z');
  assert.deepEqual(za, [...az].reverse(), 'Z to A reverses A to Z');
  const sunoT = s => [...s.takeIds.filter(id => MD.takes[id].type !== 'Stem').map(id => MD.takes[id].createdAt), ...s.clips.map(c => c.created)].filter(Boolean).sort();
  for (const [by, dir, pick] of [['firstTake', 'asc', a => a[0]], ['latestTake', 'desc', a => a[a.length - 1]], ['firstTake', 'desc', a => a[0]]]) {
    const ks = order('songs', {songs:{by, dir}}), vals = ks.map(k => pick(sunoT(MD.bySong[k])));
    const have = vals.filter(Boolean), none = vals.slice(have.length);
    assert.ok(none.every(v => !v) && vals.slice(0, have.length).every(Boolean), `${by}: songs with no Suno take come last`);
    assert.deepEqual(have, dir === 'asc' ? [...have].sort() : [...have].sort().reverse(), `${by} ${dir}`);
  }
  const wr = order('songs', {songs:{by:'written', dir:'asc'}});
  assert.equal(wr.length, expSongs.length); assert.ok(new Set(wr).size === wr.length, 'every song listed once under any sort');
  for (const by of ['recent', 'title', 'score', 'takes', 'created', 'edited', 'firstTake', 'latestTake', 'written']) for (const dir of ['asc', 'desc']) assert.equal(order('instrumentals', {instrumentals:{by, dir}}).length, expInstr.length, `${by} ${dir} lists every instrumental`);
  const own = boot({prefs:{sorts:{songs:{by:'title', dir:'desc'}, instrumentals:{by:'created', dir:'asc'}}}});
  assert.equal(own.els.fSort.value, 'title'); assert.ok(/Z to A/.test(own.els.fSortDir.textContent), 'the direction button names the order');
  const oldPref = boot({prefs:{sort:'score'}}); assert.equal(oldPref.els.fSort.value, 'score', 'an older saved sort still applies to Songs');
  assert.deepEqual(Object.keys(JSON.parse(own.store['grind.studio.v1.view'] || oldPref.store['grind.studio.v1.view'] || '{}')).filter(k => k.startsWith('grind')), [], 'only the view prefs key is used');
  pass('sorts: A to Z, Z to A, created, edited, first and latest Suno take, date written; saved per section in the view prefs');

  // stems
  const stems = Object.values(MD.takes).filter(t => t.type === 'Stem');
  assert.equal(stems.length, 8);
  const stemSong = MD.songOfTake[stems[0].stem];
  const hidden = boot({search:'?song=' + stemSong}), shownStems = boot({search:'?song=' + stemSong, prefs:{showStems:true}});
  assert.ok(!hidden.els.page.innerHTML.includes(`data-stem="${stems[0].stem}"`) && /archived stem/.test(hidden.els.page.innerHTML), 'stems are hidden on song pages by default');
  assert.ok(shownStems.els.page.innerHTML.includes(`data-stem="${stems[0].stem}"`) && /Show archived stems/.test(shownStems.els.page.innerHTML), 'the toggle brings them back');
  const invTakes = boot({search:'?view=inventory', prefs:{inv:'takes'}}), invAll = boot({search:'?view=inventory', prefs:{inv:'takes', showStems:true}});
  const rowsOf = h => +/of (\d+) rows/.exec(String(h))[1];   // the table shows 200 at a time; the hint has the full count
  assert.equal(rowsOf(invAll.els.page.innerHTML) - rowsOf(invTakes.els.page.innerHTML), 8, 'Every Suno take hides exactly the 8 stems');
  assert.ok(/Show archived stems \(8\)/.test(invTakes.els.page.innerHTML));
  assert.equal(Object.values(boot().ctx.TAKE_SONGS).length, data.TAKE_SONGS.length); assert.equal(MD.songs.reduce((n, s) => n + s.takeIds.filter(id => MD.takes[id].type === 'Stem').length, 0), 8, 'nothing is deleted');
  pass('stems are archived: hidden on song pages and in Every Suno take, behind a toggle, data untouched');
  // clicks: the rail switches sections, the direction button reverses and remembers the sort, the sort menu picks its natural direction
  const app = boot(), click = target => app.handlers.click.forEach(f => f({target:{closest:sel => (/^a\[|^\[data-copy-path/.test(sel) ? null : target)}, button:0}));
  const railBtn = (view, extra = {}) => ({dataset:{view}, matches:sel => sel.includes('.rail-item'), id:'', ...extra});
  click(railBtn('instrumentals'));
  assert.equal(keysIn(app.els.songList.innerHTML).length, expInstr.length, 'the Instrumentals rail button opens Instrumentals');
  click({dataset:{}, id:'fSortDir', matches:() => false});
  assert.equal(JSON.parse(app.store['grind.studio.v1.view']).sorts.instrumentals.dir, 'asc', 'the direction button flips and saves the sort for that section');
  assert.equal(JSON.parse(app.store['grind.studio.v1.view']).sorts.songs.dir, 'desc', 'the other section keeps its own sort');
  app.handlers.change.forEach(f => f({target:{id:'fSort', value:'written'}}));
  assert.deepEqual(JSON.parse(app.store['grind.studio.v1.view']).sorts.instrumentals, {by:'written', dir:'desc'});
  click(railBtn('songs'));
  assert.equal(keysIn(app.els.songList.innerHTML).length, expSongs.length, 'the Songs rail button goes back to Songs');
  pass('rail buttons switch sections; the direction button and sort menu save per section');
  const dated = s => MD.versionsOf(s, {}).some(v => /\d{4}-\d{2}-\d{2}/.test(v.folder + ' ' + v.stem + ' ' + v.session)) || (s.cat?.batches || []).some(b => /\d{4}-\d{2}-\d{2}/.test(b));
  console.log(`dates: ${MD.songs.filter(dated).length} of ${MD.songs.length} songs have a written date`);
  console.log(`COUNTS songs=${expSongs.length} instrumentals=${expInstr.length} beatPrompts=${expPrompts.length} stems=${stems.length}`);
}
