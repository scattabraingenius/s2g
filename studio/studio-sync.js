/* Studio Board song decisions: song status, chosen take, next action and song notes, plus the chosen lyric
   version per song. Same record pattern as lyrics/sync.js and planner-sync.js (one record per item, a revision
   each, last writer wins, tombstones for deletions, Firebase transactions that merge). Lives at its own path so
   the older boards, whose validators reject unknown record kinds, never see these records. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioSync = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const PATH = "planners/the-grind-scattabrain-2026/album/studio/accounts/";
  const KINDS = ["song", "pick"];
  const STATUSES = ["needs_review", "incomplete", "complete"];
  const copy = value => JSON.parse(JSON.stringify(value));
  const canonical = value => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
  const equal = (a, b) => canonical(a) === canonical(b);
  const keyOf = (kind, id, field = "") => Array.from(new TextEncoder().encode(JSON.stringify([kind, id, field])), n => n.toString(16).padStart(2, "0")).join("");

  function empty() { return {songs:{}, pick:{}}; }
  function cleanSong(song) {
    const out = {};
    if (STATUSES.includes(song?.status)) out.status = song.status;
    for (const [k, max] of [["chosen", 80], ["lyric", 300], ["next", 500], ["notes", 20000]]) if (typeof song?.[k] === "string" && song[k]) out[k] = song[k].slice(0, max);
    return out;
  }
  function content(state) {
    const records = {};
    for (const [key, song] of Object.entries(state.songs || {})) {
      const data = cleanSong(song);
      if (Object.keys(data).length) records[keyOf("song", key)] = {kind:"song", id:key, data:JSON.stringify(data)};
    }
    for (const [slug, stem] of Object.entries(state.pick || {})) if (stem) records[keyOf("pick", slug)] = {kind:"pick", id:slug, data:JSON.stringify(stem)};
    return records;
  }
  function valid(key, record) {
    if (!record || typeof record.id !== "string" || record.id.length > 4096 || !KINDS.includes(record.kind)) return false;
    if (key !== keyOf(record.kind, record.id, record.field || "")) return false;
    if (!Array.isArray(record.rev) || !Number.isFinite(record.rev[0]) || typeof record.rev[1] !== "string") return false;
    if (record.deleted === true) return true;
    let value; try { value = JSON.parse(record.data); } catch (err) { return false; }
    if (record.kind === "song") return !!value && typeof value === "object" && !Array.isArray(value);
    return typeof value === "string";
  }
  function recordsOf(envelope) {
    if (envelope == null) return {};
    if (envelope.v !== 1 || !envelope.records || typeof envelope.records !== "object") throw Error("Unsupported song-decision cloud data. Local data is safe.");
    const entries = Object.entries(envelope.records);
    if (entries.some(([key, value]) => !valid(key, value))) throw Error("Invalid song-decision cloud data. Local data is safe.");
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
    const result = {...empty(), ...copy(state || {})};
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
    for (const record of Object.values(records)) {
      if (record.deleted) continue;
      const value = JSON.parse(record.data);
      if (record.kind === "song") state.songs[record.id] = cleanSong(value);
      else if (record.kind === "pick") state.pick[record.id] = value;
    }
    return state;
  }
  function sameRecords(a, b) { const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => equal(a[key], b[key])); }

  function create(options) {
    const {firebase, read, replace, selectAccount, status} = options;
    let user = null, ref = null, connection = null, ready = false, connected = false;
    let remote = {}, timer = null, writing = false, generation = 0, error = "";
    const auth = firebase.auth();
    function report() {
      if (error) return status(error, true);
      if (!user) return status("Song decisions are saved on this device.");
      if (!connected) return status("Song decisions: offline, they'll sync when connected.");
      if (!ready) return status("Loading song decisions…");
      if (writing || !sameRecords(remote, read()._sync.records)) return status("Saving song decisions…");
      status("Song decisions synced");
    }
    function stop() {
      generation++; clearTimeout(timer); timer = null;
      for (const r of [ref, connection]) if (r) r.off();
      ref = connection = null; ready = connected = writing = false; remote = {};
    }
    function fail(err, token) {
      if (token !== generation) return;
      error = /permission/i.test((err?.code || "") + (err?.message || "")) ? "Song decisions stay on this device: the database doesn't allow the new studio path yet." : "Song decisions didn't sync. They're kept on this device; retry when connected.";
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
      stop(); user = nextUser || null; error = "";
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
    const unsubscribe = auth.onAuthStateChanged(attach, () => { error = "Sign-in could not be restored. Song decisions are on this device."; report(); });
    return {changed:schedule, retry:() => attach(auth.currentUser), stop:() => { stop(); unsubscribe(); }};
  }
  return {PATH, KINDS, empty, content, prepare, capture, merge, project, recordsOf, sameRecords, keyOf, cleanSong, create};
});
