const assert = require('node:assert/strict');
for (const file of ['../lyrics/sync.js', '../audio/album/planner-sync.js']) {
  const sync = require(file);
  const record = {kind:'album', id:'debut', field:'', data:'{"name":"Debut","order":[]}', rev:[10,'device']};
  const reordered = Object.fromEntries(Object.entries(record).sort());
  assert(sync.sameRecords({x:record}, {x:reordered}), `${file}: server key order must not cause repeated saves`);
  assert.deepEqual(sync.merge({x:record}, {x:reordered}), {x:record});
  assert.deepEqual(sync.merge({x:reordered}, {x:record}), {x:reordered});
  const changed = {...reordered, data:'{"name":"Changed","order":[]}', rev:[11,'other']};
  assert(!sync.sameRecords({x:record}, {x:changed}));
  assert.deepEqual(sync.merge({x:record}, {x:changed}), {x:changed});
  const deleted = {...record, deleted:true, rev:[12,'other']};
  assert.deepEqual(sync.merge({x:changed}, {x:deleted}), {x:deleted});
  console.log(`PASS ${file}: reordered records settle; changes and deletions still merge`);
}
