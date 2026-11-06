const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../dashboard/dashboard.js'),'utf8');
const flush=()=>new Promise(setImmediate);
function boot(storage){
 const nodes=new Map(),requests=[];const node=id=>{if(!nodes.has(id))nodes.set(id,{style:{},classList:{toggle(){}},innerHTML:'',textContent:''});return nodes.get(id);};
 const sandbox={console,URLSearchParams,Date,navigator:{},location:{search:'?feed=/fixture'},GrindWidgets:{},setInterval(){},document:{hidden:false,getElementById:node,addEventListener(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetch:async url=>{requests.push(String(url));return {ok:true,json:async()=>String(url).includes('geocoding-api')?{results:[{name:'Detroit',latitude:42.331,longitude:-83.046}]}:String(url).includes('api.open-meteo')?{current:{temperature_2m:50,weather_code:0},daily:{time:['2026-11-06'],weather_code:[0],temperature_2m_max:[55],temperature_2m_min:[40]}}:{providers:[],history:[]}};}};
 vm.runInNewContext(source,sandbox);return {node,requests};
}
test('new browser defaults to Troy; last selection survives reload and opening Change',async()=>{
 const storage=new Map();let app=boot(storage);await flush();assert.match(app.node('wxPlace').innerHTML,/Troy, MI/);assert.ok(app.requests.some(s=>s.includes('latitude=42.606')));
 app.node('wxChange').onclick();await app.node('wxCity').onkeydown({key:'Enter',target:{value:'Detroit'}});await flush();assert.match(app.node('wxPlace').innerHTML,/Detroit/);
 const saved=storage.get('grind.dashboard.v1');app.node('wxChange').onclick();assert.equal(storage.get('grind.dashboard.v1'),saved);app.node('wxCancel').onclick();await flush();assert.match(app.node('wxPlace').innerHTML,/Detroit/);
 app=boot(storage);await flush();assert.match(app.node('wxPlace').innerHTML,/Detroit/);assert.ok(app.requests.some(s=>s.includes('latitude=42.331')));
});
