// Exercise the real planner against isolated, synthetic stored decisions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const elements = new Map(), listeners = {};
function element(id) {
  if (!elements.has(id)) elements.set(id, {innerHTML:'', textContent:'', dataset:{}, value:'', hidden:false,
    classList:{add(){}, remove(){}, toggle(){}}, append(){}, after(){}, setAttribute(){}, addEventListener(){}, scrollIntoView(){}, focus(){}, querySelectorAll:()=>[], querySelector:()=>null});
  return elements.get(id);
}
const stems = ['active', 'short', 'audio-cut', 'local-cut', 'delete', 'both', 'done', 'short-delete'];
const plan = {considered:Object.fromEntries(stems.map(s => [s, {added:1}])),
  albums:{debut:{name:'Album 1', created:1, order:['active'], cut:['local-cut'], target:12}},
  sessions:{session:{name:'Compare', created:1, members:stems}}};
plan.considered.delete.del = true;
plan.considered.both.del = true;
plan.considered.done = {added:1, del:true, delDone:1};
plan.considered['short-delete'].del = true;
const audio = {v:2, ratings:{'audio-cut':{status:'cut'}, both:{status:'cut'}, short:{status:'short'}, 'short-delete':{status:'short'}}, tracklist:[], pick:{}, custom:{}, collections:{}};
const storage = new Map([['grind.planner.v1', JSON.stringify(plan)], ['grind.audio.v1', JSON.stringify(audio)]]);
const location = {href:'http://localhost/audio/album/', pathname:'/audio/album/', search:'', origin:'http://localhost'};
const history = {state:null, entries:[], replaceState(state){this.state=state;}, pushState(state, _, url){this.state=state;this.entries.push(state);const u=new URL(url);location.href=u.href;location.search=u.search;}};
const context = vm.createContext({console, URL, URLSearchParams, crypto:require('node:crypto').webcrypto,
  navigator:{}, location, history, innerWidth:1200, CSS:{escape:s=>s}, matchMedia:()=>({matches:true}),
  localStorage:{getItem:key=>storage.get(key) || null, setItem:(key,value)=>storage.set(key,value)},
  document:{activeElement:null, body:{classList:{toggle(){}}}, createElement:tag=>element('new-'+tag), getElementById:element, querySelector:element, querySelectorAll:()=>[], addEventListener(){}},
  window:{ALBUM_SONGS:stems.map(s=>({slug:s,title:s,versions:[{title:s,baseTitle:s,writer:'Cue',duration:120}]})), addEventListener:(name, callback)=>{listeners[name]=callback;}},
  ReviewTools:require('../lyrics/review-tools.js'), PlannerSync:require('../audio/album/planner-sync.js'), PlannerStatus:require('../audio/album/planner-status.js'), AlbumSync:require('../lyrics/sync.js'),
  setTimeout:()=>0, clearTimeout(){}, confirm:()=>true});
vm.runInContext(fs.readFileSync(path.join(root,'audio/album/planner.js'),'utf8'),context);
const run = code => vm.runInContext(code,context);
// The old flags were converted on load: each take has one status for the album.
assert.equal(run('live().filter(eligible).length'), 2);
assert.match(element('summary').textContent, /^0 unreviewed for Album 1 · 1 on the album · 2 cut · 3 marked for deletion/);
assert.equal(element('countConsider').textContent, '(0)');
assert.equal(run('statusOf("active")'), 'on');
assert.equal(run('statusOf("short")'), 'short');
assert.equal(run('statusOf("audio-cut")'), 'cut');   // the Audio Board cut became a cut from this album
assert.equal(run('statusOf("local-cut")'), 'cut');
assert.equal(run('statusOf("short-delete")'), 'short');
assert.equal(run('tagged("delete")'), true);
assert.equal(run('bucketPool().length'), 4);           // tagged and deleted takes are outside every bucket
assert.equal(run('PlannerStatus.STATUSES.reduce((n, k) => n + bucketPool().filter(s => statusOf(s) === k).length, 0)'), 4);   // counts add up
run('ui.session="session";renderSessions()');
assert.match(element('sessionDetail').innerHTML,/data-stem="active"/);
assert.doesNotMatch(element('sessionDetail').innerHTML,/data-stem="(?:audio-cut|local-cut|delete|both|done|short-delete)"/);
run('ui.showExcluded=true;renderSessions()');
assert.match(element('sessionDetail').innerHTML,/data-stem="audio-cut"/);
assert.match(element('sessionDetail').innerHTML,/data-stem="delete"/);
assert.doesNotMatch(element('sessionDetail').innerHTML,/data-stem="done"/);
run('setStatus("audio-cut", "unreviewed")');
assert.equal(run('eligible("audio-cut")'),true);
assert.equal(run('statusOf("audio-cut")'),'unreviewed');
run('undo()');
assert.equal(run('statusOf("audio-cut")'),'cut');
const html = run('card("active")');
assert.match(html,/target="_blank"/); // Suno remains an external destination.
assert.doesNotMatch(html,/href="[^"]*(?:lyrics\/|take=)[^"]*" target="_blank"/);
assert.match(html,/returnTo=/);
assert(html.indexOf('class="status-seg"') < html.indexOf('class="media-row"'));
assert.doesNotMatch(html,/class="decision"/);
run('ui.session="";saveView();gotoSession("session")');
assert(history.entries.length >= 1);
listeners.popstate({state:{plannerNavigation:{view:'consider',session:'',album:'debut'}}});
assert.equal(run('ui.view'),'consider');
assert.equal(run('ui.session'),'');
for (const board of ['lyrics','audio']) {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,board,'manifest.webmanifest')));
  assert.equal(manifest.scope,'../');
}
console.log('PASS: one status per take, deletion exclusion, bucket counts, session review toggle, undo, same-window links, navigation history, PWA scope.');
