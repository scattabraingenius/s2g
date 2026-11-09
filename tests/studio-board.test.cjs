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
