/* Album Board account sync. Local records survive offline edits and reloads.
   Each rating field has its own revision; transactions merge records, never replace a planner. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AlbumSync = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const copy = value => JSON.parse(JSON.stringify(value));
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const fields = ["score", "songScore", "status", "note", "readiness", "tags", "colorLabels"];
  const ratingField = field => fields.includes(field) || /^mark:[a-z0-9-]+$/i.test(field);
  const keyOf = (kind, id, field = "") => Array.from(new TextEncoder().encode(JSON.stringify([kind, id, field])), n => n.toString(16).padStart(2, "0")).join("");
  // Firebase may reorder object properties. Compare record contents consistently.
  const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
  const equal = (a, b) => canonical(a) === canonical(b);
  function content(state) {
    const records = {};
    for (const [id, rating] of Object.entries(state.ratings || {})) {
      for (const field of Object.keys(rating)) if (ratingField(field)) {
        records[keyOf("rating", id, field)] = {kind:"rating", id, field, data:JSON.stringify(rating[field])};
      }
    }
    for (const [slug, versions] of Object.entries(state.custom || {})) {
      for (const version of versions) records[keyOf("custom", version.stem)] = {kind:"custom", id:version.stem, slug, data:JSON.stringify(version)};
    }
    (state.tracklist || []).forEach((id, index) => { records[keyOf("track", id)] = {kind:"track", id, data:JSON.stringify(index)}; });
    for (const [id, session] of Object.entries(state.collections || {})) {
      records[keyOf("collection", id)] = {kind:"collection", id, data:JSON.stringify({name:session.name, created:session.created})};
      for (const stem of new Set(session.members || [])) records[keyOf("member", stem, id)] = {kind:"member", id:stem, field:id, data:"true"};
    }
    return records;
  }
  function validRecord(key, record) {
    let value;
    try { if (!record?.deleted) { if (typeof record?.data !== "string") return false; value = JSON.parse(record.data); } } catch (err) { return false; }
    return record && typeof record.id === "string" && record.id.length < 4096 &&
      ["rating", "custom", "track", "collection", "member"].includes(record.kind) &&
      key === keyOf(record.kind, record.id, record.field || "") &&
      Array.isArray(record.rev) && Number.isFinite(record.rev[0]) && typeof record.rev[1] === "string" &&
      (record.deleted === true || (
        (record.kind !== "rating" || ratingField(record.field)) &&
        (record.kind !== "custom" || (typeof record.slug === "string" && value?.stem === record.id && value.custom === true)) &&
        (record.kind !== "track" || Number.isFinite(value)) &&
        (record.kind !== "collection" || (typeof value?.name === "string" && Number.isFinite(value.created))) &&
        (record.kind !== "member" || (typeof record.field === "string" && value === true))));
  }
  function recordsOf(envelope) {
    if (envelope == null) return {};
    if (envelope.v !== 1 || !envelope.records || typeof envelope.records !== "object" || Array.isArray(envelope.records)) throw Error("Unsupported board cloud data. Local data is safe; export a backup.");
    const entries = Object.entries(envelope.records);
    if (entries.some(([key, value]) => !validRecord(key, value))) throw Error("Invalid board cloud data. Local data is safe; export a backup.");
    return Object.fromEntries(entries);
  }
  function compare(a, b) {
    const left = canonical(a), right = canonical(b);
    return a.rev[0] - b.rev[0] || (a.rev[1] < b.rev[1] ? -1 : a.rev[1] > b.rev[1] ? 1 : left < right ? -1 : left > right ? 1 : 0);
  }
  function merge(a, b) {
    const result = {...a};
    for (const [key, value] of Object.entries(b)) if (!own(result, key) || compare(value, result[key]) > 0) result[key] = copy(value);
    return result;
  }
  function prepare(state) {
    const result = copy(state);
    if (result._sync?.v === 1) { recordsOf(result._sync); return result; }
    const records = content(result);
    for (const record of Object.values(records)) {
      // Undated legacy lists/copies must not resurrect a later deletion on another device.
      record.rev = [record.kind === "rating" ? Number(result.ratings[record.id].at) || 0 : 0, "legacy"];
    }
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
  function project(state, records, owner) {
    const result = {...state, ratings:{}, custom:{}, tracklist:[], collections:{}, _sync:{v:1, owner, records:copy(records)}};
    const ratings = new Map(), customs = new Map(), tracks = [], collections = new Map(), members = new Map();
    for (const record of Object.values(records)) {
      if (record.deleted) continue;
      const value = JSON.parse(record.data);
      if (record.kind === "rating") {
        const rating = ratings.get(record.id) || {};
        rating[record.field] = value; rating.at = Math.max(rating.at || 0, record.rev[0]); ratings.set(record.id, rating);
      } else if (record.kind === "custom") {
        const list = customs.get(record.slug) || []; list.push(value); customs.set(record.slug, list);
      } else if (record.kind === "track") tracks.push({...record, value});
      else if (record.kind === "collection") collections.set(record.id, value);
      else if (record.kind === "member") { const list = members.get(record.field) || []; list.push(record.id); members.set(record.field, list); }
    }
    result.ratings = Object.fromEntries(ratings);
    result.custom = Object.fromEntries([...customs].map(([slug, list]) => [slug, list.sort((a,b) => (a.created || 0) - (b.created || 0) || a.stem.localeCompare(b.stem))]));
    result.tracklist = tracks.sort((a,b) => a.value - b.value || a.id.localeCompare(b.id)).map(record => record.id);
    result.collections = Object.fromEntries([...collections].map(([id, session]) => [id, {...session, members:(members.get(id) || []).sort()}]));
    const customIds = new Set(Object.values(result.custom).flat().map(version => version.stem));
    result.pick = Object.fromEntries(Object.entries(state.pick || {}).filter(([, stem]) => !stem.startsWith("mine-") || customIds.has(stem)));
    return result;
  }
  function sameRecords(a, b) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => equal(a[key], b[key]));
  }
  function create(options) {
    const {firebase, config, read, replace, selectAccount, status, account} = options;
    let user = null, ref = null, connection = null, ready = false, connected = false;
    let remote = {}, timer = null, writing = false, generation = 0, error = "", authBusy = false;
    const auth = firebase.auth();
    const boardName = options.board === "audio" ? "Audio Board" : "Lyric Board";
    const accountPath = options.board === "audio" ? "planners/the-grind-scattabrain-2026/album/audio/accounts/" : "planners/the-grind-scattabrain-2026/album/accounts/";
    function report() {
      account(user, authBusy);
      if (error) return status(error, true);
      if (!user) return status("Saved on this device. Sign in with Google to sync across your phone and PCs.");
      if (!connected) return status("Saved on this device. Offline — changes will sync when connected.");
      if (!ready) return status("Loading your account’s "+boardName+"…");
      if (writing || !sameRecords(remote, read()._sync.records)) return status("Saving to your account…");
      status("Synced across devices · " + (user.email || user.displayName || "Google account"));
    }
    function stop() {
      generation++; clearTimeout(timer); timer = null;
      if (ref) ref.off(); if (connection) connection.off();
      ref = connection = null; ready = connected = writing = false; remote = {};
    }
    function fail(err, token) {
      if (token !== generation) return;
      error = /permission/i.test((err?.code || "") + (err?.message || "")) ? "This Google account is not authorized to sync. Your local data is safe." : "Sync failed. Your local changes are kept; retry sync when connected.";
      report();
    }
    function schedule() {
      clearTimeout(timer);
      if (!ref || !ready || !connected || writing || error || sameRecords(remote, read()._sync.records)) { report(); return; }
      const token = generation;
      report();
      timer = setTimeout(async () => {
        timer = null;
        if (token !== generation) return;
        const sent = copy(read()._sync.records), target = ref;
        writing = true; report();
        try {
          const result = await target.transaction(current => ({v:1, records:merge(recordsOf(current), sent)}), undefined, false);
          if (token !== generation) return;
          if (!result.committed) throw Error("Sync transaction was not committed");
          remote = recordsOf(result.snapshot.val());
          const combined = merge(remote, read()._sync.records);
          replace(project(read(), combined, user.uid));
        } catch (err) { fail(err, token); }
        if (token !== generation) return;
        writing = false; report(); schedule();
      }, options.delay ?? 250);
    }
    function attach(nextUser) {
      stop(); user = nextUser || null; error = ""; authBusy = false;
      if (!user) { report(); return; }
      const token = generation;
      try { selectAccount(user.uid); }
      catch (err) { error = err.message; report(); return; }
      // Existing planner rules apply at this child; nothing reads/writes unrelated planner fields.
      ref = firebase.database().ref(accountPath + user.uid);
      connection = firebase.database().ref(".info/connected");
      connection.on("value", snapshot => {
        if (token !== generation) return;
        connected = snapshot.val() === true;
        if (connected) schedule(); else report();
      });
      ref.on("value", snapshot => {
        if (token !== generation) return;
        try {
          remote = recordsOf(snapshot.val());
          ready = true; error = "";
          const current = read(), combined = merge(remote, current._sync.records);
          if (current._sync.owner !== user.uid || !sameRecords(combined, current._sync.records)) replace(project(current, combined, user.uid));
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
          try { await auth.signInWithRedirect(provider); }
          catch (redirectError) { authBusy = false; error = "Sign-in failed. Your local data is safe."; report(); }
        } else { authBusy = false; error = err.code === "auth/popup-closed-by-user" ? "" : "Sign-in failed. Your local data is safe."; report(); }
      }
    }
    const unsubscribe = auth.onAuthStateChanged(attach, err => { error = "Sign-in could not be restored. Your local data is safe."; report(); });
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(() => {});
    return {changed:schedule, signIn, signOut:() => auth.signOut().catch(() => { error = "Sign-out failed. Please retry."; report(); }), retry:() => attach(auth.currentUser), stop:() => { stop(); unsubscribe(); }};
  }
  return {prepare, capture, merge, project, recordsOf, sameRecords, keyOf, create};
});
