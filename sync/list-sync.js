/* List Sync: one record per list item, and one revision per part of an item, so no writer can wipe
   what it has not seen and two devices editing different parts of one item both keep their change.

   Used by Tasks Sync v2 (tasks) and meant for the main app's other lists later. Same family as
   capture/vault-sync.js (one revision per entry) and lyrics/sync.js (one revision per rating field).

   A record:  {kind:"item", id, fields:{<part>: {v:<JSON text>, rev:[time, device]}}}
   - Each part (task name, status, due date...) has its own revision; the later revision wins, part by
     part. Ties break on device id, then on the value, so every device settles on the same result.
   - Values are stored as JSON text, so the database never reshapes them (empty arrays, key order).
   - A delete is the part `deleted` set to true: a tombstone that keeps the item, so it can be restored.
   - Merging is commutative and idempotent: replaying the same records any number of times, in any
     order, changes nothing.

   Cloud: planners/the-grind-scattabrain-2026/<list>Sync/accounts/<uid> = {v:1, records:{<key>:record}}.
   That path is outside the keys the main app's pushCloud() writes, so the old whole-array writer can
   never touch it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ListSync = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const ROOT = "planners/the-grind-scattabrain-2026/";
  const pathFor = list => ROOT + list + "Sync/accounts/";
  const MAX_VALUE = 100000;
  const PART = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
  const SKIP = new Set(["id", "updated"]);           // the record's own id; `updated` is derived
  const copy = v => JSON.parse(JSON.stringify(v));
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  /* Hex of the UTF-8 JSON: always a legal database key, whatever characters an id contains. */
  const keyOf = id => Array.from(new TextEncoder().encode(JSON.stringify(["item", String(id)])), n => n.toString(16).padStart(2, "0")).join("");

  const validRev = rev => Array.isArray(rev) && rev.length === 2 && Number.isFinite(rev[0]) && typeof rev[1] === "string" && rev[1].length <= 200;
  function validPart(name, p) {
    if (!PART.test(name) || SKIP.has(name) || !p || typeof p !== "object" || !validRev(p.rev)) return false;
    if (typeof p.v !== "string" || p.v.length > MAX_VALUE) return false;
    try { JSON.parse(p.v); } catch (e) { return false; }
    return name !== "deleted" || p.v === "true" || p.v === "false";
  }
  function valid(key, r) {
    if (!r || r.kind !== "item" || typeof r.id !== "string" || !r.id || r.id.length > 4096) return false;
    if (key !== keyOf(r.id)) return false;
    if (!r.fields || typeof r.fields !== "object" || Array.isArray(r.fields)) return false;
    const parts = Object.entries(r.fields);
    return parts.length > 0 && parts.every(([n, p]) => validPart(n, p));
  }
  /* Positive when part a is newer than part b. */
  function comparePart(a, b) {
    return a.rev[0] - b.rev[0] || (a.rev[1] < b.rev[1] ? -1 : a.rev[1] > b.rev[1] ? 1 : a.v < b.v ? -1 : a.v > b.v ? 1 : 0);
  }
  function mergeRecord(a, b) {
    if (!a) return copy(b);
    if (!b) return copy(a);
    const fields = { ...copy(a.fields) };
    for (const [n, p] of Object.entries(b.fields)) if (!own(fields, n) || comparePart(p, fields[n]) > 0) fields[n] = copy(p);
    return { kind: "item", id: a.id, fields };
  }
  function merge(a, b) {
    const out = { ...(a || {}) };
    for (const [k, r] of Object.entries(b || {})) out[k] = own(out, k) ? mergeRecord(out[k], r) : copy(r);
    return out;
  }
  function same(a, b) { return canonical(a || {}) === canonical(b || {}); }
  /* True when `have` already holds every part of `rec` at least as new: the server has the change. */
  function covers(have, rec) {
    if (!have) return false;
    return Object.entries(rec.fields).every(([n, p]) => have.fields[n] && comparePart(have.fields[n], p) >= 0);
  }

  /* Cloud envelope -> validated records. Anything unrecognised throws instead of being treated as
     empty, so a damaged or newer cloud copy can never make the local list look empty. */
  function recordsOf(envelope, what = "List") {
    if (envelope == null) return {};
    if (envelope.v !== 1 || !envelope.records || typeof envelope.records !== "object") throw Error(`Unsupported ${what} cloud data. Local data is safe.`);
    const entries = Object.entries(envelope.records);
    if (entries.some(([k, r]) => !valid(k, r))) throw Error(`Invalid ${what} cloud data. Local data is safe.`);
    return copy(envelope.records);
  }
  const envelope = records => ({ v: 1, records: copy(records || {}) });

  /* ---------- reading ---------- */
  const isDeleted = r => !!(r.fields.deleted && r.fields.deleted.v === "true");
  /* The newest revision time of any part: shown as `updated` in the old-format mirror. */
  const updatedOf = r => Object.values(r.fields).reduce((m, p) => Math.max(m, p.rev[0]), 0);
  function project(r) {
    const item = { id: r.id };
    for (const [n, p] of Object.entries(r.fields)) {
      if (n === "deleted") continue;
      const v = JSON.parse(p.v);
      if (v !== null) item[n] = v;
    }
    item.updated = updatedOf(r);
    return item;
  }
  const byNewest = (a, b) => (b.created || 0) - (a.created || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  function items(records) { return Object.values(records || {}).filter(r => !isDeleted(r)).map(project).sort(byNewest); }
  function deletedItems(records) { return Object.values(records || {}).filter(isDeleted).map(project).sort(byNewest); }
  function find(records, id) { return (records || {})[keyOf(id)] || null; }

  /* ---------- changes (each returns one new record holding only the changed parts, or null) ---------- */
  /* The parts of a plain item: every own key except id and updated; null and undefined mean "absent". */
  function partsOf(item) {
    const out = {};
    for (const [n, v] of Object.entries(item || {})) {
      if (SKIP.has(n) || n === "deleted" || !PART.test(n) || v === undefined || v === null) continue;
      const text = JSON.stringify(v);
      if (text !== undefined && text.length <= MAX_VALUE) out[n] = text;
    }
    return out;
  }
  function create(item, device, now) {
    if (!item || typeof item.id !== "string" || !item.id) return null;
    const fields = {};
    for (const [n, v] of Object.entries(partsOf(item))) fields[n] = { v, rev: [now, String(device)] };
    fields.deleted = { v: "false", rev: [now, String(device)] };
    return { kind: "item", id: item.id, fields };
  }
  /* Revision for a changed part. A normal change is stamped with the current time (never behind the
     part's last revision). An AUTOMATIC change (a Later task returning on its day) gets the smallest
     possible step past the revision it was computed from, so any real edit made elsewhere after that
     revision, even on a device whose copy this one has not seen yet, still wins. */
  const stamp = (prev, device, now, auto) => [auto ? prev.rev[0] + 1 : Math.max(now, prev.rev[0] + 1), String(device)];
  /* opts.groups: parts that only make sense together (a task's status and its return day). When one
     part of a group changes, every part of it is written with ONE revision, so a merge always takes
     the whole group from the same change and never pairs "To do" with a future return day. */
  function edit(prev, item, device, now, opts = {}) {
    const next = partsOf(item), fields = {};
    const valueOf = n => own(next, n) ? next[n] : "null";
    const names = new Set([...Object.keys(next), ...Object.keys(prev.fields).filter(n => n !== "deleted")]);
    /* A part the record never had counts as its default (opts.normalize fills defaults), so filling in
       defaults is never mistaken for an edit that would outrank a real change made elsewhere. */
    const base = opts.normalize ? partsOf(opts.normalize(project(prev))) : {};
    const was = n => prev.fields[n] ? prev.fields[n].v : own(base, n) ? base[n] : "null";
    const changed = [...names].filter(n => was(n) !== valueOf(n));
    if (!changed.length) return null;
    const write = new Set(changed);
    for (const g of opts.groups || []) if (g.some(n => write.has(n))) g.forEach(n => write.add(n));
    const revFor = list => {
      const known = list.map(n => prev.fields[n]).filter(Boolean);
      if (!known.length) return [opts.auto ? updatedOf(prev) + 1 : now, String(device)];
      const newest = known.reduce((a, b) => (comparePart(a, b) >= 0 ? a : b));
      return stamp(newest, device, now, opts.auto);
    };
    for (const n of write) {
      const group = (opts.groups || []).find(g => g.includes(n)) || [n];
      fields[n] = { v: valueOf(n), rev: revFor(group) };
    }
    return { kind: "item", id: prev.id, fields };
  }
  function remove(prev, device, now) {
    const before = prev.fields.deleted || { rev: [updatedOf(prev), ""] };
    return { kind: "item", id: prev.id, fields: { deleted: { v: "true", rev: [Math.max(now, before.rev[0] + 1, updatedOf(prev) + 1), String(device)] } } };
  }
  function restore(prev, device, now) {
    const before = prev.fields.deleted || { rev: [0, ""] };
    return { kind: "item", id: prev.id, fields: { deleted: { v: "false", rev: [Math.max(now, before.rev[0] + 1), String(device)] } } };
  }
  /* The whole edited list -> the records for what changed. A new id is created; a known one gets only
     its changed parts. An id is deleted only when it is in `opts.shown` (the ids the caller was last
     given) and the list no longer has it, so an item that arrived after the caller's copy was made can
     never be deleted by it. A deleted item is never revived by a stale copy that still holds it. */
  function diff(records, list, device, now, opts = {}) {
    const out = {}, seen = new Set();
    for (const item of Array.isArray(list) ? list : []) {
      if (!item || typeof item.id !== "string" || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      const prev = find(records, item.id);
      let rec;
      if (!prev) rec = create(item, device, now);
      else if (isDeleted(prev)) rec = null;
      else rec = edit(prev, item, device, now, opts);
      if (rec) out[keyOf(item.id)] = rec;
    }
    if (!opts.auto && opts.shown) for (const id of opts.shown) {
      const r = find(records, id);
      if (r && !isDeleted(r) && !seen.has(id)) out[keyOf(id)] = remove(r, device, now);
    }
    return out;
  }

  /* A small stable hash, so an old item that somehow has no id gets the same id on every device. */
  function stableId(item, prefix = "legacy-") {
    let h = 2166136261;
    for (const ch of canonical(item)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return prefix + h.toString(36);
  }
  /* Old-format array (cloud mirror, the old local key, or an import file) -> records to merge in.
     Union only: an item missing from the array is never deleted, and a deleted item never comes back.
     New ids are added, stamped [created, "legacy"]. With {edits:true} (an import file) a
     known item's differing parts are also taken when the file's `updated` is newer than that part;
     the cloud mirror never edits, because it is derived from the records and an old tab copies a
     stale `updated` forward. */
  function importLegacy(records, list, opts = {}) {
    const add = {};
    if (!Array.isArray(list)) return add;
    for (const raw of list) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : stableId(raw);
      const item = opts.normalize ? { ...opts.normalize({ ...raw, id }), id } : { ...raw, id };
      const key = keyOf(id), existing = add[key] || (records || {})[key];
      const time = Number.isFinite(raw.updated) ? raw.updated : Number.isFinite(raw.created) ? raw.created : 0;
      /* A new id is stamped with its creation time, not `updated`: an old-format copy may carry a
         recent `updated` next to stale values, and must never outrank a real change. */
      if (!existing) { const rec = create(item, "legacy", Number.isFinite(raw.created) ? raw.created : 0); if (rec) add[key] = rec; continue; }
      if (!opts.edits || isDeleted(existing)) continue;
      const rec = edit(existing, item, "legacy", time, { groups: opts.groups, normalize: opts.normalize });
      if (!rec) continue;
      for (const [n, p] of Object.entries(rec.fields)) {
        const cur = existing.fields[n];
        if (cur && cur.rev[0] >= time) delete rec.fields[n];
        else p.rev = [time, "legacy"];
      }
      if (Object.keys(rec.fields).length) add[key] = rec;
    }
    return add;
  }

  return { ROOT, pathFor, keyOf, valid, comparePart, mergeRecord, merge, same, covers, recordsOf, envelope,
    isDeleted, updatedOf, project, items, deletedItems, find, partsOf, create, edit, remove, restore, diff,
    stableId, importLegacy, canonical };
});
