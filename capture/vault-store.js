/* Vault store: the one place every page (main app, capture page, dashboard card) reads and writes
   the Vault. Built on VaultSync records.

   The rule that keeps ideas safe: nothing is reported as saved until a synchronous localStorage write
   has returned. Each change is written to its OWN key, grind.vault.pending.<key>, so two tabs saving
   at the same moment can never overwrite each other. A pending key is removed only after the server
   has confirmed a record at least that new, so closing the page, going offline or being signed out
   never loses anything: the next page that opens (any of the three) sends it.

   Keys: grind.vault.v2 (last merged copy), grind.vault.pending.* (unconfirmed changes),
   grind.vault.v1 (old-format mirror for older pages), grind.deviceId.v1 (this browser's id). */
(function (root, factory) {
  const api = factory(root.VaultSync || (typeof require === "function" ? require("./vault-sync.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.VaultStore = api;
})(typeof window === "object" ? window : globalThis, function (S) {
  "use strict";
  const CACHE = "grind.vault.v2", PENDING = "grind.vault.pending.", LEGACY = "grind.vault.v1", DEVICE = "grind.deviceId.v1";

  function create(opts = {}) {
    const storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : null);
    const clock = opts.now || (() => Date.now());
    const listeners = new Set();
    const mem = {};                           // changes that could not be written to storage
    let cache = {}, pending = {}, ref = null, valueFn = null, syncing = false, again = false;
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

    function load() {
      try { cache = S.recordsOf(JSON.parse(get(CACHE) || "null")); } catch (e) { cache = {}; }
      pending = {};
      for (const k of keys()) {
        if (!k || !k.startsWith(PENDING)) continue;
        try { const r = JSON.parse(get(k)), key = k.slice(PENDING.length); if (S.valid(key, r)) pending[key] = r; } catch (e) {}
      }
    }
    const all = () => S.merge(S.merge(cache, pending), mem);
    function persistCache() {
      try { set(CACHE, JSON.stringify(S.envelope(cache))); } catch (e) {}
      try { set(LEGACY, JSON.stringify(S.entries(all()))); } catch (e) {}
    }
    const emit = () => { for (const fn of listeners) { try { fn(); } catch (e) {} } };
    const setStatus = patch => { status = { ...status, ...patch }; emit(); };

    /* Write one change durably, then show it. Returns {ok, durable, id}. */
    function commit(rec) {
      if (!rec) return { ok: false, durable: false };
      const key = S.keyOf(rec.id);
      let durable = true;
      try { set(PENDING + key, JSON.stringify(rec)); pending[key] = rec; delete mem[key]; }
      catch (e) { durable = false; mem[key] = rec; status = { ...status, storageFailed: true }; }
      persistCache(); emit(); sync();
      return { ok: true, durable, id: rec.id };
    }
    const current = id => S.find(all(), id);

    /* Server state arrived (listener or a finished transaction): keep it, and drop every pending
       change the server already has at least as new. */
    function absorb(server) {
      cache = S.merge(cache, server);
      for (const [key, rec] of Object.entries(pending)) if (server[key] && S.compare(server[key], rec) >= 0) { del(PENDING + key); delete pending[key]; }
      for (const [key, rec] of Object.entries(mem)) if (server[key] && S.compare(server[key], rec) >= 0) delete mem[key];
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
          try { return S.envelope(S.merge(S.recordsOf(cur), all())); } catch (e) { bad = e; return undefined; }
        }, undefined, false);
        if (bad) throw bad;
        if (target !== ref) return;
        absorb(S.recordsOf(res && res.snapshot ? res.snapshot.val() : null));
        setStatus({ cloud: "synced", error: "", lastSynced: clock() });
      } catch (e) {
        if (target === ref) setStatus({ cloud: "error", error: (e && (e.code || e.message)) || "Sync failed" });
      } finally {
        syncing = false;
        if (again) { again = false; sync(); }
      }
    }

    const api = {
      device,
      entries: () => S.entries(all()),
      deleted: () => S.deleted(all()),
      get: id => { const r = current(id); return r && !r.deleted ? { id: r.id, ...JSON.parse(r.data) } : null; },
      pendingCount: () => Object.keys(pending).length + Object.keys(mem).length,
      isPending: id => { const k = S.keyOf(id); return !!(pending[k] || mem[k]); },
      status: () => ({ ...status, pending: api.pendingCount() }),
      add: fields => commit(S.create(fields || {}, device, clock())),
      edit: (id, patch) => { const r = current(id); return r && !r.deleted ? commit(S.edit(r, patch, device, clock())) : { ok: false }; },
      remove: id => { const r = current(id); return r && !r.deleted ? commit(S.remove(r, device, clock())) : { ok: false }; },
      restore: id => { const r = current(id); return r && r.deleted ? commit(S.restore(r, device, clock())) : { ok: false }; },
      /* Old-format entries (cloud mirror, grind.vault.v1, an import file). Union only. */
      importLegacy(list) {
        const add = S.importLegacy(all(), list);
        if (!Object.keys(add).length) return 0;
        cache = S.merge(cache, add); persistCache(); emit(); sync();
        return Object.keys(add).length;
      },
      attach(nextRef) {
        api.detach();
        ref = nextRef; setStatus({ cloud: "syncing", error: "" });
        valueFn = ref.on("value", snap => {
          if (ref !== nextRef) return;
          let server;
          try { server = S.recordsOf(snap.val()); } catch (e) { setStatus({ cloud: "error", error: e.message }); return; }
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
    /* Another tab saved or synced: pick up its pending keys and cache. */
    if (opts.listen !== false && typeof addEventListener === "function" && storage && typeof localStorage !== "undefined" && storage === localStorage) {
      addEventListener("storage", e => { if (!e.key || e.key === CACHE || e.key.startsWith(PENDING)) { load(); emit(); if (ref && api.pendingCount()) sync(); } });
    }
    return api;
  }

  return { create, CACHE, PENDING, LEGACY, DEVICE };
});
