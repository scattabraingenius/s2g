const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../dash/layout.js');
const REG=[{id:'clock',frac:.25},{id:'calendar',frac:.25},{id:'weather',frac:.5},{id:'usage',frac:1}];
test('column count follows the grid width: phone, laptop, 1920, scaled 4K and native 4K',()=>{
 assert.deepEqual([343,1248,1888,2528,3808].map(w=>L.colsFor(w)),[1,4,6,8,8]);
 assert.equal(L.colsFor(0),1);assert.equal(L.colsFor(NaN),1);
});
test('layout name comes from ?layout= and is cleaned',()=>{
 assert.equal(L.layoutName(''),'default');assert.equal(L.layoutName('?layout=Wall-Left'),'wall-left');
 assert.equal(L.layoutName('?layout=../x<y>'),'xy');assert.equal(L.layoutName('?layout=%20%20'),'default');
});
test('saved layouts drop unknown cards, append new ones, and repair bad widths',()=>{
 const r=L.resolve({order:['usage','ghost','clock','usage'],frac:{clock:3,weather:'x',usage:.5},hidden:['ghost','calendar']},REG);
 assert.deepEqual(r.order,['usage','clock','calendar','weather']);
 assert.deepEqual(r.frac,{clock:1,calendar:.25,weather:.5,usage:.5});
 assert.deepEqual(r.hidden,['calendar']);
 assert.deepEqual(L.resolve(null,REG).order,['clock','calendar','weather','usage']);
 assert.deepEqual(L.resolve('junk',REG).hidden,[]);
});
test('widths are a share of the row, so one layout fits every screen',()=>{
 assert.deepEqual([1,2,4,6,8].map(c=>L.spanFor(.5,c)),[1,1,2,3,4]);
 assert.deepEqual([1,4,8].map(c=>L.spanFor(.25,c)),[1,1,2]);
 assert.equal(L.spanFor(1,8),8);assert.equal(L.spanFor(.01,8),1);
});
test('moving skips hidden cards and stops at the ends',()=>{
 let l=L.resolve({hidden:['calendar']},REG);
 l=L.move(l,'weather',-1);assert.deepEqual(l.order,['weather','calendar','clock','usage']);
 assert.equal(L.move(l,'weather',-1),l);assert.equal(L.move(l,'usage',1),l);
 assert.deepEqual(L.place(l,'usage','weather').order,['usage','weather','calendar','clock']);
 assert.deepEqual(L.place(l,'weather',null).order,['calendar','clock','usage','weather']);
});
test('wider and narrower step by one current column and stay in range',()=>{
 let l=L.resolve(null,REG);
 l=L.resize(l,'weather',1,8);assert.equal(l.frac.weather,5/8);
 l=L.resize(l,'clock',-5,8);assert.equal(l.frac.clock,1/8);
 l=L.resize(l,'usage',1,8);assert.equal(l.frac.usage,1);
 assert.deepEqual(L.setHidden(L.setHidden(l,'clock',true),'clock',false).hidden,[]);
});
test('a card stretches only when the next one wraps, so no width leaves a hole and the last card keeps its width',()=>{
 const l=L.resolve(null,REG);
 assert.deepEqual(L.packSpans(l,2),{clock:1,calendar:1,weather:2,usage:2});
 assert.deepEqual(L.packSpans(l,3),{clock:1,calendar:1,weather:1,usage:3});
 assert.deepEqual(L.packSpans(l,6),{clock:1,calendar:1,weather:4,usage:6});
 assert.deepEqual(L.packSpans(l,5),{clock:1,calendar:1,weather:3,usage:5});
 assert.deepEqual(L.packSpans(l,8),{clock:2,calendar:2,weather:4,usage:8});
 assert.deepEqual(L.packSpans(L.setHidden(l,'calendar',true),4),{clock:1,weather:3,usage:4});
 assert.deepEqual(L.packSpans(L.resize(l,'usage',-1,8),8),{clock:2,calendar:2,weather:4,usage:7});
 assert.deepEqual(L.packSpans(l,1),{clock:1,calendar:1,weather:1,usage:1});
});
