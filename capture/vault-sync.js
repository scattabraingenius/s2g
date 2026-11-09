/* Vault Sync v2: one record per Vault entry, so no writer can wipe what it has not seen.

   Same record pattern as lyrics/sync.js, audio/album/planner-sync.js and studio/studio-sync.js:
   every entry is a record with a revision [time, device]; the later revision wins; a delete is a
   tombstone that keeps the text so the entry can be restored; merging is commutative and
   idempotent, so replaying the same record any number of times changes nothing.

   Cloud: planners/the-grind-scattabrain-2026/vaultSync/accounts/<uid> = {v:1, records:{<key>:record}}.
   That path is outside the keys the main app's pushCloud() writes, so the old whole-collection
   writer can never touch it. The old `vault` array is still written by the main app as a read-only
   mirror for older tabs and exports, and imported here as a union that never deletes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VaultSync = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const PATH = "planners/the-grind-scattabrain-2026/vaultSync/accounts/";
  const TYPES = ["bar", "quote", "idea"];
  const MAX_TEXT = 20000, MAX_SOURCE = 500;
  const copy = v => JSON.parse(JSON.stringify(v));
  const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  /* Hex of the UTF-8 JSON, the same key scheme as studio-sync.js: always a legal database key,
     whatever characters an old entry id contains. */
  const keyOf = id => Array.from(new TextEncoder().encode(JSON.stringify(["entry", String(id)])), n => n.toString(16).padStart(2, "0")).join("");

  function cleanEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const text = (raw.text == null ? "" : String(raw.text)).trim().slice(0, MAX_TEXT);
    if (!text) return null;
    const created = Number.isFinite(raw.created) ? raw.created : 0;
    return {
      text, type: TYPES.includes(raw.type) ? raw.type : "idea",
      source: (raw.source == null ? "" : String(raw.source)).trim().slice(0, MAX_SOURCE),
      favorite: !!raw.favorite, created,
      updated: Number.isFinite(raw.updated) ? raw.updated : created,
    };
  }
  /* A small stable hash, so an old entry that somehow has no id gets the same id on every device
     instead of a random one (which would duplicate it once per device). */
  function stableId(entry) {
    let h = 2166136261;
    for (const ch of `${entry.text}\u0000${entry.created}`) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return "v-legacy-" + h.toString(36);
  }

  function record(id, entry, rev, deleted) {
    const r = { kind: "entry", id: String(id), rev: [rev[0], String(rev[1])], data: JSON.stringify(entry) };
    if (deleted) r.deleted = true;
    return r;
  }
  function valid(key, r) {
    if (!r || r.kind !== "entry" || typeof r.id !== "string" || !r.id || r.id.length > 4096) return false;
    if (key !== keyOf(r.id)) return false;
    if (!Array.isArray(r.rev) || !Number.isFinite(r.rev[0]) || typeof r.rev[1] !== "string") return false;
    if (r.deleted !== undefined && r.deleted !== true) return false;
    let data; try { data = JSON.parse(r.data); } catch (e) { return false; }
    return !!cleanEntry(data);
  }
  function compare(a, b) {
    const left = canonical(a), right = canonical(b);
    return a.rev[0] - b.rev[0] || (a.rev[1] < b.rev[1] ? -1 : a.rev[1] > b.rev[1] ? 1 : left < right ? -1 : left > right ? 1 : 0);
  }
  function merge(a, b) {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b || {})) if (!Object.prototype.hasOwnProperty.call(out, k) || compare(v, out[k]) > 0) out[k] = copy(v);
    return out;
  }
  function same(a, b) { return canonical(a || {}) === canonical(b || {}); }

  /* Cloud envelope -> validated records. Anything unrecognised throws instead of being treated as
     empty, so a damaged or newer cloud copy can never make the local Vault look empty. */
  function recordsOf(envelope) {
    if (envelope == null) return {};
    if (envelope.v !== 1 || !envelope.records || typeof envelope.records !== "object") throw Error("Unsupported Vault cloud data. Local data is safe.");
    const entries = Object.entries(envelope.records);
    if (entries.some(([k, r]) => !valid(k, r))) throw Error("Invalid Vault cloud data. Local data is safe.");
    return copy(envelope.records);
  }
  const envelope = records => ({ v: 1, records: copy(records || {}) });

  /* ---------- changes (each returns one new record) ---------- */
  function create(fields, device, now) {
    const entry = cleanEntry({ ...fields, favorite: !!fields.favorite, created: now, updated: now });
    if (!entry) return null;
    const id = fields.id || ("v" + now.toString(36) + Math.random().toString(36).slice(2, 6));
    return record(id, entry, [now, device]);
  }
  function edit(prev, patch, device, now) {
    const data = JSON.parse(prev.data);
    const entry = cleanEntry({ ...data, ...patch, created: data.created, updated: now });
    if (!entry) return null;
    return record(prev.id, entry, [Math.max(now, prev.rev[0] + 1), device]);
  }
  function remove(prev, device, now) {
    const data = JSON.parse(prev.data);
    return record(prev.id, { ...data, updated: now }, [Math.max(now, prev.rev[0] + 1), device], true);
  }
  function restore(prev, device, now) {
    const data = JSON.parse(prev.data);
    return record(prev.id, { ...data, updated: now }, [Math.max(now, prev.rev[0] + 1), device]);
  }

  /* Old `vault` array (cloud mirror, local grind.vault.v1, or a JSON export) -> records to merge in.
     Union only: an entry missing from the array is never deleted. An entry already known is only
     replaced when the array's copy was edited later than the record (a stale tab's newer edit). */
  function importLegacy(records, legacy) {
    const add = {};
    if (!Array.isArray(legacy)) return add;
    for (const raw of legacy) {
      const entry = cleanEntry(raw); if (!entry) continue;
      const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : stableId(entry);
      const key = keyOf(id), existing = records[key] || add[key];
      const time = entry.updated || entry.created || 0;
      if (existing) {
        if (time <= existing.rev[0]) continue;
        if (!existing.deleted && same(JSON.parse(existing.data), entry)) continue;
      }
      add[key] = record(id, entry, [time, "legacy"]);
    }
    return add;
  }

  /* ---------- views ---------- */
  function project(r) { return { id: r.id, ...JSON.parse(r.data) }; }
  const byFresh = (a, b) => (b.updated || 0) - (a.updated || 0) || (a.id < b.id ? -1 : 1);
  function entries(records) { return Object.values(records || {}).filter(r => !r.deleted).map(project).sort(byFresh); }
  function deleted(records) { return Object.values(records || {}).filter(r => r.deleted).map(project).sort(byFresh); }
  function find(records, id) { return (records || {})[keyOf(id)] || null; }

  return { PATH, TYPES, keyOf, cleanEntry, stableId, valid, compare, merge, same, recordsOf, envelope,
    create, edit, remove, restore, importLegacy, entries, deleted, find };
});
