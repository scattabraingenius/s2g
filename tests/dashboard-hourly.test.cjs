const {test}=require('node:test'),assert=require('node:assert/strict');
const H=require('../dash/hourly.js');
// Two days of hourly data in Detroit winter time (UTC-5), with values that encode their own hour.
const OFFSET=-18000,time=[],t=[],f=[],rain=[],code=[];
for(const day of ['2026-11-09','2026-11-10'])for(let h=0;h<24;h++){time.push(`${day}T${String(h).padStart(2,'0')}:00`);t.push(day.endsWith('09')?h:100+h);f.push(h-3);rain.push(h*4);code.push(h%3);}
const hourly={time,temperature_2m:t,apparent_temperature:f,precipitation_probability:rain,weather_code:code};
// Local wall-clock time at the place -> epoch ms.
const at=(day,hh,mm)=>Date.UTC(2026,10,day,hh,mm)-OFFSET*1000;
const shape=p=>p.slots.map(s=>`${s.hour}:${s.temp}${s.passed?'p':''}${s.current?'c':''}`).join(' ');
test('slots follow the place clock across the day and switch to tomorrow after the last one',()=>{
 const cases=[[9,6,59,false,'7:7 12:12 16:16 20:20'],[9,7,0,false,'7:7c 12:12 16:16 20:20'],[9,12,30,false,'7:7p 12:12c 16:16 20:20'],
  [9,20,59,false,'7:7p 12:12p 16:16p 20:20c'],[9,21,0,true,'7:107 12:112 16:116 20:120'],[9,23,59,true,'7:107 12:112 16:116 20:120'],[10,0,0,false,'7:107 12:112 16:116 20:120']];
 for(const [d,h,m,tomorrow,want] of cases){const p=H.pickSlots(hourly,OFFSET,at(d,h,m),[7,12,16,20]);assert.equal(p.tomorrow,tomorrow,`${d} ${h}:${m}`);assert.equal(shape(p),want,`${d} ${h}:${m}`);}
});
test('a slot carries temperature, feels-like, rain chance and icon code',()=>{
 const s=H.pickSlots(hourly,OFFSET,at(9,6,0),null).slots[2];
 assert.deepEqual({hour:s.hour,temp:s.temp,feels:s.feels,rain:s.rain,code:s.code},{hour:16,temp:16,feels:13,rain:64,code:1});
});
test('custom slots are cleaned; bad input falls back to the default four',()=>{
 assert.deepEqual(H.normSlots([20,'7',7,25,-1,12.5,16]),[7,16,20]);
 assert.deepEqual(H.normSlots('x'),[7,12,16,20]);assert.deepEqual(H.normSlots([]),[7,12,16,20]);
 assert.equal(H.pickSlots(hourly,OFFSET,at(9,8,0),[9,22]).slots.map(s=>s.hour).join(),'9,22');
});
test('after the last day of data there is no tomorrow to show, and missing data is not invented',()=>{
 assert.equal(H.pickSlots(hourly,OFFSET,at(10,22,0),[7,12,16,20]),null);
 assert.equal(H.pickSlots({time:[]},OFFSET,at(9,8,0)),null);
 const gap={...hourly,time:hourly.time.map(x=>x==='2026-11-09T12:00'?'2026-11-09T99:00':x)};
 assert.ok(H.pickSlots(gap,OFFSET,at(9,8,0)).slots[1].missing);
});
test('the strip starts at the current hour and holds 24 hours; the SVG marks the slot times',()=>{
 const pts=H.stripWindow(hourly,OFFSET,at(9,13,40),24);
 assert.equal(pts.length,24);assert.equal(pts[0].time,'2026-11-09T13:00');assert.equal(pts[23].time,'2026-11-10T12:00');
 const svg=H.stripSvg(pts,600,[7,12,16,20]);
 assert.equal((svg.match(/class="slot-tick"/g)||[]).length,4);assert.match(svg,/<path class="t-line" d="M/);assert.match(svg,/viewBox="0 0 600 92"/);
 assert.equal(H.stripSvg(pts.slice(0,1),600),'');
});
test('hour labels',()=>{assert.equal(H.hourLabel(0,true),'12 AM');assert.equal(H.hourLabel(12,true),'12 PM');assert.equal(H.hourLabel(16),'4p');});
