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
 const rows=(history||[]).filter(h=>{const ht=when(h.t),n=h.u?.[p.id]?.[w.key],reset=h.r?.[p.id]?.[w.key];return ht>=start&&ht<=Math.min(t,now)&&pct(n)&&(!reset||when(reset)===q.end);}).map(h=>({t:when(h.t),left:100-h.u[p.id][w.key]})).sort((a,b)=>a.t-b.t);
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
 const rows=p?.windows||[];return [...(!rows.some(w=>w.key==='primary')?[{key:'primary',label:'Session'}]:[]),...(!rows.some(w=>w.key==='secondary')?[{key:'secondary',label:'Weekly'}]:[]),...rows].sort((a,b)=>['primary','secondary','tertiary'].indexOf(a.key)-['primary','secondary','tertiary'].indexOf(b.key));
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
const api={esc,colors,valid,pct,left,when,rounded,status,quota,points,graph,windowRows,money,tokens,costChart,card,countdown};
if(typeof module!=='undefined')module.exports=api;else root.GrindWidgets=api;
})(typeof globalThis!=='undefined'?globalThis:this);
