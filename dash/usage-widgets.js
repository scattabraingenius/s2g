/* Shared quota and cost presentation for The Grind dashboard and Stream Deck. */
(function(root){
'use strict';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors={codex:'#4C98E8',claude:'#D4724A'};
const valid=n=>typeof n==='number' && Number.isFinite(n) && n>=0;
const pct=n=>valid(n)&&n<=100;
const when=s=>Date.parse(s)||0;
const left=w=>pct(w?.usedPercent)?100-w.usedPercent:null;
const rounded=n=>Math.round(n*10)/10;
const ago=(ms)=>ms<60000?'just now':`${Math.floor(ms/60000)}m ago`;
const countdown=(ms)=>ms<=0?'reset due':ms>=86400000?`${Math.floor(ms/86400000)}d ${Math.floor(ms%86400000/3600000)}h`:ms>=3600000?`${Math.floor(ms/3600000)}h ${Math.floor(ms%3600000/60000)}m`:`${Math.ceil(ms/60000)}m`;
function status(p,feed,now=Date.now(),failed=false){
 const t=when(p?.updatedAt); const old=!t||now-t>1800000||t>now+60000;
 return {t,stale:old||failed,text:p?.error?'Provider unavailable':failed?'Feed offline · cached':!t?'Update time unavailable':old?`Stale · ${ago(Math.max(0,now-t))}`:`Updated ${ago(Math.max(0,now-t))}`};
}
function quota(w,now=Date.now()){
 const n=left(w), end=when(w?.resetsAt), span=w?.windowMinutes*60000;
 const expired=!!end&&end<=now;
 const expected=end&&span>0?Math.max(0,Math.min(100,(end-now)/span*100)):null;
 return {left:n,end,span,expired,expected,pace:n==null||expected==null||expired?'Pace unavailable':Math.abs(n-expected)<3?'On pace':n>expected?`${Math.round(n-expected)}% in reserve`:`${Math.round(expected-n)}% over pace`};
}
function points(p,w,history,now){
 const q=quota(w,now),t=when(p.updatedAt),start=q.end-q.span;
 if(q.left==null||!q.end||!(q.span>0)||!t||t<start||t>q.end||q.expired)return [];
 const rows=(history||[]).filter(h=>{const ht=when(h.t),n=h.u?.[p.id]?.[w.key],reset=h.r?.[p.id]?.[w.key];return ht>=start&&ht<=Math.min(t,now)&&pct(n)&&(!reset||sameReset(reset,q.end));}).map(h=>({t:when(h.t),left:100-h.u[p.id][w.key]})).sort((a,b)=>a.t-b.t);
 // Old feeds have no reset ID. Drop observations before the most recent quota refill.
 let cut=0;for(let i=1;i<rows.length;i++)if(rows[i].left>rows[i-1].left+1)cut=i;
 const out=rows.slice(cut).filter(h=>h.t<t);out.push({t,left:q.left});return out;
}
function graph(p,w,history,now=Date.now(),compact=false){
 const q=quota(w,now),pts=points(p,w,history,now),width=compact?112:300,height=compact?65:115;
 if(!pts.length)return `<div class="empty">${q.expired?'Awaiting new quota window':'No chart data'}</div>`;
 const x=t=>4+(t-(q.end-q.span))/q.span*(width-8),y=n=>5+(100-n)/100*(height-20);
 let d=`M${x(pts[0].t)} ${y(pts[0].left)}`;for(const pt of pts.slice(1))d+=` H${x(pt.t)} V${y(pt.left)}`;
 const last=pts.at(-1);
 return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(p.name)} ${esc(w.label)} ${rounded(q.left)} percent left. Last measured ${esc(new Date(last.t).toLocaleString())}"><line x1="4" y1="${y(50)}" x2="${width-4}" y2="${y(50)}" stroke="#372950"/><path d="M4 ${y(100)} L${width-4} ${y(0)}" fill="none" stroke="#A599BF" stroke-dasharray="3 3"/><path d="${d} V${y(0)} H${x(pts[0].t)} Z" fill="${colors[p.id]}" opacity=".13"/><path d="${d}" fill="none" stroke="${colors[p.id]}" stroke-width="2"/><circle cx="${x(last.t)}" cy="${y(last.left)}" r="3" fill="${colors[p.id]}"/><text x="4" y="${height-1}" fill="#A599BF" font-size="8">100% → 0% at reset</text></svg>`;
}
function windowRows(p){
 // Only windows the provider actually reports. Codex has no session window, so none is drawn.
 return [...(p?.windows||[])].sort((a,b)=>['primary','secondary','tertiary'].indexOf(a.key)-['primary','secondary','tertiary'].indexOf(b.key));
}
const money=n=>valid(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n):'—';
const tokens=n=>valid(n)?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n):'—';
function costChart(c,compact=false){
 const rows=(c?.daily||[]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.date)&&valid(d.costUSD)).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30);
 if(c?.error||!rows.length)return `<div class="empty">Daily history unavailable${c?.error?' · local cost scan failed':''}</div>`;
 const max=Math.max(...rows.map(d=>d.costUSD),.01),W=300,H=compact?58:112,step=(W-8)/rows.length;
 return `<svg viewBox="0 0 ${W} ${H+18}" role="img" aria-label="Daily API price estimates, ${rows.length} reported days; not billed"><g fill="currentColor">${rows.map((d,i)=>`<rect x="${4+i*step}" y="${H-d.costUSD/max*(H-5)}" width="${Math.max(1,step-3)}" height="${d.costUSD/max*(H-5)}" rx="2"><title>${esc(d.date)} · ${money(d.costUSD)} · ${tokens(d.tokens)} tokens</title></rect>`).join('')}</g><g fill="#A599BF" font-size="9"><text x="4" y="${H+14}">${esc(rows[0].date.slice(5))}</text><text x="296" y="${H+14}" text-anchor="end">${esc(rows.at(-1).date.slice(5))}</text></g></svg>`;
}
function card(p,type,feed,now=Date.now(),failed=false){
 const s=status(p,feed,now,failed),name=p?.name||p?.id||'Provider';
 const head=`<header class="widget-head"><b><i></i>${esc(name)}</b><span>${type==='burn'?'Session & weekly':'Usage & history'}</span></header><div class="widget-status ${s.stale||p.error?'warn':''}">${esc(s.text)}</div>`;
 if(p.error)return head+`<p class="empty">Usage unavailable. Check CodexBar on the Mac.</p>`;
 let html=head+windowRows(p).map(w=>{const q=quota(w,now),n=q.left;return `<div class="quota-row ${type==='burn'?'with-chart':''}"><div><div class="quota-label">${esc(w.label)}</div><div class="quota-value">${n==null?'—':rounded(n)+'%'} <small>${n==null?'No data':'left'}</small></div><div class="quota-reset">${q.end?esc(q.expired?'Reset passed · awaiting update':'Resets in '+countdown(q.end-now)):'Reset unavailable'}</div>${type==='burn'?`<div class="quota-pace">${esc(q.pace)}</div>`:n==null?'':`<div class="bar" role="img" aria-label="${rounded(n)} percent left"><div class="bar-fill" style="width:${n}%"></div></div>`}</div>${type==='burn'?graph(p,w,feed?.history,now):''}</div>`;}).join('');
 if(type==='burn')return html+'<div class="widget-note">Solid: measured % left · dashed: even pace</div>';
 const c=p.cost,cs=c?.updatedAt?` · ${esc(ago(Math.max(0,now-when(c.updatedAt))))}`:'';
 html+=`<div class="cost-summary"><div><span>Today</span><b>${money(c?.todayCostUSD)} <small>· ${tokens(c?.todayTokens)} tokens</small></b></div><div><span>30 days</span><b>${money(c?.totalCostUSD)} <small>· ${tokens(c?.totalTokens)} tokens</small></b></div></div><div class="history-label">Daily activity${cs}</div><div class="cost-chart">${costChart(c)}</div><div class="widget-note">Local logs · API price estimates, not billed</div>`;
 return html;
}
/* ------------------------------------------------------------------------------------------
   Runway: one weekly chart for both providers, per-provider forecasts and plain-language advice.
   Every forecast is a straight line at a measured rate. Two rates bracket the forecast: the
   last 24 hours and the window average. Nothing here knows how much work a percent is worth.
   ------------------------------------------------------------------------------------------ */
const HOUR=3600000,DAY=86400000,STALE_MS=1800000;
const GAP_MS=75*60000;          // the collector writes at least hourly while it runs
const RESET_JITTER_MS=2000;     // Claude reports the same reset as hh:59:59 or hh:00:00
function sameReset(a,b){const x=typeof a==='number'?a:when(a),y=typeof b==='number'?b:when(b);return !!x&&!!y&&Math.abs(x-y)<=RESET_JITTER_MS;}
const f1=n=>n==null||!Number.isFinite(n)?'—':(Math.round(n*10)/10).toFixed(1);
const fmtWhen=t=>new Date(t).toLocaleString([],{weekday:'short',hour:'numeric',minute:'2-digit'});
const fmtClock=t=>new Date(t).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
const fmtWeekday=(t,style='long')=>new Date(t).toLocaleDateString([],{weekday:style});
const fmtDate=t=>new Date(t).toLocaleDateString([],{month:'short',day:'numeric'});
const span$=ms=>ms<=0?'0m':countdown(ms);

/* Samples of one window since its last refill, ending with the provider's own reading. */
function observed(p,w,history,start,M){
 const rows=(history||[]).map(h=>({t:when(h.t),u:h.u?.[p.id]?.[w.key],r:h.r?.[p.id]?.[w.key]}))
  .filter(h=>h.t>=start&&h.t<M&&pct(h.u)&&(!h.r||sameReset(h.r,w.resetsAt)))
  .sort((a,b)=>a.t-b.t).map(h=>[h.t,h.u]);
 rows.push([M,w.usedPercent]);
 let cut=0;for(let i=1;i<rows.length;i++)if(rows[i][1]<rows[i-1][1]-1)cut=i;
 return rows.slice(cut);
}

/* The Round 3 formulas. `now` is the wall clock; M is when CodexBar took the reading. */
function forecast(p,w,history,now=Date.now(),failed=false){
 const used=w?.usedPercent,end=when(w?.resetsAt),span=(w?.windowMinutes||0)*60000,M=when(p?.updatedAt);
 const m={p,w,id:p?.id,key:w?.key,used,L:pct(used)?100-used:null,end,span,M,weekly:span>=DAY,state:'ok'};
 if(p?.error)return {...m,state:'error',reason:'Provider unavailable · check CodexBar on the Mac'};
 if(m.L==null)return {...m,state:'nodata',reason:'No reading for this window'};
 if(!end||!(span>0))return {...m,state:'noreset',reason:'Reset time unavailable'};
 if(end<=now)return {...m,state:'expired',reason:'Reset passed · awaiting the new window'};
 const start=end-span;
 if(!M||M>now+60000||M<start||M>=end)return {...m,start,state:'badtime',reason:'Reading time unavailable'};
 Object.assign(m,{start,E:(M-start)/span,hr:(end-M)/HOUR,elapsedH:(M-start)/HOUR,age:Math.max(0,now-M)});
 m.ideal=100*(1-m.E);m.gap=m.L-m.ideal;m.safe=m.L/m.hr;
 m.series=observed(p,w,history,start,M);
 m.stale=!!failed||m.age>STALE_MS;
 m.early=m.elapsedH<(m.weekly?12:0.5);
 m.avg=m.early?null:used/m.elapsedH;
 // Rate from the last sample at or before the target time. A sample far older than the target
 // means collection had a gap there, so the rate is not offered.
 const rate=(hours,minSpan)=>{const target=M-hours*HOUR;if(target<start)return null;let b=null;
  for(const s of m.series)if(s[0]<=target)b=s;
  if(!b||target-b[0]>GAP_MS)return null;const h=(M-b[0])/HOUR;if(h<minSpan)return null;
  return {r:Math.max(0,(used-b[1])/h),d:used-b[1],hours:h};};
 m.r24=m.weekly?rate(24,12):null;m.r6=m.weekly?rate(6,5):null;
 const proj=r=>r==null?null:{r,left:Math.max(0,m.L-r*m.hr),out:m.L<=0?M:r>0&&m.L/r<m.hr?M+m.L/r*HOUR:null};
 m.recent=proj(m.r24?m.r24.r:m.avg);m.week=proj(m.avg);m.recentKind=m.r24?'24h':'week';
 m.forecastOk=!m.stale&&!m.early&&!!m.recent&&!!m.week;
 m.status=m.L<=0?'empty':m.stale?'stale':m.early?'early':!m.forecastOk?'pace'
  :m.recent.out&&m.end-m.recent.out>12*HOUR?'bad':m.recent.out||m.week.out?'warn':m.gap>=3?'good':'pace';
 return m;
}

/* Window choice by length, never by slot name: weekly ≥ 6 days, session ≤ 10 hours. */
function usageModel(feed,now=Date.now(),failed=false){
 const P={},ids=[];
 for(const id of ['codex','claude']){
  const p=(feed?.providers||[]).find(x=>x.id===id);if(!p)continue;ids.push(id);
  const ws=p.windows||[],wk=ws.find(w=>w.windowMinutes>=8640),se=ws.find(w=>w.windowMinutes>0&&w.windowMinutes<=600);
  P[id]={p,weekly:p.error||!wk?forecast(p,wk||{},feed?.history,now,failed):forecast(p,wk,feed?.history,now,failed),
   session:se&&!p.error?forecast(p,se,feed?.history,now,failed):null};
 }
 return {now,failed,ids,P,history:feed?.history||[],ready:ids.length>0};
}
const NAMES={codex:'Codex',claude:'Claude'};
const ok=m=>m&&m.state==='ok';
function spare(m){const a=Math.round(Math.min(m.recent.left,m.week.left)),b=Math.round(Math.max(m.recent.left,m.week.left));return a===b?`${a}%`:`${a}–${b}%`;}

/* One sentence: which provider needs attention and what to do about it. */
function verdict(model){
 const ms=model.ids.map(id=>model.P[id].weekly).filter(ok);
 const nm=m=>`<b class="v-${m.id}">${NAMES[m.id]}</b>`;
 const sess=model.P.claude?.session;
 const sessNote=ok(sess)&&sess.L<=0&&!sess.stale?` Claude's session is used up until ${esc(fmtClock(sess.end))}.`:'';
 if(!ms.length)return model.ready?'Weekly quota is unavailable right now.':'Waiting for usage data…';
 const old=ms.filter(m=>m.stale);
 if(old.length)return `Usage data is ${esc(span$(Math.max(...old.map(m=>m.age))))} old, so forecasts are paused until the Mac reports again.`;
 const rank={empty:0,bad:1,warn:2,early:3,pace:4,good:5};
 ms.sort((a,b)=>rank[a.status]-rank[b.status]||(a.recent?.left??99)-(b.recent?.left??99));
 const say=m=>m.status==='empty'?`${nm(m)} is used up until ${esc(fmtWhen(m.end))}.`
  :m.status==='bad'?`${nm(m)} runs out about ${esc(span$(m.end-m.recent.out))} before its reset at your recent rate: keep it under ${f1(m.safe*24)}% a day to reach ${esc(fmtWeekday(m.end))}.`
  :m.status==='warn'?`${nm(m)} is tight: keep it under ${f1(m.safe*24)}% a day to reach ${esc(fmtWeekday(m.end))}'s reset.`
  :m.status==='early'?`${nm(m)}: too early in the week to forecast.`
  :`${nm(m)} ${m.status==='good'?'has room':'is on pace'}, projected to finish with ${spare(m)} left.`;
 if(ms.every(m=>m.status==='good'||m.status==='pace')&&ms.length>1)
  return `Both last to reset. ${ms.map(m=>`${nm(m)} is projected to finish with ${spare(m)} left`).join(', ')}.`+sessNote;
 return ms.map(say).join(' ')+sessNote;
}

/* Up to three, most serious first. Each carries the numbers it rests on. */
function insights(model){
 const out=[];
 for(const id of model.ids){
  const m=model.P[id].weekly;if(!ok(m)||!m.forecastOk)continue;const n=NAMES[id];
  if(m.recent.out&&m.L>0)out.push({sev:m.status==='bad'?0:1,kind:m.status,text:`${n} runs out about ${span$(m.end-m.recent.out)} before its reset at your ${m.recentKind==='24h'?'last-24h':'week-average'} rate. Staying under ${f1(m.safe*24)}%/day gets it to ${fmtWhen(m.end)}.`,ev:`${m.recentKind==='24h'?'24h':'week avg'} ${f1(m.recent.r*24)}%/day · ${Math.round(m.L)}% left · ${span$(m.end-m.M)} to reset`});
  if(m.r24&&m.avg>m.safe*1.15&&m.r24.r<=m.safe*1.1)out.push({sev:2,kind:'good',text:`${n} has slowed. The last 24h is close to what it can sustain, after a heavier start to the week.`,ev:`24h ${f1(m.r24.r*24)}%/day · week avg ${f1(m.avg*24)}%/day · budget ${f1(m.safe*24)}%/day`});
  if(m.r6&&m.r24&&m.r24.r>0&&m.r6.r>=1.5*m.r24.r&&m.r6.d>=4)out.push({sev:1.7,kind:'warn',text:`${n} sped up: ${m.r6.d} points in the last 6h, ${f1(m.r6.r/m.r24.r)}× your 24h rate.`,ev:`6h ${f1(m.r6.r*24)}%/day pace · 24h ${f1(m.r24.r*24)}%/day · budget ${f1(m.safe*24)}%/day`});
  const rc=m.p.resetCredits;
  if(rc?.available>0&&(m.recent.out||m.week.out))out.push({sev:1.5,kind:'info',text:`${rc.available} free ${n} reset${rc.available>1?'s are':' is'} available if you hit the limit before ${fmtWeekday(m.end)}.`,ev:`CodexBar "Full reset" credit${rc.available>1?'s':''} · next expires ${fmtDate(when(rc.nextExpiresAt))}`});
 }
 const tight=model.ids.map(id=>model.P[id].weekly).filter(m=>ok(m)&&m.forecastOk&&(m.recent.out||m.week.out));
 const roomy=model.ids.map(id=>model.P[id].weekly).filter(m=>ok(m)&&m.forecastOk&&!m.recent.out&&!m.week.out);
 if(tight.length&&roomy.length)out.push({sev:1.8,kind:'good',text:`${roomy.map(m=>NAMES[m.id]).join(' and ')} is projected to have weekly quota left at reset; ${tight.map(m=>NAMES[m.id]).join(' and ')} is not. This compares quota only, not which tool suits a task.`,ev:roomy.map(m=>`${NAMES[m.id]} ${spare(m)} left at reset`).join(' · ')});
 return out.sort((a,b)=>a.sev-b.sev).slice(0,3);
}
function insightsHtml(model){
 const sym={bad:'■',warn:'▲',good:'●',info:'◆',empty:'■'};
 return insights(model).map(i=>`<li class="ins-${i.kind}"><span aria-hidden="true">${sym[i.kind]||'◆'}</span><span>${esc(i.text)}<small>${esc(i.ev)}</small></span></li>`).join('');
}

/* The weekly chart. Real clock on x; each provider keeps its own start, even-pace line and reset. */
function runway(model,W=600,show='both'){
 const all=model.ids.map(id=>model.P[id].weekly).filter(ok);
 if(!all.length)return {svg:'<div class="empty">No weekly quota window to chart.</div>'};
 const vis=all.filter(m=>show==='both'||show===m.id);
 const H=W<560?230:280,pad={l:38,r:14,t:14,b:26};
 const t0=Math.min(...all.map(m=>m.start)),t1=Math.max(...all.map(m=>m.end));
 const X=t=>pad.l+(t-t0)/(t1-t0)*(W-pad.l-pad.r),Y=v=>pad.t+(100-v)/100*(H-pad.t-pad.b);
 let g='';
 for(const v of [0,50,100])g+=`<line x1="${pad.l}" x2="${W-pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"${v===50?' stroke-dasharray="2 4"':''}/><text x="${pad.l-6}" y="${Y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted-2)">${v}%</text>`;
 const first=new Date(t0);first.setHours(24,0,0,0);
 for(let t=first.getTime();t<t1;){const n=new Date(t);n.setDate(n.getDate()+1);const nt=n.getTime(),mid=t+(nt-t)/2;
  g+=`<line x1="${X(t)}" x2="${X(t)}" y1="${pad.t}" y2="${H-pad.b}" stroke="var(--line)" opacity=".55"/>`;
  if(X(mid)<W-pad.r-10)g+=`<text x="${X(mid)}" y="${H-8}" text-anchor="middle" font-size="11" fill="var(--muted-2)">${esc(fmtWeekday(mid,'short'))}</text>`;t=nt;}
 let marks='';const labels=[];
 for(const m of vis){
  const c=colors[m.id],line=a=>a.map(([t,v],i)=>`${i?'L':'M'}${X(t)} ${Y(v)}`).join(' ');
  let solid='',gaps='';const s=m.series;
  for(let i=0;i<s.length;i++){const [t,u]=s[i];
   if(!i){solid+=`M${X(t)} ${Y(100-u)}`;continue;}
   const [pt,pu]=s[i-1];
   if(t-pt>GAP_MS){gaps+=`M${X(pt)} ${Y(100-pu)} H${X(t)}`;solid+=` M${X(t)} ${Y(100-pu)} V${Y(100-u)}`;}
   else solid+=` H${X(t)} V${Y(100-u)}`;}
  marks+=`<line x1="${X(m.start)}" y1="${Y(100)}" x2="${X(m.end)}" y2="${Y(0)}" stroke="${c}" stroke-width="1.5" stroke-dasharray="5 4" opacity=".55"/>`;
  if(m.forecastOk){
   const bound=pr=>pr.out?[[m.M,m.L],[pr.out,0],[m.end,0]]:[[m.M,m.L],[m.end,pr.left]];
   const a=bound(m.recent),b=bound(m.week);
   marks+=`<polygon points="${[...a,...b.slice().reverse()].map(([t,v])=>`${X(t)},${Y(v)}`).join(' ')}" fill="${c}" opacity=".16"/><path d="${line(a)}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="1.5 3"/><path d="${line(b)}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="1.5 3" opacity=".7"/>`;
  }
  if(gaps)marks+=`<path d="${gaps}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="2 4" opacity=".7"/>`;
  marks+=`<path d="${solid}" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/><path d="M${X(m.end)-6} ${pad.t-1} h12 l-6 8 z" fill="${c}"/><line x1="${X(m.end)}" x2="${X(m.end)}" y1="${pad.t+7}" y2="${H-pad.b}" stroke="${c}" opacity=".5"/><circle cx="${X(m.M)}" cy="${Y(m.L)}" r="4.5" fill="${m.stale?'var(--card)':c}" stroke="${m.stale?c:'var(--card)'}" stroke-width="2"/>`;
  labels.push({m,y:Y(m.L)});
 }
 labels.sort((a,b)=>a.y-b.y);for(let i=1;i<labels.length;i++)if(labels[i].y-labels[i-1].y<15)labels[i].y=labels[i-1].y+15;
 for(const {m,y} of labels)marks+=`<text x="${X(m.M)-9}" y="${y+4}" text-anchor="end" font-size="12" font-weight="600" fill="var(--ink)" stroke="var(--card)" stroke-width="3" paint-order="stroke">${NAMES[m.id]} ${Math.round(m.L)}%</text>`;
 const nx=X(Math.min(t1,Math.max(t0,model.now)));
 const svg=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weekly quota left. ${esc(vis.map(m=>`${NAMES[m.id]} ${Math.round(m.L)} percent left, resets ${fmtWhen(m.end)}`).join('; '))}.">${g}<line x1="${nx}" x2="${nx}" y1="${pad.t}" y2="${H-pad.b}" stroke="var(--ink)" opacity=".35"/><text x="${nx+4}" y="${H-pad.b-6}" font-size="11" fill="var(--muted)">now</text>${marks}<line class="xhair" x1="0" x2="0" y1="${pad.t}" y2="${H-pad.b}" stroke="var(--ink)" opacity="0"/></svg>`;
 return {svg,t0,t1,W,pad};
}
function runwayTip(model,t,show='both'){
 let html=`<div class="k">${esc(fmtWhen(t))}</div>`;
 for(const m of model.ids.map(id=>model.P[id].weekly).filter(ok)){
  if(!(show==='both'||show===m.id))continue;let val;
  if(t<m.start)val='window not started';else if(t>m.end)val='after reset';
  else if(t<=m.M){let u=null;for(const s of m.series)if(s[0]<=t)u=s[1];val=u==null?'before first reading':`<b>${100-u}%</b> left`;}
  else if(m.forecastOk){const h=(t-m.M)/HOUR,a=Math.max(0,m.L-m.week.r*h),b=Math.max(0,m.L-m.recent.r*h);val=`<b>${Math.round(Math.min(a,b))}–${Math.round(Math.max(a,b))}%</b> projected`;}
  else val='no forecast';
  const ev=t>=m.start&&t<=m.end?` <span class="k">· even pace ${Math.round(100*(1-(t-m.start)/m.span))}%</span>`:'';
  html+=`<div><span style="color:${colors[m.id]}">●</span> ${NAMES[m.id]}: ${val}${ev}</div>`;
 }
 return html;
}
function runwayLegend(model,show='both'){
 const vis=model.ids.map(id=>model.P[id].weekly).filter(m=>ok(m)&&(show==='both'||show===m.id));
 return vis.map(m=>`<span><i class="sw" style="border-color:${colors[m.id]}"></i>${NAMES[m.id]} measured</span>`).join('')
  +'<span><i class="sw dash"></i>even pace</span><span><i class="sw band"></i>forecast: 24h rate ↔ week avg</span>'
  +vis.map(m=>`<span><span style="color:${colors[m.id]}">▼</span>${NAMES[m.id]} resets ${esc(fmtWhen(m.end))}</span>`).join('');
}

/* Provider tile: the numbers behind the verdict. */
const STATUS={empty:['bad','Used up'],bad:['bad','Runs out early'],warn:['warn','Tight'],good:['good','Has room'],pace:['','On pace'],early:['','Too early to judge'],stale:['warn','Data is old']};
function paceBar(m,cls=''){
 const exp=Math.min(100,Math.max(0,100-m.ideal));
 return `<div class="pbar ${cls}" role="img" aria-label="${m.used}% used; even pace expects ${Math.round(exp)}% by now"><div class="fill" style="width:${m.used}%"></div><div class="tick" style="left:calc(${exp}% - 1px)"></div></div>`;
}
function forecastLine(m){
 if(m.stale)return `<p class="fc k">Forecast paused: reading is ${esc(span$(m.age))} old.</p>`;
 if(m.early||!m.forecastOk)return '<p class="fc k">Too early in the window to forecast.</p>';
 if(m.L<=0)return `<p class="fc">Used up. Resets <b>${esc(fmtWhen(m.end))}</b>.</p>`;
 const r=m.recent,a=m.week;
 if(!r.out&&!a.out)return `<p class="fc"><span class="k">At both rates it lasts to reset, ending with</span> <b>${spare(m)}</b> <span class="k">left.</span></p>`;
 const part=(lab,pr)=>pr.out?`${lab}: runs out <b>${esc(fmtWhen(pr.out))}</b> <span class="k">(${span$(m.end-pr.out)} early)</span>`:`${lab}: lasts, <b>${Math.round(pr.left)}%</b> left`;
 return `<p class="fc">${part(m.recentKind==='24h'?'At 24h rate':'At week avg',r)}${m.recentKind==='24h'?'<br>'+part('At week avg',a):''}</p>`;
}
function tile(model,id){
 const {p,weekly:m,session:s}=model.P[id],c=colors[id];
 let h=`<article class="rw-prov" style="--pc:${c}"><div class="prov-top"><span class="pname"><i></i>${NAMES[id]} <span>weekly</span></span>`;
 if(!ok(m))return h+`</div><p class="empty">${esc(m.reason)}</p></article>`;
 const [cls,label]=STATUS[m.status];
 const gapTxt=m.early?'':Math.abs(m.gap)<3?'on pace':m.gap>0?`${Math.round(m.gap)} pts in reserve`:`${Math.round(-m.gap)} pts over pace`;
 h+=`<span class="tag ${cls}">${label}</span></div>
  <div class="big">${Math.round(m.L)}%<small> left${gapTxt?' · '+gapTxt:''}</small></div>
  <div class="reset">Resets ${esc(fmtWhen(m.end))} · in ${span$(m.end-model.now)} · ${Math.round(m.E*100)}% of week gone</div>
  ${paceBar(m)}<div class="pbar-cap"><span>used ${m.used}%</span><span>tick = even pace</span></div>
  <div class="rates"><div class="rate key"><div class="k">Budget</div><div class="v">${f1(m.safe*24)}<small>%/d</small></div></div><div class="rate"><div class="k">Last 24h</div><div class="v">${m.r24?f1(m.r24.r*24):'—'}<small>%/d</small></div></div><div class="rate"><div class="k">Week avg</div><div class="v">${f1(m.avg==null?null:m.avg*24)}<small>%/d</small></div></div></div>
  ${forecastLine(m)}`;
 if(s){
  if(!ok(s))h+=`<div class="mini"><div class="mini-row"><span><b>Session</b> ${esc(s.reason)}</span></div></div>`;
  else{const sr=s.forecastOk&&s.avg!=null?Math.max(0,s.L-s.avg*s.hr):null;
   h+=`<div class="mini"><div class="mini-row"><span><b>Session</b> ${s.used}% used · ${Math.round(s.E*100)}% of 5h gone</span><span>resets ${esc(fmtClock(s.end))}</span></div>${paceBar(s,'thin')}<div class="mini-row"><span>${s.L<=0?'Used up until reset':s.stale?'Reading is old':sr==null?'Too early to forecast':sr>0?`At this session's pace: ${Math.round(sr)}% left at reset`:'At this session\'s pace it runs out before reset'}</span></div></div>`;}
 }
 const rc=p.resetCredits;
 if(rc?.available>0)h+=`<div class="credit"><b>${rc.available} free full reset${rc.available>1?'s':''}</b> available${rc.nextExpiresAt?` · next expires ${esc(fmtDate(when(rc.nextExpiresAt)))}`:''}</div>`;
 return h+'</article>';
}

/* Quota points used per local day. A day with samples but no change is a real zero; a day with
   no samples at all is left out. Points that accrued during a gap land on the day it ended. */
function dailyPoints(history,id,key){
 const rows=(history||[]).map(h=>[when(h.t),h.u?.[id]?.[key]]).filter(r=>r[0]&&pct(r[1])).sort((a,b)=>a[0]-b[0]);
 const dk=t=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
 const days=new Map();if(rows.length)days.set(dk(rows[0][0]),0);
 for(let i=1;i<rows.length;i++){const [t,u]=rows[i],prev=rows[i-1][1],k=dk(t);if(!days.has(k))days.set(k,0);
  if(u>prev)days.set(k,days.get(k)+u-prev);else if(u<prev-1)days.set(k,days.get(k)+u);}
 const list=[...days].map(([date,pts])=>({date,pts}));
 if(list.length)list[0].partial=true;
 if(list.length&&list.at(-1).date===dk(Date.now()))list.at(-1).partial=true;
 return list;
}
function dailyChart(model,W=600){
 const H=64;let html='';
 const rows=model.ids.map(id=>{const m=model.P[id].weekly;return {id,m,days:ok(m)?dailyPoints(model.history,id,m.key).slice(-8):[]};}).filter(r=>r.days.length);
 if(!rows.length)return '<div class="empty">Not enough history yet.</div>';
 const max=Math.max(20,...rows.flatMap(r=>r.days.map(d=>d.pts)),...rows.map(r=>r.m.forecastOk?r.m.safe*24:0));
 const Y=v=>4+(1-v/max)*(H-4);
 for(const {id,m,days} of rows){
  const n=days.length,step=(W-8)/n,bw=Math.max(6,Math.min(48,step-6)),top=Math.max(...days.map(d=>d.pts)),bud=m.forecastOk?m.safe*24:null;
  html+=`<div class="sm-title"><span><span style="color:${colors[id]}">●</span> <b>${NAMES[id]}</b> · points of weekly quota per day</span><span>${bud==null?'':`budget now ${f1(bud)}/day`}</span></div><svg viewBox="0 0 ${W} ${H+18}" width="${W}" height="${H+18}" role="img" aria-label="${NAMES[id]} quota points per day: ${esc(days.map(d=>`${d.date} ${d.pts}`).join(', '))}"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--line)"/>`;
  days.forEach((d,i)=>{const x=4+i*step+(step-bw)/2,lab=new Date(d.date+'T12:00:00');
   html+=`<rect x="${x}" y="${Y(d.pts)}" width="${bw}" height="${Math.max(d.pts?2:0,Y(0)-Y(d.pts))}" rx="3" fill="${colors[id]}" opacity="${d.partial?.5:1}"><title>${esc(d.date)}: ${d.pts} points${d.partial?' (partial day)':''}</title></rect>`;
   if(d.pts===top||i===n-1)html+=`<text x="${x+bw/2}" y="${Y(d.pts)-4}" text-anchor="middle" font-size="10" fill="var(--muted)">${d.pts}</text>`;
   html+=`<text x="${x+bw/2}" y="${H+14}" text-anchor="middle" font-size="10" fill="var(--muted-2)">${esc(lab.toLocaleDateString([],{weekday:'narrow'}))}${lab.getDate()}</text>`;});
  if(bud!=null)html+=`<line x1="0" x2="${W}" y1="${Y(bud)}" y2="${Y(bud)}" stroke="var(--ink)" stroke-dasharray="4 4" opacity=".55"/>`;
  html+='</svg>';
 }
 return html;
}
/* Local log tokens, 14 source dates. Source dates are shown as given; a missing date is a gap. */
function tokenChart(model,W=600){
 const H=46;let html='';
 for(const id of model.ids){
  const daily=(model.P[id].p.cost?.daily||[]).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d.date));
  if(!daily.length){html+=`<div class="sm-title"><span><b>${NAMES[id]}</b> · no local log history</span></div>`;continue;}
  const last=daily.map(d=>d.date).sort().at(-1),end=Date.parse(last+'T00:00:00Z');
  const dates=[...Array(14)].map((_,i)=>new Date(end-(13-i)*DAY).toISOString().slice(0,10));
  const map=Object.fromEntries(daily.map(d=>[d.date,d])),logged=dates.filter(d=>map[d]);
  const max=Math.max(1,...logged.map(d=>map[d].tokens||0)),step=(W-8)/14,bw=Math.max(5,Math.min(40,step-5));
  const sum=logged.reduce((s,d)=>s+(valid(map[d].costUSD)?map[d].costUSD:0),0);
  html+=`<div class="sm-title"><span><span style="color:${colors[id]}">●</span> <b>${NAMES[id]}</b> · tokens per day, ${logged.length} of 14 days logged</span><span>≈ ${money(sum)} at API list price</span></div><svg viewBox="0 0 ${W} ${H+4}" width="${W}" height="${H+4}" role="img" aria-label="${NAMES[id]} local log tokens, ${logged.length} of 14 days logged">`;
  dates.forEach((d,i)=>{const r=map[d],x=4+i*step;
   if(!r||!valid(r.tokens)){html+=`<circle cx="${x+bw/2}" cy="${H-2}" r="1.6" fill="var(--muted-2)"><title>${d}: no local log</title></circle>`;return;}
   const h=Math.max(2,r.tokens/max*(H-4));html+=`<rect x="${x}" y="${H-h}" width="${bw}" height="${h}" rx="2" fill="${colors[id]}" opacity=".75"><title>${d}: ${tokens(r.tokens)} tokens · ≈${money(r.costUSD)} estimate</title></rect>`;});
  html+='</svg>';
 }
 return html;
}

const api={esc,colors,valid,pct,left,when,rounded,status,quota,points,graph,windowRows,money,tokens,costChart,card,countdown,
 sameReset,observed,forecast,usageModel,verdict,insights,insightsHtml,runway,runwayTip,runwayLegend,tile,dailyPoints,dailyChart,tokenChart};
if(typeof module!=='undefined')module.exports=api;else root.GrindWidgets=api;
})(typeof globalThis!=='undefined'?globalThis:this);
