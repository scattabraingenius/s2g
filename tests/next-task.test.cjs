const {test}=require('node:test'),assert=require('node:assert/strict');
const N=require('../dash/next-task.js');
const at=(d,h,m,s=0)=>new Date(2026,10,d,h,m,s).getTime();     // November 2026, local time
const T=(id,o)=>Object.freeze({id,task:id,people:[],priority:5,status:'todo',showOn:'',created:1,due:'',dueTime:'',time:'',...o});
const ids=r=>({next:r.next&&r.next.task.id,overdue:r.overdue.map(i=>i.task.id)});
test('the countdown targets the soonest upcoming deadline; overdue tasks go on their own line, oldest first',()=>{
 const tasks=[T('later-today',{due:'2026-11-09',dueTime:'15:00'}),T('soon',{due:'2026-11-09',dueTime:'11:30'}),
  T('missed-9am',{due:'2026-11-09',dueTime:'09:00'}),T('missed-yesterday',{due:'2026-11-08'}),T('tomorrow',{due:'2026-11-10',dueTime:'08:00'})];
 assert.deepEqual(ids(N.select(tasks,at(9,10,0))),{next:'soon',overdue:['missed-yesterday','missed-9am']});
});
test('a deadline that just passed shows "Due now" for 5 minutes, then becomes overdue',()=>{
 const tasks=[T('call',{due:'2026-11-09',dueTime:'10:00'}),T('next',{due:'2026-11-09',dueTime:'12:00'})];
 let r=N.select(tasks,at(9,10,4,59));assert.equal(r.next.task.id,'call');assert.equal(r.next.dueNow,true);assert.equal(N.countdown(r.next,at(9,10,4,59)),'Due now');
 r=N.select(tasks,at(9,10,5,1));assert.deepEqual(ids(r),{next:'next',overdue:['call']});
});
test('date-only deadlines count to the end of the day without ticking seconds',()=>{
 const r=N.select([T('rent',{due:'2026-11-09'})],at(9,10,0));
 assert.equal(r.next.dateOnly,true);assert.equal(N.countdown(r.next,at(9,10,0)),'Due today · 13h left');
 assert.equal(N.countdown(r.next,at(9,23,30)),'Due today · 29m left');
 assert.equal(N.countdown(N.select([T('x',{due:'2026-11-10'})],at(9,10,0)).next,at(9,10,0)),'Due tomorrow');
 assert.match(N.countdown(N.select([T('x',{due:'2026-11-12'})],at(9,10,0)).next,at(9,10,0)),/^Due \w+/);
});
test('timed countdown formats: days, hours, then a ticking clock under an hour',()=>{
 const one=(due,dueTime,now)=>N.countdown(N.select([T('x',{due,dueTime})],now).next,now);
 assert.equal(one('2026-11-11','14:00',at(9,10,0)),'2d 4h');
 assert.equal(one('2026-11-09','15:12',at(9,10,0)),'5h 12m');
 assert.equal(one('2026-11-09','10:42',at(9,9,59,53)),'42:07');
});
test('excluded: done, Someday, Later with a future date, undated, and scheduled-time-only tasks',()=>{
 const tasks=[T('done',{status:'done',due:'2026-11-09',dueTime:'12:00'}),T('someday',{status:'later',showOn:'',due:'2026-11-09'}),
  T('later-future',{status:'later',showOn:'2026-11-12T08:00',due:'2026-11-09'}),T('undated',{}),T('time-only',{time:'11:00'}),T('bad-date',{due:'next week'})];
 assert.deepEqual(ids(N.select(tasks,at(9,10,0))),{next:null,overdue:[]});
});
test('a Later task whose day has arrived counts, without being changed',()=>{
 const t=T('back-today',{status:'later',showOn:'2026-11-09T08:00',due:'2026-11-09',dueTime:'18:00'});
 assert.equal(N.select([t],at(9,10,0)).next.task.id,'back-today');
 assert.equal(t.status,'later','the task object was not touched (it is frozen, so a write would also throw)');
 assert.equal(N.select([{...t,status:'doing',showOn:''}],at(9,10,0)).next.task.id,'back-today','doing counts');
});
test('ties: higher priority first, then the older task, then id',()=>{
 const due={due:'2026-11-09',dueTime:'12:00'};
 assert.equal(N.select([T('low',{...due,priority:3}),T('high',{...due,priority:8})],at(9,10,0)).next.task.id,'high');
 assert.equal(N.select([T('newer',{...due,created:9}),T('older',{...due,created:2})],at(9,10,0)).next.task.id,'older');
 assert.equal(N.select([T('b',due),T('a',due)],at(9,10,0)).next.task.id,'a');
});
test('midnight: a date-only task due today is due now at 23:59, then overdue the next morning',()=>{
 const tasks=[T('rent',{due:'2026-11-09'})];
 assert.equal(N.select(tasks,at(9,23,59,30)).next.dueNow,true);
 assert.deepEqual(ids(N.select(tasks,at(10,0,5))),{next:null,overdue:['rent']});
});
test('junk input never throws',()=>{assert.deepEqual(ids(N.select(null,at(9,10,0))),{next:null,overdue:[]});assert.deepEqual(ids(N.select([null,1,{},{id:5}],at(9,10,0))),{next:null,overdue:[]});});
test('labels',()=>{
 const r=N.select([T('x',{due:'2026-11-09',dueTime:'15:00'})],at(9,10,0));assert.match(N.whenLabel(r.next,at(9,10,0)),/^Today 3:00/);
 assert.equal(N.whenLabel(N.select([T('x',{due:'2026-11-10'})],at(9,10,0)).next,at(9,10,0)),'Tomorrow');
});
