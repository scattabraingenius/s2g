const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../dash/dashboard.js'),'utf8');
const flush=()=>new Promise(setImmediate);
function boot(storage,extra={}){
 const nodes=new Map(),requests=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{toggle(){}},innerHTML:'',textContent:''});return nodes.get(id);};
 const sandbox={console,URLSearchParams,Date,navigator:{},location:{search:'?feed=/fixture'},GrindWidgets:{},setInterval(){},...(extra.globals||{}),document:{hidden:false,getElementById:node,addEventListener(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetch:async url=>{requests.push(String(url));return {ok:true,json:async()=>String(url).includes('geocoding-api')?{results:[{name:'Detroit',latitude:42.331,longitude:-83.046}]}:String(url).includes('api.open-meteo')?{current:{temperature_2m:50,weather_code:0},daily:{time:['2026-11-06'],weather_code:[0],temperature_2m_max:[55],temperature_2m_min:[40]},...(extra.hourly||{})}:{providers:[],history:[]}};}};
 vm.runInNewContext(source,sandbox);return {node,requests};
}
test('new browser defaults to Troy; last selection survives reload and opening Change',async()=>{
 const storage=new Map();let app=boot(storage);await flush();assert.match(app.node('wxPlace').innerHTML,/Troy, MI/);assert.ok(app.requests.some(s=>s.includes('latitude=42.606')));
 app.node('wxChange').onclick();await app.node('wxCity').onkeydown({key:'Enter',target:{value:'Detroit'}});await flush();assert.match(app.node('wxPlace').innerHTML,/Detroit/);
 const saved=storage.get('grind.dashboard.v1');app.node('wxChange').onclick();assert.equal(storage.get('grind.dashboard.v1'),saved);app.node('wxCancel').onclick();await flush();assert.match(app.node('wxPlace').innerHTML,/Detroit/);
 app=boot(storage);await flush();assert.match(app.node('wxPlace').innerHTML,/Detroit/);assert.ok(app.requests.some(s=>s.includes('latitude=42.331')));
});
test('hourly slots: the request asks for the four hourly fields and the card shows feels-like and rain',async()=>{
 const time=[],t=[],f=[],r=[],c=[];const day=new Date().toISOString().slice(0,10),next=new Date(Date.now()+864e5).toISOString().slice(0,10);
 for(const d of [day,next])for(let h=0;h<24;h++){time.push(`${d}T${String(h).padStart(2,'0')}:00`);t.push(40+h);f.push(35+h);r.push(h);c.push(61);}
 const app=boot(new Map(),{globals:{GrindHourly:require('../dash/hourly.js')},hourly:{utc_offset_seconds:0,hourly:{time,temperature_2m:t,apparent_temperature:f,precipitation_probability:r,weather_code:c}}});
 await flush();
 const req=app.requests.find(s=>s.includes('api.open-meteo'));
 assert.match(decodeURIComponent(req),/hourly=temperature_2m,apparent_temperature,precipitation_probability,weather_code/);
 const body=app.node('wxBody').innerHTML;
 assert.match(body,/class="wx-slots"/);assert.equal((body.match(/class="wx-slot[ "]/g)||[]).length,4);
 assert.match(body,/Feels \d+°/);assert.match(body,/💧 \d+%/);assert.match(body,/Light rain/);
});
test('without hourly data the card still shows current weather and the 5-day strip',async()=>{
 const app=boot(new Map(),{globals:{GrindHourly:require('../dash/hourly.js')}});await flush();
 const body=app.node('wxBody').innerHTML;assert.match(body,/wx-temp/);assert.doesNotMatch(body,/wx-slots/);
});
