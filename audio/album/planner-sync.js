/* Album Planner account sync. Same pattern as Lyric/Audio Board sync (lyrics/sync.js):
   each planner item is its own record with a revision, records merge last-writer-wins,
   deletions keep tombstones, and Firebase transactions merge instead of replacing.
   Scores, status and notes are Audio Board records, synced by lyrics/sync.js. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlannerSync = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const PATH = "planners/the-grind-scattabrain-2026/album/planner/accounts/";
  const AUDIO_PATH = "planners/the-grind-scattabrain-2026/album/audio/accounts/";
  const KINDS = ["consider", "session", "smember", "album"];
  const copy = value => JSON.parse(JSON.stringify(value));
  // Firebase may reorder object properties. Compare record contents consistently.
  const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
  const equal = (a, b) => canonical(a) === canonical(b);
  const keyOf = (kind, id, field = "") => Array.from(new TextEncoder().encode(JSON.stringify([kind, id, field])), n => n.toString(16).padStart(2, "0")).join("");

  function empty() { return {considered:{}, sessions:{}, albums:{}}; }
  function content(state) {
    const records = {};
    const put = (kind, id, field, value) => { records[keyOf(kind, id, field)] = {kind, id, field, data:JSON.stringify(value)}; };
    for (const [stem, item] of Object.entries(state.considered || {})) put("consider", stem, "", item);
    for (const [id, session] of Object.entries(state.sessions || {})) {
      const {members, ...meta} = session;
      put("session", id, "", meta);
      for (const stem of new Set(members || [])) put("smember", stem, id, true);
    }
    for (const [id, album] of Object.entries(state.albums || {})) put("album", id, "", album);
    return records;
  }
  function valid(key, record) {
    if (!record || typeof record.id !== "string" || record.id.length > 4096 || !KINDS.includes(record.kind)) return false;
    if (key !== keyOf(record.kind, record.id, record.field || "")) return false;
    if (!Array.isArray(record.rev) || !Number.isFinite(record.rev[0]) || typeof record.rev[1] !== "string") return false;
    if (record.deleted === true) return true;
    let value; try { value = JSON.parse(record.data); } catch (err) { return false; }
    if (record.kind === "consider") return value && typeof value === "object";
    if (record.kind === "session") return typeof value?.name === "string";
    if (record.kind === "smember") return value === true && typeof record.field === "string";
    if (record.kind === "album") return typeof value?.name === "string" && Array.isArray(value.order);
    return false;
  }
  function recordsOf(envelope) {
    if (envelope == null) return {};
    if (envelope.v !== 1 || !envelope.records || typeof envelope.records !== "object") throw Error("Unsupported planner cloud data. Local plan is safe; export a backup.");
    const entries = Object.entries(envelope.records);
    if (entries.some(([key, value]) => !valid(key, value))) throw Error("Invalid planner cloud data. Local plan is safe; export a backup.");
    return Object.fromEntries(entries);
  }
  function compare(a, b) {
    const left = canonical(a), right = canonical(b);
    return a.rev[0] - b.rev[0] || (a.rev[1] < b.rev[1] ? -1 : a.rev[1] > b.rev[1] ? 1 : left < right ? -1 : left > right ? 1 : 0);
  }
  function merge(a, b) {
    const result = {...a};
    for (const [key, value] of Object.entries(b)) if (!Object.prototype.hasOwnProperty.call(result, key) || compare(value, result[key]) > 0) result[key] = copy(value);
    return result;
  }
  function prepare(state) {
    const result = {...empty(), ...copy(state)};
    if (result._sync?.v === 1) return result;
    const records = content(result);
    for (const record of Object.values(records)) record.rev = [0, "legacy"];
    result._sync = {v:1, owner:null, records};
    return result;
  }
  function capture(before, state, device, now = Date.now()) {
    const result = prepare(state), prior = content(before), next = content(state);
    const records = {...result._sync.records};
    const time = Math.max(now, ...Object.values(records).map(record => record.rev[0] + 1));
    for (const key of new Set([...Object.keys(prior), ...Object.keys(next)])) {
      if (equal(prior[key], next[key])) continue;
      records[key] = next[key] ? {...next[key], rev:[time, device]} : {...prior[key], deleted:true, rev:[time, device]};
    }
    result._sync.records = records;
    return result;
  }
  function project(records, owner) {
    const state = {...empty(), _sync:{v:1, owner, records:copy(records)}};
    const members = new Map();
    for (const record of Object.values(records)) {
      if (record.deleted) continue;
      const value = JSON.parse(record.data);
      if (record.kind === "consider") state.considered[record.id] = value;
      else if (record.kind === "session") state.sessions[record.id] = {...value, members:[]};
      else if (record.kind === "smember") { const list = members.get(record.field) || []; list.push(record.id); members.set(record.field, list); }
      else if (record.kind === "album") state.albums[record.id] = value;
    }
    for (const [id, list] of members) if (state.sessions[id]) state.sessions[id].members = list.sort();
    return state;
  }
  function sameRecords(a, b) { const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => equal(a[key], b[key])); }

  // Cloud connection for the planner's own records.
  function create(options) {
    const {firebase, read, replace, selectAccount, status, account} = options;
    let user = null, ref = null, connection = null, ready = false, connected = false;
    let remote = {}, timer = null, writing = false, generation = 0, error = "", authBusy = false;
    const auth = firebase.auth();
    function report() {
      account(user, authBusy);
      if (error) return status(error, true);
      if (!user) return status("Saved on this device. Sign in with Google to sync and to load your Audio Board scores.");
      if (!connected) return status("Saved on this device. Offline, changes will sync when connected.");
      if (!ready) return status("Loading your album plan…");
      if (writing || !sameRecords(remote, read()._sync.records)) return status("Saving to your account…");
      status("Synced across devices · " + (user.email || user.displayName || "Google account"));
    }
    function stop() {
      generation++; clearTimeout(timer); timer = null;
      for (const r of [ref, connection]) if (r) r.off();
      ref = connection = null; ready = connected = writing = false; remote = {};
    }
    function fail(err, token) {
      if (token !== generation) return;
      error = /permission/i.test((err?.code || "") + (err?.message || "")) ? "This Google account can't sync the planner yet (database permission). Your local plan is safe." : "Sync failed. Your local changes are kept; retry sync when connected.";
      report();
    }
    function schedule() {
      clearTimeout(timer);
      if (!ref || !ready || !connected || writing || error || sameRecords(remote, read()._sync.records)) { report(); return; }
      const token = generation; report();
      timer = setTimeout(async () => {
        timer = null; if (token !== generation) return;
        const sent = copy(read()._sync.records), target = ref;
        writing = true; report();
        try {
          const result = await target.transaction(current => ({v:1, records:merge(recordsOf(current), sent)}), undefined, false);
          if (token !== generation) return;
          if (!result.committed) throw Error("Sync transaction was not committed");
          remote = recordsOf(result.snapshot.val());
          replace(project(merge(remote, read()._sync.records), user.uid));
        } catch (err) { fail(err, token); }
        if (token !== generation) return;
        writing = false; report(); schedule();
      }, options.delay ?? 250);
    }
    function attach(nextUser) {
      stop(); user = nextUser || null; error = ""; authBusy = false;
      if (!user) { report(); return; }
      const token = generation;
      try { selectAccount(user.uid); } catch (err) { error = err.message; report(); return; }
      ref = firebase.database().ref(PATH + user.uid);
      connection = firebase.database().ref(".info/connected");
      connection.on("value", snapshot => { if (token !== generation) return; connected = snapshot.val() === true; if (connected) schedule(); else report(); });
      ref.on("value", snapshot => {
        if (token !== generation) return;
        try {
          remote = recordsOf(snapshot.val()); ready = true; error = "";
          const current = read(), combined = merge(remote, current._sync.records);
          if (current._sync.owner !== user.uid || !sameRecords(combined, current._sync.records)) replace(project(combined, user.uid));
          schedule();
        } catch (err) { ready = false; error = err.message; report(); }
      }, err => { ready = false; fail(err, token); });
      report();
    }
    async function signIn() {
      if (authBusy) return;
      authBusy = true; error = ""; report();
      const provider = new firebase.auth.GoogleAuthProvider();
      try { await auth.signInWithPopup(provider); }
      catch (err) {
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(err.code)) {
          try { await auth.signInWithRedirect(provider); } catch (e) { authBusy = false; error = "Sign-in failed. Your local plan is safe."; report(); }
        } else { authBusy = false; error = err.code === "auth/popup-closed-by-user" ? "" : "Sign-in failed. Your local plan is safe."; report(); }
      }
    }
    const unsubscribe = auth.onAuthStateChanged(attach, () => { error = "Sign-in could not be restored. Your local plan is safe."; report(); });
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    return {changed:schedule, signIn, signOut:() => auth.signOut().catch(() => { error = "Sign-out failed. Please retry."; report(); }), retry:() => attach(auth.currentUser), stop:() => { stop(); unsubscribe(); }};
  }
  return {PATH, AUDIO_PATH, empty, content, prepare, capture, merge, project, recordsOf, sameRecords, keyOf, create};
});
