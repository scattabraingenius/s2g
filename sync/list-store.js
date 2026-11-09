/* List store: local storage, pending changes and cloud sync for one main-app list, built on ListSync
   records. Tasks Sync v2 uses it for `tasks`; the other lists can follow with their own name.

   The rule that keeps changes safe: nothing is shown as saved until a synchronous localStorage write
   has returned. Each change is written to its OWN key, grind.<list>.pending.<item>~<n>, so two tabs
   saving at the same moment can never overwrite each other. A pending key is removed only once the
   server holds every part of it at least as new, so closing the page, going offline or being signed
   out never loses anything: the next page that opens sends it.

   Upgrade rule (decided 2026-11-09): the list this device held before Tasks Sync v2 (the old local key)
   is kept as a display-only BASELINE until the first cloud snapshot of the planner arrives. Then the
   cloud copy wins once, exactly as before, so a device opened after a long gap cannot bring back items
   deleted elsewhere. An item touched after the upgrade is claimed whole and kept. If the cloud has no
   copy at all, the baseline is promoted into records instead. A device that never signs in keeps it.

   Keys: grind.<list>.v2 (last merged copy), grind.<list>.pending.* (unconfirmed changes),
   grind.<list>.baseline.v1 / grind.<list>.adopted.v1 (upgrade), the old key (old-format mirror for
   older pages and the dashboard), grind.deviceId.v1 (this browser's id, shared with the Vault). */
(function (root, factory) {
  const api = factory(root.ListSync || (typeof require === "function" ? require("./list-sync.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ListStore = api;
})(typeof window === "object" ? window : globalThis, function (S) {
  "use strict";
  const DEVICE = "grind.deviceId.v1";

  function create(opts = {}) {
    const list = opts.list || "tasks", label = opts.label || "List";
    const CACHE = `grind.${list}.v2`, PENDING = `grind.${list}.pending.`, BASELINE = `grind.${list}.baseline.v1`, ADOPTED = `grind.${list}.adopted.v1`;
    const LEGACY = opts.legacyKey || null, groups = opts.groups || [];
    /* Fills an item's default parts (for tasks: migrateTask). Must be deterministic. */
    const normalize = opts.normalize || null, shape = list => normalize ? list.map(i => ({ ...normalize(i), id: i.id })) : list;
    const storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const clock = opts.now || (() => Date.now());
    const listeners = new Set();
    const mem = {};                           // changes that could not be written to storage, by item key
    let cache = {}, pending = {}, baseline = {}, adopted = false, shown = new Set(), ref = null, valueFn = null, syncing = false, again = false, seq = 0;
    let status = { cloud: "off", error: "", lastSynced: 0, storageFailed: false };

    const get = k => { try { return storage ? storage.getItem(k) : null; } catch (e) { return null; } };
    const set = (k, v) => { storage.setItem(k, v); };   // throws on purpose: callers decide
    const del = k => { try { storage && storage.removeItem(k); } catch (e) {} };
    const keys = () => { const out = []; try { for (let i = 0; i < storage.length; i++) out.push(storage.key(i)); } catch (e) {} return out; };
    const device = (() => {
      let d = get(DEVICE);
      if (!d) { d = "d" + Math.random().toString(36).slice(2, 10); try { set(DEVICE, d); } catch (e) {} }
      return d;
    })();
    const readRecords = k => { try { return S.recordsOf(JSON.parse(get(k) || "null"), label); } catch (e) { return {}; } };
    const itemKeyOf = storageKey => storageKey.slice(PENDING.length).split("~")[0];

    function load() {
      cache = readRecords(CACHE);
      pending = {};
      for (const k of keys()) {
        if (!k || !k.startsWith(PENDING)) continue;
        try { const r = JSON.parse(get(k)); if (S.valid(itemKeyOf(k), r)) pending[k] = r; } catch (e) {}
      }
      adopted = get(ADOPTED) === "1";
      baseline = {};
      if (!adopted) {
        if (get(BASELINE) != null) baseline = readRecords(BASELINE);
        else {
          let old = null; try { old = LEGACY ? JSON.parse(get(LEGACY) || "null") : null; } catch (e) {}
          baseline = S.importLegacy({}, old, { normalize });
          try { set(BASELINE, JSON.stringify(S.envelope(baseline))); } catch (e) {}
        }
      }
    }
    function pendingRecords() {
      let out = {};
      for (const [k, r] of Object.entries(pending)) out = S.merge(out, { [itemKeyOf(k)]: r });
      return S.merge(out, mem);
    }
    const all = () => S.merge(cache, pendingRecords());          // what this device sends
    const view = () => S.merge(baseline, all());                  // what this device shows
    function persistCache() {
      try { set(CACHE, JSON.stringify(S.envelope(cache))); } catch (e) {}
      if (LEGACY) { try { set(LEGACY, JSON.stringify(S.items(view()))); } catch (e) {} }
    }
    const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) {} } };
    const setStatus = patch => { status = { ...status, ...patch }; emit(); };

    /* Write changes durably, then show them. Each item's change goes to a fresh key that also folds in
       this tab's earlier unconfirmed changes to that item; those older keys are removed only after. */
    function commit(recs) {
      let durable = true;
      for (const [key, rec0] of Object.entries(recs)) {
        const mine = Object.keys(pending).filter(k => itemKeyOf(k) === key);
        let rec = rec0;
        for (const k of mine) rec = S.mergeRecord(pending[k], rec);
        if (mem[key]) rec = S.mergeRecord(mem[key], rec);
        const storageKey = `${PENDING}${key}~${clock().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
        try {
          set(storageKey, JSON.stringify(rec)); pending[storageKey] = rec; delete mem[key];
          for (const k of mine) { del(k); delete pending[k]; }
        } catch (e) { durable = false; mem[key] = rec; status = { ...status, storageFailed: true }; }
      }
      persistCache(); emit(); sync();
      return durable;
    }

    /* Server state arrived (listener or a finished transaction): keep it, and drop every pending
       change the server already holds at least as new. */
    function absorb(server) {
      cache = S.merge(cache, server);
      for (const [k, rec] of Object.entries(pending)) if (S.covers(server[itemKeyOf(k)], rec)) { del(k); delete pending[k]; }
      for (const [key, rec] of Object.entries(mem)) if (S.covers(server[key], rec)) delete mem[key];
      persistCache();
    }
    const unsent = server => !S.same(S.merge(server, all()), server);

    async function sync() {
      if (!ref) return;
      if (syncing) { again = true; return; }
      syncing = true; setStatus({ cloud: "syncing" });
      const target = ref;
      try {
        let bad = null;
        const res = await target.transaction(cur => {
          try { return S.envelope(S.merge(S.recordsOf(cur, label), all())); } catch (e) { bad = e; return undefined; }
        }, undefined, false);
        if (bad) throw bad;
        if (target !== ref) return;
        absorb(S.recordsOf(res && res.snapshot ? res.snapshot.val() : null, label));
        setStatus({ cloud: "synced", error: "", lastSynced: clock() });
      } catch (e) {
        if (target === ref) setStatus({ cloud: "error", error: (e && (e.code || e.message)) || "Sync failed" });
      } finally {
        syncing = false;
        if (again) { again = false; sync(); }
      }
    }

    const api = {
      device, list,
      /* The live items, newest first. The ids handed out here are the only ones a later commitList()
         may delete by leaving them out. */
      items() { const out = shape(S.items(view())); shown = new Set(out.map(i => i.id)); return out; },
      /* The same list for the old-format mirror, without changing which ids count as shown. */
      mirror: () => shape(S.items(view())),
      deleted: () => S.deletedItems(all()),
      known: id => !!S.find(view(), id),
      pendingCount: () => new Set([...Object.keys(pending).map(itemKeyOf), ...Object.keys(mem)]).size,
      isPending: id => { const k = S.keyOf(id); return !!mem[k] || Object.keys(pending).some(p => itemKeyOf(p) === k); },
      status: () => ({ ...status, pending: api.pendingCount() }),
      /* The whole edited list -> records for what changed. {auto:true} for automatic changes (a Later
         task returning on its day): they never create, delete or outrank a real edit. */
      commitList(next, o = {}) {
        const current = view();
        const recs = S.diff(current, next, device, clock(), { auto: !!o.auto, shown: o.auto ? null : shown, groups, normalize });
        for (const key of Object.keys(recs)) {
          /* An item known only from the pre-upgrade baseline is claimed whole when touched, so it
             survives the cloud copy winning at the first snapshot. */
          if (baseline[key] && !all()[key]) recs[key] = S.mergeRecord(baseline[key], recs[key]);
        }
        if (!Object.keys(recs).length) return { ok: true, durable: true, changed: 0 };
        return { ok: true, durable: commit(recs), changed: Object.keys(recs).length };
      },
      restore(id) { const r = S.find(all(), id); return r && S.isDeleted(r) ? commit({ [S.keyOf(id)]: S.restore(r, device, clock()) }) : false; },
      /* Old-format items. Union only. An import file ({file:true}) may also carry newer edits and is
         written as pending changes; the cloud mirror is already in the cloud, so it goes to the cache. */
      importLegacy(listIn, o = {}) {
        const add = S.importLegacy(all(), listIn, { edits: !!o.file, groups, normalize });
        const n = Object.keys(add).length;
        if (!n) return 0;
        if (o.file) commit(add);
        else { cache = S.merge(cache, add); persistCache(); emit(); sync(); }
        return n;
      },
      /* The planner's cloud snapshot arrived. `cloudList` is its old-format array (or null), and
         `hasCopy` says whether the cloud holds a copy of this list at all. */
      adoptCloud(cloudList, hasCopy) {
        let changed = false;
        if (!adopted) {
          if (!hasCopy && Object.keys(baseline).length) {
            const promote = {};
            for (const [k, r] of Object.entries(baseline)) if (!all()[k]) promote[k] = r;
            if (Object.keys(promote).length) { commit(promote); changed = true; }
          }
          baseline = {}; adopted = true; changed = true;
          try { set(ADOPTED, "1"); } catch (e) {}
          del(BASELINE);
        }
        const added = Array.isArray(cloudList) ? api.importLegacy(cloudList) : 0;
        if (changed && !added) { persistCache(); emit(); }
        return added;
      },
      hasBaseline: () => !adopted && Object.keys(baseline).length > 0,
      attach(nextRef) {
        api.detach();
        ref = nextRef; setStatus({ cloud: "syncing", error: "" });
        valueFn = ref.on("value", snap => {
          if (ref !== nextRef) return;
          let server;
          try { server = S.recordsOf(snap.val(), label); } catch (e) { setStatus({ cloud: "error", error: e.message }); return; }
          absorb(server); emit();
          if (unsent(server)) sync(); else if (!syncing) setStatus({ cloud: "synced", error: "", lastSynced: clock() });
        }, err => { if (ref === nextRef) setStatus({ cloud: "error", error: (err && (err.code || err.message)) || "Cloud read failed" }); });
        sync();
      },
      detach() {
        if (ref && valueFn) { try { ref.off("value", valueFn); } catch (e) {} }
        ref = null; valueFn = null; setStatus({ cloud: "off" });
      },
      setOffline(off) { if (ref) { if (off) setStatus({ cloud: "offline" }); else sync(); } },
      sync,
      reload() { load(); emit(); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };

    load();
    /* Another tab saved, synced or adopted: pick up its pending keys and cache. */
    if (opts.listen !== false && typeof addEventListener === "function" && storage && typeof localStorage !== "undefined" && storage === localStorage) {
      addEventListener("storage", e => {
        if (!e.key || e.key === CACHE || e.key === ADOPTED || e.key === BASELINE || e.key.startsWith(PENDING)) { load(); emit(); if (ref && api.pendingCount()) sync(); }
      });
    }
    return api;
  }

  return { create, DEVICE };
});
