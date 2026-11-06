const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'../stream-deck/com.scattabraingenius.grind.sdPlugin');
const {render}=require(path.join(base,'render.cjs'));
const now=Date.now(),p={id:'codex',name:'Codex',updatedAt:new Date(now).toISOString(),windows:[{key:'secondary',usedPercent:32,resetsAt:new Date(now+86400000).toISOString(),windowMinutes:10080}]};
test('panel renders both styles, unknown and zero quotas',()=>{for(const view of ['burn','history']){const svg=render({provider:'codex',window:'secondary',view},{providers:[p]},false,now);assert.match(svg,/68%/);assert.doesNotMatch(svg,/NaN|undefined/);}assert.match(render({},null),/Waiting for feed/);assert.match(render({provider:'codex',window:'primary'},{providers:[p]}),/No quota window/)});
test('WebSocket registration, four dial defaults, controls and shared fetch',async()=>{
 let socket,calls=0;const sent=[],timers=[];
 class Socket{constructor(){socket=this;this.readyState=1;this.events={};}addEventListener(e,f){this.events[e]=f;}send(s){sent.push(JSON.parse(s));}}
 const context={require:n=>n==='./render.cjs'?{render}:n==='node:fs'?{readFileSync(){throw Error()},mkdirSync(){},writeFileSync(){}}:require(n),WebSocket:Socket,process:{argv:['node','plugin','-port','1234','-registerEvent','registerPlugin','-pluginUUID','uuid'],exit(){}},Buffer,console,AbortSignal,Date,setInterval:f=>timers.push(f),fetch:async()=>{calls++;return {ok:true,json:async()=>({providers:[p]})}}};
 vm.runInNewContext(fs.readFileSync(path.join(base,'plugin.cjs'),'utf8'),context);
 socket.events.open();await new Promise(setImmediate);assert.deepEqual(sent[0],{event:'registerPlugin',uuid:'uuid'});
 function emit(event,payload={},ctx='one',action='com.scattabraingenius.grind.usage'){socket.events.message({data:JSON.stringify({event,context:ctx,action,payload})});}
 for(let column=0;column<4;column++)emit('willAppear',{controller:'Encoder',coordinates:{column},settings:{}},String(column));
 assert.equal(calls,1);const configs=sent.filter(s=>s.event==='setSettings').slice(-4).map(s=>s.payload);assert.deepEqual(configs.map(s=>[s.provider,s.window]),[['claude','primary'],['claude','secondary'],['codex','primary'],['codex','secondary']]);
 emit('dialRotate',{ticks:1},'2');assert.equal(sent.filter(s=>s.event==='setSettings').at(-1).payload.view,'history');
 emit('touchTap',{},'2');assert.equal(sent.filter(s=>s.event==='setSettings').at(-1).payload.window,'secondary');
 emit('dialDown',{},'2');assert.equal(calls,1);
 emit('willAppear',{settings:{}},'key','com.scattabraingenius.grind.dashboard');emit('keyDown',{},'key');assert.equal(sent.at(-1).event,'openUrl');
 assert.ok(sent.some(s=>s.event==='setFeedback'&&s.payload.canvas.startsWith('data:image/svg+xml;base64,')));
 });
