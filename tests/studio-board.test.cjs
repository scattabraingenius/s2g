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
  const downloads = [], FakeURL = class extends URL { static createObjectURL(b) { downloads.push(b.text); return 'blob:test'; } static revokeObjectURL() {} };
  const sandbox = {document, console, URLSearchParams, URL:FakeURL, Blob:class { constructor(parts) { this.text = parts.join(''); } }, CSS:{escape:x => x}, JSON, Math, Date, Set, Map, Promise, Object, Array, String, Number, setTimeout, clearTimeout, crypto:require('node:crypto').webcrypto,
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
  return {els, store, ctx, handlers, downloads};
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

  // ---- Inventory: Songs | Instrumentals | Every Suno take, column chooser, sorting, filter, drawer, CSV ----
  const lyricLine = (() => { for (const ls of data.LYRIC_SONGS) for (const v of ls.versions) { const l = String(v.lyrics || '').split('\n').map(x => x.trim()).find(x => x.length > 30 && !/^[\[(#]/.test(x)); if (l) return l; } return null; })();
  assert.ok(lyricLine, 'the test needs one real lyric line to prove it never leaks (the line is not stored in this file)');
  const invClick = (app, target) => app.handlers.click.forEach(f => f({target:{closest:sel => (/^a\[|^\[data-copy-path/.test(sel) ? null : target)}, button:0}));
  const btn = (id, dataset = {}) => ({id, dataset, matches:() => false});
  const rowCount = h => +/ of (\d+) rows/.exec(String(h))[1], shownRows = h => +/(\d+) of \d+ rows/.exec(String(h))[1];
  const headers = h => [...String(h).matchAll(/<th[^>]*>(?:<button[^>]*>)?([^<↑↓]+?)(?: [↑↓])?(?:<\/button>)?<\/th>/g)].map(m => m[1].trim());
  {
    const si = boot({search:'?view=inventory', prefs:{inv:'songs'}}), ii = boot({search:'?view=inventory', prefs:{inv:'instrumentals'}}), ti = boot({search:'?view=inventory', prefs:{inv:'takes'}});
    assert.equal(rowCount(si.els.page.innerHTML), expSongs.length, 'Inventory Songs lists the songs with sung words');
    assert.equal(rowCount(ii.els.page.innerHTML), expInstr.length, 'Inventory Instrumentals lists instrumentals without beat prompts');
    const ip = boot({search:'?view=inventory', prefs:{inv:'instrumentals', prompts:true}});
    assert.equal(rowCount(ip.els.page.innerHTML), expInstr.length + expPrompts.length, 'beat prompts come in with their toggle');
    assert.ok(/data-inv="songs"/.test(si.els.page.innerHTML) && /data-inv="instrumentals"/.test(si.els.page.innerHTML) && /data-inv="takes"/.test(si.els.page.innerHTML), 'the top toggle has Songs, Instrumentals and Every Suno take');
    pass('Inventory top toggle: Songs, Instrumentals (beat prompts behind their toggle) and Every Suno take');

    // default columns, every field available in the chooser
    const defHeads = headers(si.els.page.innerHTML);
    assert.deepEqual(defHeads, ['Title', 'Where', 'Writers', 'Recent activity', 'Lyric versions', 'Takes on board', 'Best score', 'Song status']);
    const chooserBoxes = [...si.els.page.innerHTML.matchAll(/data-inv-col="([^"]+)"/g)].map(m => m[1]);
    assert.ok(chooserBoxes.length >= 50, 'the chooser lists every song field: ' + chooserBoxes.length);
    assert.equal(new Set(chooserBoxes).size, chooserBoxes.length);
    pass(`column chooser: ${chooserBoxes.length} song columns, ${defHeads.length} shown by default`);

    // show a column, saved on this device in the view prefs; show all; reset
    const cc = boot({search:'?view=inventory', prefs:{inv:'songs'}});
    cc.handlers.change.forEach(f => f({target:{id:'', dataset:{invCol:'created'}, checked:true}}));
    assert.ok(headers(cc.els.invBody.innerHTML).includes('Date created'), 'ticking a column shows it');
    assert.deepEqual(JSON.parse(cc.store['grind.studio.v1.view']).invCols.songs.includes('created'), true);
    assert.ok(!Object.keys(cc.store).some(k => k !== 'grind.studio.v1.view' && /view|col/i.test(k) && k.startsWith('grind')), 'no new synced key');
    const reload = boot({search:'?view=inventory', prefs:JSON.parse(cc.store['grind.studio.v1.view'])});
    assert.ok(headers(reload.els.page.innerHTML).includes('Date created'), 'the choice survives a reload');
    invClick(cc, btn('colsAll'));
    assert.equal(headers(cc.els.page.innerHTML).length, chooserBoxes.length, 'Show all shows every column');
    invClick(cc, btn('colsReset'));
    assert.deepEqual(headers(cc.els.page.innerHTML), defHeads, 'Reset brings back the default set');
    assert.equal(JSON.parse(cc.store['grind.studio.v1.view']).invCols.songs, null);
    pass('columns can be shown, hidden, all shown and reset; the choice is saved in the local view prefs only');

    // sort and filter
    const so = boot({search:'?view=inventory', prefs:{inv:'songs'}});
    const titlesOf = h => [...String(h).matchAll(/<button class="linkish" data-inv-row="[^"]*">([^<]*)<\/button>/g)].map(m => m[1].replaceAll('&amp;', '&').replaceAll('&#39;', "'").replaceAll('&quot;', '"'));
    invClick(so, btn('', {invSort:'title'}));
    const asc = titlesOf(so.els.invBody.innerHTML); assert.ok(asc.length > 1);
    assert.deepEqual(asc, [...asc].sort((a, b) => a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'})), 'sorted A to Z');
    invClick(so, btn('', {invSort:'title'}));
    const desc = titlesOf(so.els.invBody.innerHTML);
    assert.deepEqual(desc, [...asc].sort((a, b) => b.localeCompare(a, undefined, {numeric:true, sensitivity:'base'})), 'second click sorts Z to A');
    invClick(so, btn('', {invSort:'best'}));
    assert.ok(JSON.parse(so.store['grind.studio.v1.view']).invSort.songs.col === 'best', 'sort is remembered');
    const target = expSongs[0].title;
    so.handlers.input.forEach(f => f({target:{id:'invQ', value:target.toLowerCase(), dataset:{}, selectionStart:0}}));
    assert.ok(titlesOf(so.els.invBody.innerHTML).includes(target) && shownRows(so.els.invBody.innerHTML) < expSongs.length, 'the filter narrows the rows');
    pass('sort by any column (click, click again to reverse, remembered) and filter');

    // drawer
    const dr = boot({search:'?view=inventory', prefs:{inv:'songs'}});
    invClick(dr, btn('', {invRow:expSongs[0].key}));
    const drawer = dr.els.invDrawer.innerHTML;
    assert.ok(drawer.includes(expSongs[0].title) && /Suno takes/.test(drawer) && /Decisions/.test(drawer) && /Lyric versions/.test(drawer), 'the drawer shows the song in groups');
    const fieldLabels = [...si.els.page.innerHTML.matchAll(/data-inv-col="[^"]+"[^>]*> ([^<]+)<\/label>/g)].map(m => m[1].trim());
    assert.equal(fieldLabels.length, chooserBoxes.length); assert.ok(fieldLabels.every(l => drawer.includes('<dt>' + l + '</dt>')), 'the drawer shows every field');
    invClick(dr, btn('invDrawerClose')); assert.equal(dr.els.invDrawer.hidden, true);
    const tk = boot({search:'?view=inventory', prefs:{inv:'takes'}}), tkey = Object.keys(MD.takes).find(id => MD.takes[id].type !== 'Stem');
    invClick(tk, btn('', {invRow:tkey})); assert.ok(tk.els.invDrawer.innerHTML.includes(MD.takes[tkey].title) && /Details/.test(tk.els.invDrawer.innerHTML));
    pass('row drawer shows every field of one song, and of one take');

    // CSV
    const csvApp = boot({search:'?view=inventory', prefs:{inv:'songs'}});
    invClick(csvApp, btn('invCsv'));
    const vis = csvApp.downloads[0].replace(/^\ufeff/, '').split('\r\n');
    assert.equal(vis[0], defHeads.join(','), 'visible CSV has exactly the visible columns');
    assert.equal(vis.length - 1, expSongs.length);
    invClick(csvApp, btn('invCsvAll'));
    const all = csvApp.downloads[1].replace(/^\ufeff/, '');
    assert.ok(all.startsWith('Title,Song id,'), 'everything export has every column');
    assert.equal(all.split('\r\n')[0].split(',').length, chooserBoxes.length);
    const ti2 = boot({search:'?view=inventory', prefs:{inv:'takes'}}); invClick(ti2, btn('invCsv'));
    assert.equal(ti2.downloads[0].split('\r\n').length - 1, rowCount(ti2.els.page.innerHTML), 'take CSV has the visible rows (stems hidden)');
    invClick(ti2, btn('invCsvAll')); assert.equal(ti2.downloads[1].split('\r\n').length - 1, rowCount(ti2.els.page.innerHTML) + 8, 'everything includes the 8 archived stems');
    for (const text of [...csvApp.downloads, ...ti2.downloads, si.els.page.innerHTML, drawer, tk.els.invDrawer.innerHTML, ii.els.page.innerHTML]) assert.ok(!text.includes(lyricLine), 'no lyric text in the page, drawer or CSV');
    pass('CSV: visible columns, everything, take rows; no lyric text in tables, drawer or CSV');
    console.log(`INVENTORY song columns=${chooserBoxes.length} default=${defHeads.length} take columns=${[...ti.els.page.innerHTML.matchAll(/data-inv-col=/g)].length}`);
  }
}

// Old-board soft archive: legacy deep links, install manifest, banners, nav.
{
  const probe = boot(), data = probe.ctx;
  const MD = Model.create({lyricSongs:data.LYRIC_SONGS, takeSongs:data.TAKE_SONGS, studio:data.STUDIO});
  const pageOf = search => boot({search}).els.page;
  const withVersion = Object.entries(MD.songOfSlug).find(([slug, key]) => slug !== key && (MD.lyricBySlug[slug]?.versions || []).length > 1 && MD.bySong[key]);
  assert.ok(withVersion, 'found a lyric slug that differs from its Studio key');
  const [slug, key] = withVersion, versions = MD.lyricBySlug[slug].versions, stem = versions[1].stem;
  const base = pageOf('?song=' + key).innerHTML;
  assert.ok(base.includes(MD.bySong[key].title), 'Studio key opens the song');
  const viaSlug = pageOf('?song=' + encodeURIComponent(slug));
  assert.ok(viaSlug.innerHTML.includes(MD.bySong[key].title), 'old ?song=<lyric slug> opens the mapped Studio song');
  const ver = pageOf(`?song=${encodeURIComponent(slug)}&version=${encodeURIComponent(stem)}`);
  const studioVer = pageOf(`?song=${key}&v=${encodeURIComponent(stem)}`);
  assert.equal(ver.dataset.version, stem, 'old &version=<stem> selects that lyric version'); assert.equal(ver.dataset.version, studioVer.dataset.version, 'same as the Studio v= link');
  const q = boot({search:'?q=moon'});
  assert.equal(q.els.songQ.value, 'moon', 'old ?q= fills the search box'); assert.ok(keysIn(q.els.songList.innerHTML).length < keysIn(boot().els.songList.innerHTML).length, 'and filters the list');
  const noSlug = pageOf('?song=no-such-slug-xyz'); assert.ok(!/lyrics-pane|prompt-pane/.test(noSlug.innerHTML), 'an unknown slug opens the list, not a broken page');
  const byLyrics = pageOf('?lyrics=' + encodeURIComponent(stem)); assert.ok(byLyrics.innerHTML.includes(MD.bySong[key].title) && byLyrics.dataset.version === stem, 'old ?lyrics=<stem> opens the song and version');
  const takeId = Object.keys(MD.takes).find(id => MD.songOfTake[id] && MD.takes[id].type !== 'Stem');
  const byTake = pageOf('?take=' + encodeURIComponent(takeId)); assert.ok(byTake.innerHTML.includes(MD.bySong[MD.songOfTake[takeId]].title), 'old ?take=<id> opens the take\'s song');
  pass('old deep links (?song=<slug>&version=&q=, ?take=, ?lyrics=) open the right place in the Studio');

  const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8'), man = JSON.parse(R('studio/manifest.webmanifest'));
  assert.equal(man.id, '/s2g/studio/'); assert.equal(man.scope, './'); assert.equal(man.start_url, './');
  assert.ok(man.icons.length >= 3 && man.icons.every(i => fs.existsSync(path.join(ROOT, 'studio', i.src))), 'every manifest icon exists');
  assert.ok(/rel="manifest" href=".\/manifest.webmanifest"/.test(R('studio/index.html')));
  assert.equal(JSON.parse(R('lyrics/manifest.webmanifest')).id, '/s2g/lyrics/'); assert.equal(JSON.parse(R('audio/manifest.webmanifest')).id, '/s2g/audio/');
  assert.ok(R('service-worker.js').includes('"./studio/manifest.webmanifest"'), 'service worker precaches the Studio manifest');
  for (const [f, href] of [['lyrics/index.html', '../studio/'], ['audio/classic.html', '../studio/'], ['audio/album/index.html', '../../studio/']]) {
    const h = R(f);
    assert.ok(/The Studio Board replaces this page\./.test(h) && /Open the Studio/.test(h) && /still works/.test(h) && h.includes(`<a href="${href}"`), f + ' has the banner');
    assert.ok(h.includes(`class="btn small" href="${href}">Studio Board`), f + ' board switch includes the Studio');
    assert.ok(/<aside class="archive-banner"[^>]*>[^]*<\/aside>\s*<header class="top">/.test(h) && !/position:\s*(fixed|absolute|sticky)/.test(h.match(/<aside class="archive-banner"[^>]*>/)[0]), f + ' banner sits in the page flow above the header');
  }
  const mm = R('mm/index.html'); assert.ok(!/SB2G_URL\+"(lyrics|audio)\/"/.test(mm) && mm.includes('SB2G_URL+"studio/"'), 'MM Home links to the Studio, not the old boards');
  const gen = R('scripts/update-mm-home.py'); assert.ok(!/items\.push\(\{id:"(audio|album)"[^\n]*\n\s*if\(SB2G_URL\) items\.push\(\{id:"audio"/.test(gen) && gen.includes('id:"studio"'), 'the MM Home generator no longer re-adds the old boards');
  pass('Studio manifest, banners, board-switch and MM Home nav');
}
