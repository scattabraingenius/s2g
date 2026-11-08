const assert = require('node:assert/strict');
const sync = require('../lyrics/sync.js');
const empty = () => ({v:2, ratings:{}, custom:{}, tracklist:[], pick:{}});
const changed = (before, edit, device, time) => { const next=structuredClone(before); edit(next); return sync.capture(before,next,device,time); };
let checks=0;
function test(name, fn) { fn(); checks++; console.log('PASS '+name); }
test('Legacy scores migrate without losing IDs, notes, cleared scores or private copies',()=>{
 const legacy={...empty(),ratings:{'folder/song_v01_Cue':{score:null,status:null,note:'phone note',at:100}},custom:{song:[{stem:'mine-old',custom:true,suno:{style:'raw'},lyrics:'draft'}]},tracklist:['song']};
 const prepared=sync.prepare(legacy), projected=sync.project(legacy,sync.recordsOf(prepared._sync),'owner');
 assert.equal(projected.ratings['folder/song_v01_Cue'].score,null);
 assert.equal(projected.ratings['folder/song_v01_Cue'].note,'phone note');
 assert.deepEqual(projected.custom,legacy.custom);
 assert.deepEqual(projected.tracklist,['song']);
 assert(!Object.keys(prepared._sync.records).some(key=>/[.#$\[\]/]/.test(key)));
});
test('An empty PC preserves the phone catalogue and merging converges in either order',()=>{
 const phone=sync.prepare({...empty(),ratings:{a:{score:91,note:'phone',at:100}}});
 const pc=sync.prepare(empty());
 assert.deepEqual(sync.merge(phone._sync.records,pc._sync.records),phone._sync.records);
 assert.deepEqual(sync.merge(pc._sync.records,phone._sync.records),phone._sync.records);
});
test('Concurrent score and note edits to the same version both survive',()=>{
 const base=sync.prepare({...empty(),ratings:{a:{score:50,note:'old',at:10}}});
 const phone=changed(base,s=>s.ratings.a.score=95,'phone',100);
 const pc=changed(base,s=>s.ratings.a.note='PC note','pc',100);
 const joined=sync.merge(phone._sync.records,pc._sync.records);
 const projected=sync.project(base,joined,'owner');
 assert.equal(projected.ratings.a.score,95); assert.equal(projected.ratings.a.note,'PC note');
 assert.deepEqual(joined,sync.merge(pc._sync.records,phone._sync.records));
});
test('Same-field conflicts resolve deterministically; a later edit wins despite clock skew',()=>{
 const base=sync.prepare({...empty(),ratings:{a:{score:50}}});
 const phone=changed(base,s=>s.ratings.a.score=70,'phone',100);
 const pc=changed(base,s=>s.ratings.a.score=80,'pc',100);
 const records=sync.merge(phone._sync.records,pc._sync.records);
 assert.deepEqual(records,sync.merge(pc._sync.records,phone._sync.records));
 const seen=sync.project(base,records,'owner');
 const later=changed(seen,s=>s.ratings.a.score=99,'pc',1);
 assert.equal(sync.project(base,sync.merge(records,later._sync.records),'owner').ratings.a.score,99);
});
test('Concurrent edits of different songs and independently added tracks all survive',()=>{
 const base=sync.prepare(empty());
 const phone=changed(base,s=>{s.ratings.a={score:80};s.tracklist=['a'];},'phone',100);
 const pc=changed(base,s=>{s.ratings.b={score:90};s.tracklist=['b'];},'pc',100);
 const joined=sync.project(base,sync.merge(phone._sync.records,pc._sync.records),'owner');
 assert.equal(joined.ratings.a.score,80);assert.equal(joined.ratings.b.score,90);
 assert.deepEqual(joined.tracklist,['a','b']);
});
test('Removed tracks and deleted custom versions stay deleted when an old device rejoins',()=>{
 const base=sync.prepare({...empty(),ratings:{'mine-a':{score:80,note:'remove'}},custom:{a:[{stem:'mine-a',custom:true,created:5}]},pick:{a:'mine-a'},tracklist:['a','b']});
 const deletion=changed(base,s=>{s.custom.a=[];delete s.ratings['mine-a'];s.tracklist=['b'];},'phone',100);
 const joined=sync.project(base,sync.merge(deletion._sync.records,base._sync.records),'owner');
 assert.deepEqual(joined.custom,{});assert.deepEqual(joined.ratings,{});assert.deepEqual(joined.tracklist,['b']);assert.deepEqual(joined.pick,{});
 const readd=changed(joined,s=>s.tracklist=['a','b'],'pc',101);
 assert.deepEqual(sync.project(base,sync.merge(deletion._sync.records,readd._sync.records),'owner').tracklist,['a','b']);
});
test('Clearing a score or status survives JSON/database null handling',()=>{
 const base=sync.prepare({...empty(),ratings:{a:{score:80,status:'short'}}});
 const cleared=changed(base,s=>{s.ratings.a.score=null;s.ratings.a.status=null;},'phone',100);
 const saved=sync.recordsOf(JSON.parse(JSON.stringify(cleared._sync)));
 const projected=sync.project(base,sync.merge(base._sync.records,saved),'owner');
 assert.equal(projected.ratings.a.score,null);assert.equal(projected.ratings.a.status,null);
});
test('Unknown cloud formats and malformed records fail without reseeding over them',()=>{
 assert.throws(()=>sync.recordsOf({v:99,records:{}}),/Unsupported/);
 assert.throws(()=>sync.recordsOf({v:1,records:{bad:{rev:[1,'phone'],data:'bad'}}}),/Invalid/);
});
test('Custom sessions merge independent membership changes and preserve scores when deleted',()=>{
 const base=sync.prepare({...empty(),collections:{album:{name:'Finalists',created:1,members:['a']}}});
 const phone=changed(base,s=>s.collections.album.members.push('b'),'phone',100);
 const pc=changed(base,s=>s.collections.album.members.push('c'),'pc',100);
 const joined=sync.project(base,sync.merge(phone._sync.records,pc._sync.records),'owner');
 assert.deepEqual(joined.collections.album.members,['a','b','c']);
 const removed=changed(joined,s=>{s.collections.album.members=s.collections.album.members.filter(stem=>stem!=='a');s.collections.album.name='Album picks';s.ratings.a={score:99};},'pc',101);
 const projected=sync.project(base,sync.merge(base._sync.records,removed._sync.records),'owner');
 assert.deepEqual(projected.collections.album.members,['b','c']);assert.equal(projected.collections.album.name,'Album picks');
 const deleted=changed(projected,s=>delete s.collections.album,'phone',102);
 const final=sync.project(base,sync.merge(base._sync.records,deleted._sync.records),'owner');
 assert.deepEqual(final.collections,{});assert.equal(final.ratings.a.score,99);
});
console.log(`${checks} merge checks passed`);
