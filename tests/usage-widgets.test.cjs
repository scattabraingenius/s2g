const {test}=require('node:test');const assert=require('node:assert/strict');const w=require('../dash/usage-widgets.js');
const now=Date.parse('2026-11-06T16:00:00Z');
const win={key:'secondary',label:'Weekly',usedPercent:32,windowMinutes:10080,resetsAt:'2026-11-11T10:40:42Z',pace:{deltaPercent:1}};
const p={id:'codex',name:'Codex',updatedAt:'2026-11-06T15:55:00Z',windows:[win]};
test('quota uses remaining, not pace delta',()=>{assert.equal(w.quota(win,now).left,68);assert.match(w.card(p,'burn',{},now),/68%/);assert.match(w.card(p,'history',{},now),/68%/)});
test('unknown is distinct from zero',()=>{assert.equal(w.left({usedPercent:null}),null);assert.equal(w.left({usedPercent:100}),0);assert.equal(w.left({usedPercent:0}),100);assert.equal(w.left({usedPercent:-1}),null);assert.doesNotMatch(w.card(p,'burn',{},now),/quota-label">Session|No data|Reset unavailable/)});
test('history ends at measurement, does not extend to current time',()=>{const points=w.points(p,win,[],now);assert.equal(points.at(-1).t,Date.parse(p.updatedAt));assert.notEqual(points.at(-1).t,now)});
test('provider freshness cannot be hidden by feed heartbeat',()=>assert.equal(w.status({...p,updatedAt:'2026-11-06T14:00:00Z'},{checkedAt:new Date(now).toISOString()},now).stale,true));
test('expired and missing windows do not produce bogus charts',()=>{assert.deepEqual(w.points(p,{...win,resetsAt:'2026-11-05T16:00:00Z'},[],now),[]);assert.doesNotMatch(w.graph(p,{},[],now),/NaN|Infinity/)});
test('reset identifiers exclude another reset window',()=>{const h=[{t:'2026-11-06T15:00:00Z',u:{codex:{secondary:20}},r:{codex:{secondary:'2026-11-12T10:40:42Z'}}}];assert.equal(w.points(p,win,h,now).length,1)});
test('cost history escapes content and distinguishes missing from zero',()=>{assert.equal(w.money(null),'—');assert.equal(w.money(0),'$0.00');assert.match(w.costChart({daily:[]}),/unavailable/);assert.doesNotMatch(w.costChart({daily:[{date:'<script>',costUSD:3}]}),/<script>/)});

/* ---------- Runway forecast model ---------- */
const fx=require('./fixtures/usage-2026-11-08.json');
const H=3600000;
const fxNow=Math.max(...fx.providers.map(p=>Date.parse(p.updatedAt)))+60000;
const clone=o=>JSON.parse(JSON.stringify(o));
const model=(feed=fx,at=fxNow,failed=false)=>w.usageModel(feed,at,failed);
const close=(a,b,tol=.05)=>assert.ok(Math.abs(a-b)<=tol,`${a} not within ${tol} of ${b}`);

test('frozen snapshot: Codex runs out early, Claude on pace with a session',()=>{
 const m=model(),c=m.P.codex.weekly,a=m.P.claude.weekly;
 assert.equal(c.L,54);close(c.safe*24,11.15);close(c.avg*24,21.31);close(c.r24.r*24,13.97);
 assert.equal(c.status,'bad');assert.ok(c.recent.out<c.end&&c.week.out<c.recent.out);
 assert.equal(m.P.codex.session,null,'Codex has no session window and none is invented');
 assert.equal(a.status,'pace','+1.5 pts is inside the ±3 near-even band');assert.equal(a.recent.out,null);
 assert.equal(m.P.claude.session.state,'ok');
 const v=w.verdict(m);assert.match(v,/Codex.*runs out.*11\.2% a day/);assert.match(v,/Claude.*is on pace/);assert.doesNotMatch(v,/has room/);
});
test('runway chart, tiles and history render without NaN',()=>{
 const m=model(),r=w.runway(m,360);assert.match(r.svg,/^<svg/);assert.doesNotMatch(r.svg+w.tile(m,'codex')+w.tile(m,'claude')+w.dailyChart(m,360)+w.tokenChart(m,360)+w.runwayLegend(m)+w.runwayTip(m,fxNow+5*H),/NaN|undefined|Infinity/);
 assert.doesNotMatch(w.tile(m,'codex'),/Session/);assert.match(w.tile(m,'claude'),/Session/);assert.match(w.tile(m,'codex'),/2 free full resets/);
 assert.doesNotMatch(w.runway(m,360,'codex').svg,/Claude \d+%/);
});
test('Claude reset jitter of one second keeps the samples',()=>{
 const m=model(),a=m.P.claude.weekly,end=a.end;
 const jittered=fx.history.filter(h=>h.r?.claude?.secondary&&Date.parse(h.r.claude.secondary)!==end&&Math.abs(Date.parse(h.r.claude.secondary)-end)<=2000);
 assert.ok(jittered.length>0,'fixture contains jittered reset strings');
 for(const h of jittered)assert.ok(a.series.some(s=>s[0]===Date.parse(h.t)));
 assert.equal(w.sameReset('2026-11-13T14:00:00Z','2026-11-13T13:59:59Z'),true);assert.equal(w.sameReset('2026-11-13T14:00:05Z','2026-11-13T13:59:59Z'),false);
});
test('stale reading or failed feed pauses forecasts',()=>{
 for(const m of [model(fx,fxNow+31*60000),model(fx,fxNow,true)]){const c=m.P.codex.weekly;assert.equal(c.forecastOk,false);assert.equal(c.status,'stale');assert.match(w.verdict(m),/old, so forecasts are paused/);assert.equal(w.insights(m).length,0);}
});
test('provider error, passed reset and missing reset are explained, not charted',()=>{
 const f=clone(fx);f.providers[0]={id:'codex',name:'Codex',error:'Fetch failed'};
 assert.equal(model(f).P.codex.weekly.state,'error');assert.match(w.tile(model(f),'codex'),/Provider unavailable/);
 const late=model(fx,Date.parse('2026-11-14T00:00:00Z'));assert.equal(late.P.codex.weekly.state,'expired');assert.match(w.runway(late).svg,/No weekly quota/);
 const g=clone(fx);delete g.providers[0].windows[0].resetsAt;assert.equal(model(g).P.codex.weekly.state,'noreset');
});
test('early window has no forecast; zero left is used up, not unknown',()=>{
 const f=clone(fx),cw=f.providers[0].windows[0];cw.resetsAt=new Date(Date.parse(f.providers[0].updatedAt)+(10080-360)*60000).toISOString();cw.usedPercent=3;
 const e=model(f).P.codex.weekly;assert.equal(e.early,true);assert.equal(e.forecastOk,false);assert.equal(e.avg,null);
 const z=clone(fx);z.providers[0].windows[0].usedPercent=100;const zm=model(z);assert.equal(zm.P.codex.weekly.status,'empty');assert.match(w.verdict(zm),/Codex.*used up/);
});
test('a collection gap at the 24h mark withholds the 24h rate',()=>{
 const f=clone(fx),M=Date.parse(f.providers[0].updatedAt),target=M-24*H;
 f.history=f.history.filter(h=>{const t=Date.parse(h.t);return t<target-3*H||t>target+H;});
 const c=model(f).P.codex.weekly;assert.equal(c.r24,null);assert.equal(c.recentKind,'week');assert.ok(c.forecastOk);
});
test('a refill inside history restarts the series',()=>{
 const p={id:'codex',updatedAt:'2026-11-06T16:00:00Z'},win={key:'secondary',usedPercent:5,windowMinutes:10080,resetsAt:'2026-11-13T00:00:00Z'};
 const h=[{t:'2026-11-06T02:00:00Z',u:{codex:{secondary:80}}},{t:'2026-11-06T06:00:00Z',u:{codex:{secondary:2}}},{t:'2026-11-06T10:00:00Z',u:{codex:{secondary:4}}}];
 const s=w.observed(p,win,h,Date.parse(win.resetsAt)-10080*60000,Date.parse(p.updatedAt));assert.deepEqual(s.map(x=>x[1]),[2,4,5]);
});
test('daily points: refill counts new use, quiet sampled day is zero, unsampled day is absent',()=>{
 const h=[{t:'2026-11-03T15:00:00',u:{codex:{secondary:90}}},{t:'2026-11-03T20:00:00',u:{codex:{secondary:95}}},{t:'2026-11-04T12:00:00',u:{codex:{secondary:3}}},{t:'2026-11-04T13:00:00',u:{codex:{secondary:3}}},{t:'2026-11-05T12:00:00',u:{codex:{secondary:3}}},{t:'2026-11-07T12:00:00',u:{codex:{secondary:9}}}];
 assert.deepEqual(w.dailyPoints(h,'codex','secondary').map(d=>[d.date,d.pts]),[['2026-11-03',5],['2026-11-04',3],['2026-11-05',0],['2026-11-07',6]]);
});
