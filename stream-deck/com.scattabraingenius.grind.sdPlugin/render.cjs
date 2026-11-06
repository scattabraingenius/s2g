'use strict';
const G=require('./usage-widgets.js');
function render(settings,feed,failed=false,now=Date.now()){
 const id=settings.provider==='claude'?'claude':'codex',name=id==='claude'?'Cue':'misc';
 const p=feed?.providers?.find(p=>p.id===id),color=G.colors[id],type=settings.view==='history'?'history':'burn';
 const key=settings.window==='primary'?'primary':'secondary',w=p?.windows?.find(w=>w.key===key),q=G.quota(w,now);
 const state=G.status(p,feed,now,failed),bad=state.stale||p?.error;
 const text=(x,y,size,value,fill='#EDE7F6',extra='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${G.esc(value)}</text>`;
 let body=text(8,15,11,`${name} · ${key==='primary'?'Session':'Weekly'}`,color)+text(192,15,8,type==='burn'?'QUOTA':'HISTORY','#A599BF','text-anchor="end"');
 body+=text(8,41,25,!p||p.error||q.left==null?'—':`${G.rounded(q.left)}%`,color)+text(8,54,9,'left','#A599BF');
 if(type==='burn'&&p&&w){
  const graph=G.graph(p,w,feed.history,now,true);
  if(graph.startsWith('<svg'))body+=graph.replace('<svg ','<svg x="84" y="19" width="110" height="58" ');
 }else if(type==='history'&&p?.cost){
  const graph=G.costChart(p.cost,true);if(graph.startsWith('<svg'))body+=graph.replace('<svg ','<svg x="83" y="23" width="110" height="48" ');
  body+=text(8,68,8,`Today ${G.money(p.cost.todayCostUSD)} · 30d ${G.money(p.cost.totalCostUSD)}`,'#A599BF');
 }else if(type==='history')body+=text(85,45,9,'History unavailable','#A599BF');
 body+=text(8,82,9,q.end?G.countdown(q.end-now):'No quota window','#A599BF');
 body+=text(8,95,8,p?.error?'Provider unavailable':!p?'Waiting for feed':bad?state.text:type==='history'?'API estimate · not billed':state.text,bad?'#F2C14E':'#A599BF');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#17111F"/><rect x="0" width="3" height="100" fill="${color}"/><g font-family="Arial, sans-serif">${body}</g></svg>`;
}
module.exports={render};
