const { test } = require("node:test"), assert = require("node:assert/strict");
const S = require("../capture/vault-sync.js");
const VaultStore = require("../capture/vault-store.js");

/* ---------- helpers ---------- */
function memStorage(opts = {}) {
  const m = new Map();
  return { m, get length() { return m.size; }, key: i => [...m.keys()][i] ?? null,
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => { if (opts.fail && opts.fail(k)) throw Object.assign(Error("QuotaExceededError"), { name: "QuotaExceededError" }); m.set(k, String(v)); },
    removeItem: k => m.delete(k) };
}
function fakeCloud() {
  let value = null, online = true, writes = 0, gate = null;
  const listeners = [];
  const snap = () => ({ val: () => value == null ? null : JSON.parse(JSON.stringify(value)) });
  const ref = {
    async transaction(update) {
      if (!online) throw Object.assign(Error("offline"), { code: "NETWORK" });
      if (gate) await gate;
      const next = update(value == null ? null : JSON.parse(JSON.stringify(value)));
      if (next === undefined) return { committed: false, snapshot: snap() };
      value = JSON.parse(JSON.stringify(next)); writes++;
      listeners.forEach(fn => fn(snap()));
      return { committed: true, snapshot: snap() };
    },
    on(ev, fn) { listeners.push(fn); if (online) fn(snap()); return fn; },
    off(ev, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
  };
  return { ref, get value() { return value; }, set value(v) { value = v; }, get writes() { return writes; },
    setOnline(v) { online = v; }, hold() { let open; gate = new Promise(r => (open = r)); return () => { gate = null; open(); }; } };
}
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
const texts = list => list.map(e => e.text).sort();
const cloudTexts = cloud => S.entries(S.recordsOf(cloud.value)).map(e => e.text).sort();
let t0 = 1_800_000_000_000;
const clock = () => () => ++t0;

/* ---------- records ---------- */
test("create, edit, delete, restore: each change has a newer revision and the later one wins", () => {
  const a = S.create({ text: "  hook line  ", type: "bar" }, "dA", 100);
  assert.equal(JSON.parse(a.data).text, "hook line");
  const e = S.edit(a, { text: "hook line v2" }, "dB", 200), d = S.remove(e, "dA", 150);
  assert.ok(d.rev[0] > e.rev[0], "a delete made after an edit is newer even with a slow clock");
  const k = S.keyOf(a.id);
  assert.equal(S.entries(S.merge({ [k]: a }, { [k]: e }))[0].text, "hook line v2");
  assert.deepEqual(S.entries(S.merge({ [k]: e }, { [k]: d })), []);
  assert.equal(S.deleted({ [k]: d })[0].text, "hook line v2", "a tombstone keeps the text");
  assert.equal(S.entries({ [k]: S.restore(d, "dB", 300) })[0].text, "hook line v2");
  assert.equal(S.create({ text: "   " }, "d", 1), null);
});
test("merge is order-free and idempotent", () => {
  const recs = [S.create({ text: "a" }, "d1", 1), S.create({ text: "b" }, "d2", 2)];
  const x = { [S.keyOf(recs[0].id)]: recs[0] }, y = { [S.keyOf(recs[1].id)]: recs[1] };
  assert.ok(S.same(S.merge(x, y), S.merge(y, x)));
  assert.ok(S.same(S.merge(S.merge(x, y), y), S.merge(x, y)));
});
test("damaged or unknown cloud data is an error, never an empty Vault", () => {
  assert.deepEqual(S.recordsOf(null), {});
  assert.throws(() => S.recordsOf({ v: 2, records: {} }), /Unsupported/);
  const r = S.create({ text: "x" }, "d", 1);
  assert.throws(() => S.recordsOf({ v: 1, records: { wrongkey: r } }), /Invalid/);
  assert.throws(() => S.recordsOf({ v: 1, records: { [S.keyOf(r.id)]: { ...r, data: "{" } } }), /Invalid/);
});
test("keys are legal database keys whatever the old id contains", () => {
  for (const id of ["v1", "a.b#c$d[e]/f", "ünï 💡"]) assert.match(S.keyOf(id), /^[0-9a-f]+$/);
});

/* ---------- old-format import ---------- */
test("importing the old vault array is a union that never deletes", () => {
  const old = [{ id: "v1", text: "one", created: 10, updated: 10 }, { id: "v2", text: "two", created: 20, updated: 20 }];
  let recs = S.merge({}, S.importLegacy({}, old));
  assert.deepEqual(texts(S.entries(recs)), ["one", "two"]);
  recs = S.merge(recs, S.importLegacy(recs, [old[0]]));
  assert.deepEqual(texts(S.entries(recs)), ["one", "two"], "absence is not a delete");
  assert.deepEqual(S.importLegacy(recs, old), {}, "re-importing the same array changes nothing");
});
test("a tombstone beats an older copy, and a stale tab's later edit still wins", () => {
  const base = S.merge({}, S.importLegacy({}, [{ id: "v1", text: "one", created: 10, updated: 10 }]));
  const del = S.remove(S.find(base, "v1"), "dNew", 50);
  const recs = S.merge(base, { [S.keyOf("v1")]: del });
  assert.deepEqual(S.importLegacy(recs, [{ id: "v1", text: "one", created: 10, updated: 10 }]), {}, "no resurrection");
  const later = S.importLegacy(recs, [{ id: "v1", text: "one, edited later", created: 10, updated: 60 }]);
  assert.equal(S.entries(S.merge(recs, later))[0].text, "one, edited later");
});
test("the mirror written by the new app imports as a no-op", () => {
  const r = S.create({ text: "mine" }, "dA", 500), recs = { [S.keyOf(r.id)]: r };
  assert.deepEqual(S.importLegacy(recs, S.entries(recs)), {});
});
test("an old entry without an id gets the same id on every device", () => {
  const a = S.importLegacy({}, [{ text: "no id", created: 5 }]), b = S.importLegacy({}, [{ text: "no id", created: 5 }]);
  assert.deepEqual(Object.keys(a), Object.keys(b));
  assert.equal(Object.keys(S.importLegacy({}, [{ text: "dup", created: 1 }, { text: "dup", created: 1 }])).length, 1);
});

/* ---------- store: durable local saving ---------- */
test("a capture is in storage, under its own key, before add() returns", () => {
  const storage = memStorage(), store = VaultStore.create({ storage, now: clock(), listen: false });
  const res = store.add({ text: "idea 1", type: "idea" });
  assert.ok(res.ok && res.durable);
  assert.ok(storage.getItem(VaultStore.PENDING + S.keyOf(res.id)), "own pending key");
  assert.deepEqual(texts(JSON.parse(storage.getItem(VaultStore.LEGACY))), ["idea 1"], "old-format mirror updated");
  const reopened = VaultStore.create({ storage, listen: false });
  assert.deepEqual(texts(reopened.entries()), ["idea 1"]);
  assert.equal(reopened.pendingCount(), 1);
});
test("two tabs saving at the same moment both keep their idea", () => {
  const storage = memStorage(), tabA = VaultStore.create({ storage, listen: false }), tabB = VaultStore.create({ storage, listen: false });
  tabA.add({ text: "from A" }); tabB.add({ text: "from B" });
  const fresh = VaultStore.create({ storage, listen: false });
  assert.deepEqual(texts(fresh.entries()), ["from A", "from B"]);
});
test("when storage refuses the write, the add says so but the idea can still reach the cloud", async () => {
  const storage = memStorage({ fail: k => k.startsWith(VaultStore.PENDING) }), cloud = fakeCloud();
  const store = VaultStore.create({ storage, now: clock(), listen: false });
  const res = store.add({ text: "private mode idea" });
  assert.equal(res.ok, true); assert.equal(res.durable, false);
  assert.equal(store.status().storageFailed, true);
  store.attach(cloud.ref); await settle();
  assert.deepEqual(cloudTexts(cloud), ["private mode idea"]);
  assert.equal(store.pendingCount(), 0);
});

/* ---------- store: cloud ---------- */
test("pending changes clear only after the server has them", async () => {
  const storage = memStorage(), cloud = fakeCloud(), store = VaultStore.create({ storage, now: clock(), listen: false });
  cloud.setOnline(false);
  store.add({ text: "offline" });
  store.attach(cloud.ref); await settle();
  assert.equal(store.pendingCount(), 1); assert.equal(store.status().cloud, "error");
  cloud.setOnline(true); await store.sync(); await settle();
  assert.equal(store.pendingCount(), 0); assert.deepEqual(cloudTexts(cloud), ["offline"]);
  assert.equal(store.status().cloud, "synced");
});
test("an edit made while a sync is in flight stays pending until it is sent too", async () => {
  const storage = memStorage(), cloud = fakeCloud(), store = VaultStore.create({ storage, now: clock(), listen: false });
  const { id } = store.add({ text: "v1" });
  const open = cloud.hold(); store.attach(cloud.ref); await tick();
  store.edit(id, { text: "v2" });
  open(); await settle();
  assert.equal(store.pendingCount(), 0);
  assert.deepEqual(cloudTexts(cloud), ["v2"]);
});
test("two devices capturing at once both end up in the cloud and on each other", async () => {
  const cloud = fakeCloud();
  const a = VaultStore.create({ storage: memStorage(), now: clock(), listen: false }), b = VaultStore.create({ storage: memStorage(), now: clock(), listen: false });
  a.attach(cloud.ref); b.attach(cloud.ref); await settle();
  a.add({ text: "phone idea" }); b.add({ text: "desk idea" }); await settle();
  assert.deepEqual(cloudTexts(cloud), ["desk idea", "phone idea"]);
  assert.deepEqual(texts(a.entries()), ["desk idea", "phone idea"]);
  assert.deepEqual(texts(b.entries()), ["desk idea", "phone idea"]);
});
test("a device that was offline for a while cannot erase or resurrect anything", async () => {
  const cloud = fakeCloud();
  const a = VaultStore.create({ storage: memStorage(), now: clock(), listen: false }), stale = VaultStore.create({ storage: memStorage(), now: clock(), listen: false });
  a.attach(cloud.ref); await settle();
  const keep = a.add({ text: "keep" }).id, gone = a.add({ text: "gone" }).id; await settle();
  stale.attach(cloud.ref); await settle(); stale.detach();          // stale copy has both
  a.remove(gone); a.add({ text: "new on A" }); await settle();
  stale.attach(cloud.ref); await settle();                          // the stale device comes back
  assert.deepEqual(cloudTexts(cloud), ["keep", "new on A"]);
  assert.ok(keep);
});
test("edit on one device and delete on another: the later change wins and the text can be restored", async () => {
  const cloud = fakeCloud(), ca = clock(), cb = clock();
  const a = VaultStore.create({ storage: memStorage(), now: ca, listen: false }), b = VaultStore.create({ storage: memStorage(), now: cb, listen: false });
  a.attach(cloud.ref); const { id } = a.add({ text: "draft" }); await settle();
  b.attach(cloud.ref); await settle(); a.detach(); b.detach();
  a.edit(id, { text: "draft, edited" });       // earlier
  b.remove(id);                                 // later
  a.attach(cloud.ref); b.attach(cloud.ref); await settle();
  assert.deepEqual(cloudTexts(cloud), []);
  assert.equal(a.deleted()[0].text, "draft", "the deleted copy is the one that won, and it is restorable");
  a.restore(id); await settle();
  assert.deepEqual(cloudTexts(cloud), ["draft"]);
});
test("unreadable cloud data stops syncing and leaves local data alone", async () => {
  const cloud = fakeCloud(); cloud.value = { v: 99 };
  const store = VaultStore.create({ storage: memStorage(), now: clock(), listen: false });
  store.add({ text: "safe" }); store.attach(cloud.ref); await settle();
  assert.equal(store.status().cloud, "error");
  assert.deepEqual(cloud.value, { v: 99 }, "nothing written over it");
  assert.deepEqual(texts(store.entries()), ["safe"]); assert.equal(store.pendingCount(), 1);
});
test("old-format entries are imported once and reach the cloud", async () => {
  const cloud = fakeCloud(), store = VaultStore.create({ storage: memStorage(), now: clock(), listen: false });
  assert.equal(store.importLegacy([{ id: "v1", text: "from the old array", created: 1, updated: 1 }]), 1);
  assert.equal(store.importLegacy([{ id: "v1", text: "from the old array", created: 1, updated: 1 }]), 0);
  store.attach(cloud.ref); await settle();
  assert.deepEqual(cloudTexts(cloud), ["from the old array"]);
});
