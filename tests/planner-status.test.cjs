// One status per take per album: the model, the migration, and its behaviour against the synced store.
// Pure Node, no browser:  node tests/planner-status.test.cjs
const assert = require('node:assert/strict');
const Status = require('../audio/album/planner-status.js');
const Sync = require('../audio/album/planner-sync.js');
const clone = v => JSON.parse(JSON.stringify(v));
const pass = m => console.log('PASS ' + m);

// The catalogue's real "Two People to Mourn" takes, as the owner described them.
const C11 = '697f0d47-91bc-48d2-9af7-7429347c7885', M12 = 'fe229f07-4062-4cb4-8582-f702aa6af4e2';
const legacy = () => ({
  considered:{
    [C11]:{added:1}, [M12]:{added:1},
    mayb:{added:1}, shor:{added:1}, cutOnly:{added:1}, cutAndShort:{added:1}, plain:{added:1}, audioCutOnAlbum:{added:1}, gone:{added:1, del:true, delDone:5}, tagged:{added:1, del:true},
  },
  albums:{
    debut:{name:'Album 1 · Debut', created:1, order:['x1', 'x2', C11, 'x4', 'x5', M12, 'audioCutOnAlbum'], cut:['cutOnly', 'cutAndShort'], target:12},
    second:{name:'Album 2', created:2, order:[], cut:[], target:12},
  },
  sessions:{},
});
const ratings = {
  [M12]:{status:'maybe', score:80}, mayb:{status:'maybe'}, shor:{status:'short'}, cutAndShort:{status:'short'},
  audioCutOnAlbum:{status:'cut'}, tagged:{status:'short'}, gone:{status:'short'}, stray:{status:'short'}, strayCut:{status:'cut'}, unknown:{status:'maybe'},
};
const known = s => s !== 'unknown';

{ // The rules: first match wins, and the owner's example ends On album with no Maybe.
  const plan = legacy(), before = clone(plan);
  const result = Status.migrate(plan, ratings, known, s => s === M12 ? 'Two People to Mourn.M1.2' : s);
  const at = (stem, id = 'debut') => Status.statusOf(plan, ratings, stem, id);
  assert.equal(at(M12), 'on'); assert.equal(plan.albums.debut.order.indexOf(M12), 5, 'track position kept');
  assert.equal(plan.considered[M12].marks.debut, undefined, 'no Maybe left behind on Album 1');
  assert.equal(at(C11), 'on'); assert.equal(plan.albums.debut.order.indexOf(C11), 2);
  assert.equal(at('mayb'), 'maybe'); assert.equal(at('shor'), 'short'); assert.equal(at('plain'), 'unreviewed');
  assert.equal(at('cutOnly'), 'cut'); assert.equal(at('cutAndShort'), 'cut', 'Cut beats Shortlist');
  assert.equal(at('audioCutOnAlbum'), 'on', 'On album beats Cut');
  assert.equal(at('stray'), 'short'); assert.equal(plan.considered.stray.added > 0, true, 'Audio Board-only Shortlist is pulled in');
  assert.equal(at('strayCut'), 'cut');
  assert.equal(plan.considered.unknown, undefined, 'a take outside the catalogue is not invented');
  assert.equal(plan.considered.gone.marks, undefined, 'takes already deleted on Suno stay out');
  assert(Object.values(plan.albums).every(Status.isMigrated));
  // Album 2: nothing placed or cut there, so the global Maybe/Shortlist flags show up there as well.
  assert.equal(at('mayb', 'second'), 'maybe'); assert.equal(at(M12, 'second'), 'maybe');
  // Exactly one status each: never in two of the stores at once.
  for (const [id, a] of Object.entries(plan.albums)) for (const stem of Object.keys(plan.considered)) {
    const homes = [a.order.includes(stem), a.cut.includes(stem), !!plan.considered[stem].marks?.[id]].filter(Boolean).length;
    assert(homes <= 1, `${stem} has ${homes} homes on ${id}`);
  }
  // The conflict log names the owner's example.
  const m = result.log.find(c => c.stem === M12 && c.album === 'debut');
  assert.deepEqual(m.flags, ['On album', 'Maybe']); assert.equal(m.result, 'On album'); assert.equal(m.title, 'Two People to Mourn.M1.2');
  assert(result.log.some(c => c.stem === 'cutAndShort' && c.result === 'Cut'));
  assert(!result.log.some(c => c.stem === 'mayb' && c.album === 'debut'), 'a single flag is not a conflict');
  assert.deepEqual(result.pulledIn, ['stray'], 'only takes that were not in the planner');
  pass('Migration: first matching rule wins, positions kept, conflicts logged, Two People to Mourn.M1.2 ends On album');

  // Running it again changes nothing.
  const again = clone(plan), r2 = Status.migrate(again, ratings, known);
  assert.deepEqual(again, plan); assert.deepEqual(r2.albums, []); assert.deepEqual(r2.log, []);
  pass('Migration cannot run twice');

  // After migration the old global flags no longer matter.
  const changed = {...ratings, [M12]:{status:'cut'}, mayb:{status:null}};
  assert.equal(Status.statusOf(plan, changed, M12, 'debut'), 'on'); assert.equal(Status.statusOf(plan, changed, 'mayb', 'debut'), 'maybe');
  pass('Migrated albums ignore the old Audio Board flags');
}

{ // Setting a status always leaves exactly one.
  const plan = {considered:{}, albums:{a:{name:'A', order:['p', 'q'], cut:[], statusV:2}, b:{name:'B', order:[], cut:[], statusV:2}}};
  const r = {};
  for (const status of ['maybe', 'short', 'cut', 'on', 'unreviewed', 'on', 'cut', 'short']) {
    Status.set(plan, 'z', 'a', status);
    assert.equal(Status.statusOf(plan, r, 'z', 'a'), status);
    const a = plan.albums.a, homes = [a.order.includes('z'), a.cut.includes('z'), !!plan.considered.z.marks?.a].filter(Boolean).length;
    assert.equal(homes, status === 'unreviewed' ? 0 : 1);
  }
  Status.set(plan, 'z', 'a', 'on', 1); assert.deepEqual(plan.albums.a.order, ['p', 'z', 'q']);
  Status.set(plan, 'z', 'b', 'on'); assert.deepEqual(plan.albums.a.order, ['p', 'q'], 'a take sits on one album');
  Status.set(plan, 'z', 'a', 'maybe'); assert.equal(Status.statusOf(plan, r, 'z', 'b'), 'on', 'statuses are per album');
  pass('Every take has exactly one status per album, and statuses are independent between albums');
}

{ // Against the synced store: two devices, each with the same legacy data, migrate and merge.
  const base = Sync.prepare(legacy());
  const dev = id => { const s = clone(base); return {state:s, prev:clone(s), id}; };
  const A = dev('A'), B = dev('B');
  const run = (d, now) => { const plan = d.state; Status.migrate(plan, ratings, known); d.state = Sync.capture(d.prev, plan, d.id, now); d.prev = clone(d.state); };
  run(A, 1000); run(B, 2000);                      // both devices migrate before they ever sync
  const merged = Sync.merge(A.state._sync.records, B.state._sync.records);
  const projected = Sync.project(merged, 'owner');
  assert(Object.values(projected.albums).every(Status.isMigrated), 'merged albums are migrated');
  assert.equal(Status.statusOf(projected, ratings, M12, 'debut'), 'on');
  assert.equal(Status.statusOf(projected, ratings, 'mayb', 'debut'), 'maybe');
  assert.deepEqual(projected.albums.debut.order, A.state.albums.debut.order);
  // A third device that loads the merged data has nothing left to migrate, so a second run is a no-op.
  const C = clone(projected); const result = Status.migrate(C, ratings, known);
  assert.deepEqual(result.albums, []); assert.deepEqual(C, projected);
  // A later edit on A (Maybe → Shortlist) survives B's earlier migration arriving afterwards.
  const edited = clone(A.state); Status.set(edited, 'mayb', 'debut', 'short');
  const A2 = Sync.capture(A.state, edited, 'A', 5000);
  const final = Sync.project(Sync.merge(Sync.merge(A2._sync.records, B.state._sync.records), A.state._sync.records), 'owner');
  assert.equal(Status.statusOf(final, ratings, 'mayb', 'debut'), 'short');
  pass('Two devices migrating the same data merge cleanly, a migrated store is never migrated again, later edits win');
}

{ // A device that is still on the old data reads it through the same rules.
  const plan = legacy();
  assert.equal(Status.statusOf(plan, ratings, M12, 'debut'), 'on');
  assert.equal(Status.statusOf(plan, ratings, 'mayb', 'debut'), 'maybe');
  assert.equal(Status.statusOf(plan, ratings, 'cutAndShort', 'debut'), 'cut');
  assert.equal(Status.statusOf(plan, ratings, 'nope', 'missing-album'), 'unreviewed');
  pass('Unmigrated albums are readable with the same rules until they convert');
}
console.log('Planner status checks passed');
