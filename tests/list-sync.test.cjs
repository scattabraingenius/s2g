/* List Sync (Tasks Sync v2) unit tests. Pure Node, no browser:  node tests/list-sync.test.cjs */
const { test } = require("node:test"), assert = require("node:assert/strict");
const S = require("../sync/list-sync.js");
const ListStore = require("../sync/list-store.js");

/* ---------- helpers ---------- */
function memStorage(opts = {}) {
  const m = new Map();
  return { m, get length() { return m.size; }, key: i => [...m.keys()][i] ?? null,
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => { if (opts.fail && opts.fail(k)) throw Object.assign(Error("QuotaExceededError"), { name: "QuotaExceededError" }); m.set(k, String(v)); },
    removeItem: k => m.delete(k) };
}
function fakeCloud() {
  let value = null, online = true;
  const listeners = [];
  const snap = () => ({ val: () => value == null ? null : JSON.parse(JSON.stringify(value)) });
  const ref = {
    async transaction(update) {
      if (!online) throw Object.assign(Error("offline"), { code: "NETWORK" });
      const next = update(value == null ? null : JSON.parse(JSON.stringify(value)));
      if (next === undefined) return { committed: false, snapshot: snap() };
      value = JSON.parse(JSON.stringify(next));
      listeners.forEach(fn => fn(snap()));
      return { committed: true, snapshot: snap() };
    },
    on(ev, fn) { listeners.push(fn); if (online) fn(snap()); return fn; },
    off(ev, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
  };
  return { ref, get value() { return value; }, set value(v) { value = v; }, setOnline(v) { online = v; } };
}
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)); };
let t0 = 1_800_000_000_000;
const clock = () => () => ++t0;
const task = (id, name, extra = {}) => ({ id, task: name, people: [], status: "todo", showOn: "", due: "", priority: 5, created: 1000, ...extra });
const one = recs => Object.values(recs)[0];
const names = items => items.map(t => t.task).sort();
const store = (storage, extra = {}) => ListStore.create({ list: "tasks", legacyKey: "grind.plan.v1", groups: [["status", "showOn"]], storage, now: clock(), listen: false, ...extra });

/* ---------- records ---------- */
test("create and project round-trip a task, including empty arrays and strings", () => {
  const r = S.create(task("t1", "Send the mix", { people: [], notes: "" }), "dA", 100);
  const k = S.keyOf("t1");
  assert.ok(S.valid(k, r));
  assert.deepEqual(S.items({ [k]: r }), [{ ...task("t1", "Send the mix", { people: [], notes: "" }), updated: 100 }]);
});
test("two devices changing different parts of one task both keep their change, in any order", () => {
  const k = S.keyOf("t1"), base = S.create(task("t1", "Send the mix"), "d0", 100);
  const done = S.edit(base, task("t1", "Send the mix", { status: "done" }), "phone", 200);
  const renamed = S.edit(base, task("t1", "Send the final mix"), "laptop", 300);
  assert.deepEqual(Object.keys(done.fields), ["status"], "only the changed part is written");
  for (const [x, y] of [[done, renamed], [renamed, done]]) {
    const merged = S.merge(S.merge({ [k]: base }, { [k]: x }), { [k]: y });
    const t = S.items(merged)[0];
    assert.equal(t.task, "Send the final mix"); assert.equal(t.status, "done");
  }
});
test("the same part changed on two devices: the later change wins on every device", () => {
  const k = S.keyOf("t1"), base = S.create(task("t1", "a"), "d0", 100);
  const early = S.edit(base, task("t1", "early"), "dB", 200), late = S.edit(base, task("t1", "late"), "dA", 300);
  assert.equal(S.items(S.merge({ [k]: early }, { [k]: late }))[0].task, "late");
  assert.equal(S.items(S.merge({ [k]: late }, { [k]: early }))[0].task, "late");
});
test("merge is order-free and idempotent", () => {
  const a = { [S.keyOf("x")]: S.create(task("x", "x"), "d1", 1) }, b = { [S.keyOf("y")]: S.create(task("y", "y"), "d2", 2) };
  const k = S.keyOf("x"), c = { [k]: S.edit(a[k], task("x", "x2"), "d3", 5) };
  const ab = S.merge(S.merge(a, b), c), ba = S.merge(c, S.merge(b, a));
  assert.ok(S.same(ab, ba));
  assert.ok(S.same(S.merge(ab, ab), ab));
});
test("a delete is a tombstone that keeps the task; a stale copy that still holds it cannot bring it back", () => {
  const k = S.keyOf("t1"), base = S.create(task("t1", "old"), "d0", 100);
  const gone = S.remove(base, "dA", 50);
  assert.ok(gone.fields.deleted.rev[0] > 100, "a delete is newer than every part even with a slow clock");
  const recs = S.merge({ [k]: base }, { [k]: gone });
  assert.deepEqual(S.items(recs), []);
  assert.equal(S.deletedItems(recs)[0].task, "old");
  assert.deepEqual(S.diff(recs, [task("t1", "old", { status: "done" })], "dB", 500, { shown: new Set(["t1"]) }), {}, "editing a stale copy does not revive it");
  assert.equal(S.items(S.merge(recs, { [k]: S.restore(gone, "dB", 600) }))[0].task, "old");
});
test("diff only deletes ids the caller was shown, so a task that arrived meanwhile survives a save", () => {
  const recs = S.merge({ [S.keyOf("a")]: S.create(task("a", "a"), "d", 1) }, { [S.keyOf("b")]: S.create(task("b", "b"), "d", 2) });
  const out = S.diff(recs, [task("a", "a")], "d", 10, { shown: new Set(["a"]) });
  assert.deepEqual(out, {}, "b was never shown to the caller, so leaving it out is not a delete");
  const del = S.diff(recs, [task("a", "a")], "d", 10, { shown: new Set(["a", "b"]) });
  assert.equal(one(del).fields.deleted.v, "true");
});
const GROUPS = [["status", "showOn"]];
test("an automatic Later-returns change never outranks a real edit made elsewhere", () => {
  const k = S.keyOf("t1"), base = S.create(task("t1", "Gig prep", { status: "later", showOn: "2026-11-08" }), "d0", 100);
  const auto = one(S.diff({ [k]: base }, [task("t1", "Gig prep", { status: "todo", showOn: "" })], "stale", 10_000, { auto: true, groups: GROUPS }));
  assert.equal(auto.fields.status.rev[0], 101, "smallest possible step past what it saw");
  const repark = S.edit(base, task("t1", "Gig prep", { status: "later", showOn: "2026-11-15" }), "laptop", 500, { groups: GROUPS });
  assert.deepEqual(Object.keys(repark.fields).sort(), ["showOn", "status"], "picking a new day writes status and day together");
  for (const order of [[auto, repark], [repark, auto]]) {
    const t = S.items(S.merge(S.merge({ [k]: base }, { [k]: order[0] }), { [k]: order[1] }))[0];
    assert.equal(t.status, "later"); assert.equal(t.showOn, "2026-11-15");
  }
  assert.equal(S.items(S.merge({ [k]: base }, { [k]: auto }))[0].status, "todo", "with no other edit it applies");
  assert.deepEqual(S.diff({ [k]: base }, [], "d", 1, { auto: true, shown: new Set(["t1"]) }), {}, "an automatic change never deletes");
});
test("damaged or unknown cloud data is an error, never an empty list", () => {
  assert.deepEqual(S.recordsOf(null), {});
  assert.throws(() => S.recordsOf({ v: 2, records: {} }), /Unsupported/);
  assert.throws(() => S.recordsOf({ v: 1, records: { bad: { kind: "item", id: "x", fields: {} } } }), /Invalid/);
  const r = S.create(task("t1", "a"), "d", 1);
  assert.throws(() => S.recordsOf({ v: 1, records: { [S.keyOf("other")]: r } }), /Invalid/, "key must match the id");
  assert.throws(() => S.recordsOf({ v: 1, records: { [S.keyOf("t1")]: { ...r, fields: { ...r.fields, deleted: { v: "1", rev: [1, "d"] } } } } }), /Invalid/);
});
test("old-format arrays merge as a union: new ids added, nothing deleted, deleted ids stay deleted", () => {
  const k = S.keyOf("t1"), base = S.create(task("t1", "kept"), "d0", 100);
  const recs = { [k]: S.merge({ [k]: base }, { [k]: S.remove(base, "d", 200) })[k] };
  const add = S.importLegacy(recs, [task("t1", "kept"), task("t2", "new"), { task: "no id", created: 5 }, null, "junk"]);
  assert.deepEqual(names(S.items(add)), ["new", "no id"]);
  assert.ok(!add[k], "the deleted task is not brought back");
  const again = S.importLegacy(S.merge(recs, add), [{ task: "no id", created: 5 }]);
  assert.deepEqual(again, {}, "an id-less item gets the same id every time");
});
test("an import file's newer edit wins part by part; the cloud mirror never edits", () => {
  const k = S.keyOf("t1"), recs = { [k]: S.create(task("t1", "old name"), "d0", 100) };
  const newer = [{ ...task("t1", "file name"), updated: 500 }], older = [{ ...task("t1", "file name"), updated: 50 }];
  assert.deepEqual(S.importLegacy(recs, newer), {}, "mirror: union only");
  assert.equal(S.items(S.merge(recs, S.importLegacy(recs, newer, { edits: true })))[0].task, "file name");
  assert.deepEqual(S.importLegacy(recs, older, { edits: true }), {}, "an older file edit loses");
});

/* ---------- store ---------- */
test("a change is written to its own pending key before anything else, and survives a reload", () => {
  const storage = memStorage();
  const a = store(storage);
  const list = a.items(); list.unshift(task("t1", "Offline task", { created: 2000 }));
  assert.equal(a.commitList(list).durable, true);
  assert.equal([...storage.m.keys()].filter(k => k.startsWith("grind.tasks.pending.")).length, 1);
  assert.deepEqual(names(JSON.parse(storage.getItem("grind.plan.v1"))), ["Offline task"], "old-format mirror updated");
  assert.deepEqual(names(store(storage).items()), ["Offline task"], "a fresh page still has it");
});
test("pending changes reach the cloud, and are removed only once the cloud holds them", async () => {
  const storage = memStorage(), cloud = fakeCloud();
  const a = store(storage);
  a.adoptCloud(null, true);
  cloud.setOnline(false);
  a.attach(cloud.ref); await settle();
  const list = a.items(); list.unshift(task("t1", "x"));
  a.commitList(list); await settle();
  assert.equal(a.pendingCount(), 1, "still pending while offline");
  cloud.setOnline(true); a.setOffline(false); await settle();
  assert.equal(a.pendingCount(), 0);
  assert.deepEqual(names(S.items(S.recordsOf(cloud.value))), ["x"]);
});
test("two tabs saving changes to the same task at once: both parts are kept", async () => {
  const storage = memStorage(), cloud = fakeCloud();
  const seed = store(storage); seed.adoptCloud(null, true);
  seed.commitList([task("t1", "a")]);
  const a = store(storage), b = store(storage);
  const la = a.items(); la[0].status = "done"; a.commitList(la);
  const lb = b.items(); lb[0].priority = 9; b.commitList(lb);
  const c = store(storage); c.attach(cloud.ref); await settle();
  const t = S.items(S.recordsOf(cloud.value))[0];
  assert.equal(t.status, "done"); assert.equal(t.priority, 9);
});
test("storage full: the change is kept in memory, reported as not durable, and still synced", async () => {
  const storage = memStorage({ fail: k => k.startsWith("grind.tasks.pending.") }), cloud = fakeCloud();
  const a = store(storage); a.adoptCloud(null, true);
  a.attach(cloud.ref); await settle();
  assert.equal(a.commitList([task("t1", "x")]).durable, false);
  await settle();
  assert.deepEqual(names(S.items(S.recordsOf(cloud.value))), ["x"]);
});
test("upgrade: the old local list shows until the cloud snapshot, then the cloud copy wins once", () => {
  const storage = memStorage();
  storage.setItem("grind.plan.v1", JSON.stringify([task("t-old", "old"), task("t-gone", "deleted elsewhere")]));
  const a = store(storage);
  assert.deepEqual(names(a.items()), ["deleted elsewhere", "old"]);
  const list = a.items(); list.find(t => t.id === "t-old").status = "done"; a.commitList(list);   // touched after the upgrade
  a.adoptCloud([task("t-cloud", "cloud task")], true);
  assert.deepEqual(names(a.items()), ["cloud task", "old"], "touched task kept whole, untouched stale one dropped");
  assert.equal(a.items().find(t => t.id === "t-old").status, "done");
  assert.deepEqual(names(store(storage).items()), ["cloud task", "old"], "and it stays that way after a reload");
});
test("upgrade: with no cloud copy at all, the old local list is kept and sent", async () => {
  const storage = memStorage(), cloud = fakeCloud();
  storage.setItem("grind.plan.v1", JSON.stringify([task("t1", "only here")]));
  const a = store(storage);
  a.adoptCloud(null, false);
  a.attach(cloud.ref); await settle();
  assert.deepEqual(names(S.items(S.recordsOf(cloud.value))), ["only here"]);
});
test("upgrade: a device that never signs in keeps its old list and its new changes", () => {
  const storage = memStorage();
  storage.setItem("grind.plan.v1", JSON.stringify([task("t1", "local")]));
  const a = store(storage);
  const list = a.items(); list.unshift(task("t2", "new", { created: 3000 })); a.commitList(list);
  assert.deepEqual(names(store(storage).items()), ["local", "new"]);
});
test("a damaged cloud copy is reported and never sent over or used to empty the list", async () => {
  const storage = memStorage(), cloud = fakeCloud();
  cloud.value = { v: 9, records: {} };
  const a = store(storage); a.adoptCloud(null, true);
  a.commitList([task("t1", "keep me")]);
  a.attach(cloud.ref); await settle();
  assert.equal(a.status().cloud, "error");
  assert.deepEqual(cloud.value, { v: 9, records: {} });
  assert.deepEqual(names(a.items()), ["keep me"]);
});
test("filling in default parts is not an edit, so a save never outranks a real change elsewhere", () => {
  const normalize = t => ({ notes: "", priority: 5, people: [], ...t });
  const k = S.keyOf("t1"), sparse = S.importLegacy({}, [{ id: "t1", task: "a", created: 1 }], { normalize })[k];
  assert.equal(sparse.fields.notes.v, '""', "imported old-format items get their defaults as parts");
  const bare = { kind: "item", id: "t1", fields: { task: { v: '"a"', rev: [1, "d"] } } };    // e.g. Firebase dropped an empty array
  assert.equal(S.edit(bare, normalize({ id: "t1", task: "a" }), "d2", 99, { normalize }), null);
  assert.deepEqual(Object.keys(S.edit(bare, normalize({ id: "t1", task: "a", notes: "x" }), "d2", 99, { normalize }).fields), ["notes"]);
});
