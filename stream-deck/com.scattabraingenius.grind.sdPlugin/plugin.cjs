'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {render}=require('./render.cjs');
const FEED='https://gist.githubusercontent.com/scattabraingenius/994158e57243b2b3faa16adc029f0e0d/raw/usage.json';
const DASHBOARD='https://scattabraingenius.github.io/s2g/dash/';
const cache=path.join(os.homedir(),'.grind-streamdeck','usage.json');
let feed=null,failed=false,pending=null,lastRequest=0;const actions=new Map();
try{feed=JSON.parse(fs.readFileSync(cache,'utf8'));}catch{}
const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i]]=process.argv[i+1];
const socket=new WebSocket(`ws://127.0.0.1:${args['-port']}`);
function send(event,context,payload){if(socket.readyState===1)socket.send(JSON.stringify({event,...(context?{context}:{}),...(payload?{payload}:{})}));}
function draw(context){const a=actions.get(context);if(!a||a.action.endsWith('.dashboard'))return;send('setFeedback',context,{canvas:'data:image/svg+xml;base64,'+Buffer.from(render(a.settings,feed,failed)).toString('base64')});}
function drawAll(){for(const ctx of actions.keys())draw(ctx);}
async function refresh(){
 if(pending)return pending;if(Date.now()-lastRequest<10000)return;lastRequest=Date.now();
 pending=(async()=>{try{
  const r=await fetch(FEED+'?t='+Date.now(),{signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Feed unavailable');
  const value=await r.json();if(!Array.isArray(value.providers))throw Error('Invalid feed');
  feed=value;failed=false;
  try{fs.mkdirSync(path.dirname(cache),{recursive:true});fs.writeFileSync(cache,JSON.stringify(value));}catch{}
 }catch{failed=true;}finally{drawAll();pending=null;}})();return pending;
}
socket.addEventListener('open',()=>{socket.send(JSON.stringify({event:args['-registerEvent'],uuid:args['-pluginUUID']}));refresh();});
socket.addEventListener('message',event=>{let e;try{e=JSON.parse(event.data);}catch{return;}
 const ctx=e.context;
 if(e.event==='willAppear'){const column=e.payload.coordinates?.column||0;const defaults={provider:column<2?'claude':'codex',window:column%2?'secondary':'primary',view:'burn'};actions.set(ctx,{action:e.action,settings:{...defaults,...e.payload.settings}});send('setSettings',ctx,actions.get(ctx).settings);draw(ctx);refresh();}
 if(e.event==='willDisappear')actions.delete(ctx);
 if(e.event==='didReceiveSettings'&&actions.has(ctx)){actions.get(ctx).settings={...actions.get(ctx).settings,...e.payload.settings};draw(ctx);}
 const a=actions.get(ctx);if(!a)return;
 if(e.event==='keyDown'&&a.action.endsWith('.dashboard'))send('openUrl',null,{url:DASHBOARD});
 if(e.event==='dialDown')refresh();
 if(e.event==='touchTap'||e.event==='dialRotate'){
  if(e.event==='touchTap')a.settings.window=a.settings.window==='primary'?'secondary':'primary';
  else if(Math.abs(e.payload.ticks||0)%2)a.settings.view=a.settings.view==='burn'?'history':'burn';
  send('setSettings',ctx,a.settings);draw(ctx);
 }
});
socket.addEventListener('close',()=>process.exit(0));
socket.addEventListener('error',()=>{console.error('Stream Deck connection failed');process.exit(1);});
setInterval(refresh,120000);setInterval(drawAll,60000);
