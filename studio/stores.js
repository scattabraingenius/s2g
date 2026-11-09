/* Studio Board stores. Each store keeps the localStorage key, Firebase path and record format of the board that
   owns it, so the older boards keep reading and writing the same data while both are in use.
     lyric   grind.album.v1    .../album/accounts/<uid>          lyric ratings, highlights, my copies (AlbumSync)
     audio   grind.audio.v1    .../album/audio/accounts/<uid>    take scores, notes, readiness       (planner.js)
     planner grind.planner.v1  .../album/planner/accounts/<uid>  albums, statuses, sessions, tags    (planner.js)
     studio  grind.studio.v1   .../album/studio/accounts/<uid>   song decisions, chosen lyric        (StudioSync)
   The audio and planner stores are owned by the hosted planner.js (window.PlannerApp); this file owns lyric and studio. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioStores = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const DEFAULT_ALBUMS = {debut:{name:"Album 1 · Debut", created:1, order:[], cut:[], target:12, statusV:2}, second:{name:"Album 2", created:2, order:[], cut:[], target:12, statusV:2}};
  const clone = v => JSON.parse(JSON.stringify(v));
  function readJson(storage, key) { try { const v = JSON.parse(storage.getItem(key)); if (v && typeof v === "object") return v; } catch (err) {} return null; }
  // Lyric Board v1 data was keyed by song slug; board.js moves it onto the picked (or last) version. Same rule here.
  function migrateLyric(st, lyricBySlug) {
    st = {ratings:{}, tracklist:[], pick:{}, custom:{}, collections:{}, ...st};
    if (st.v !== 2) {
      st = clone(st);
      for (const slug of Object.keys(st.ratings)) {
        const s = lyricBySlug[slug]; if (!s) continue;
        const stem = st.pick[slug] || s.versions[s.versions.length - 1].stem;
        st.ratings[stem] = {...st.ratings[slug], ...(st.ratings[stem] || {})};
        delete st.ratings[slug];
      }
      st.v = 2;
    }
    return st;
  }
  function normalizePlan(plan) {
    if (!Object.keys(plan.albums || {}).length) plan.albums = clone(DEFAULT_ALBUMS);
    for (const a of Object.values(plan.albums)) { a.order ||= []; a.cut ||= []; a.target ||= 12; }
    return plan;
  }

  // One locally persisted, account-synced store (the same lifecycle board.js and planner.js use).
  function syncedStore({storage, key, lib, load, sync, onChange, onStatus, beforeFirstSync = true}) {
    let state = load(readJson(storage, key)), previous = clone(state), cloud = null, failed = false;
    let device = null;
    try { device = storage.getItem(key + ".device"); } catch (err) {}
    if (!device) { device = (globalThis.crypto?.randomUUID?.() || String(Math.random()).slice(2)); try { storage.setItem(key + ".device", device); } catch (err) {} }
    function persist() {
      try {
        if (state._sync.owner) storage.setItem(key + ".account." + state._sync.owner, JSON.stringify(state));
        storage.setItem(key, JSON.stringify(state));
        failed = false; return true;
      } catch (err) { failed = true; onStatus("This device couldn't save. Export a backup before closing.", true); return false; }
    }
    function save() {
      state = lib.capture(previous, state, device); previous = clone(state);
      persist(); cloud?.changed(); onChange("local");
    }
    function replace(next) { state = next; previous = clone(state); persist(); onChange("remote"); }
    function selectAccount(uid) {
      if (!state._sync.owner && beforeFirstSync) {
        try { if (!storage.getItem(key + ".before-cloud-sync")) storage.setItem(key + ".before-cloud-sync", JSON.stringify(state)); }
        catch (err) { throw Error("A local backup couldn't be saved. Export a backup, then retry sync."); }
      }
      if (state._sync.owner && state._sync.owner !== uid) {
        if (!persist()) throw Error("Export a backup before switching accounts: local saving failed.");
        const cached = readJson(storage, key + ".account." + uid);
        replace(load(cached?._sync?.owner === uid ? cached : null));
      }
    }
    // Another tab of any board changed this store on this device: merge it in (same account only).
    function mergeFromStorage(raw) {
      try {
        const incoming = load(JSON.parse(raw));
        if ((incoming._sync?.owner || null) !== (state._sync.owner || null)) return;
        const merged = lib.merge(state._sync.records, incoming._sync.records);
        if (!lib.sameRecords(merged, state._sync.records)) { state = projectFrom(merged); previous = clone(state); onChange("remote"); }
      } catch (err) {}
    }
    const projectFrom = records => sync.project(state, records, state._sync.owner);
    return {
      get state() { return state; }, set state(next) { state = next; },
      save, replace, selectAccount, mergeFromStorage, persist,
      start(firebase, status) { cloud = sync.create({firebase, read:() => state, replace, selectAccount, status, account:() => {}}); return cloud; },
      retry() { cloud?.retry(); },
    };
  }

  function create({storage = globalThis.localStorage, firebase = globalThis.firebase, AlbumSync = globalThis.AlbumSync, StudioSync = globalThis.StudioSync, planner = () => globalThis.PlannerApp, lyricBySlug = {}, onChange = () => {}, onStatus = () => {}} = {}) {
    const lyric = syncedStore({storage, key:"grind.album.v1", lib:AlbumSync,
      load:raw => AlbumSync.prepare(migrateLyric(raw || {}, lyricBySlug)),
      sync:{project:(base, records, owner) => AlbumSync.project(base, records, owner), create:o => AlbumSync.create({...o, board:"lyrics"})},
      onChange:why => onChange("lyric", why), onStatus:(t, f) => onStatus("lyric", t, f)});
    const studio = syncedStore({storage, key:"grind.studio.v1", lib:StudioSync,
      load:raw => StudioSync.prepare(raw || StudioSync.empty()),
      sync:{project:(base, records, owner) => StudioSync.project(records, owner), create:o => StudioSync.create(o)},
      onChange:why => onChange("studio", why), onStatus:(t, f) => onStatus("studio", t, f), beforeFirstSync:false});
    globalThis.addEventListener?.("storage", e => {
      if (e.key === "grind.album.v1" && e.newValue) lyric.mergeFromStorage(e.newValue);
      if (e.key === "grind.studio.v1" && e.newValue) studio.mergeFromStorage(e.newValue);
    });

    // Undo for lyric review changes (statuses, tags, readiness, highlights), like lyric-review.js: 30 steps.
    const undoStack = [];
    function setLyric(stem, values, {undoable = true} = {}) {
      const current = lyric.state.ratings[stem] || {};
      if (undoable) { undoStack.push({stem, values:Object.fromEntries(Object.keys(values).map(k => [k, clone(current[k] ?? null)]))}); if (undoStack.length > 30) undoStack.shift(); }
      lyric.state.ratings[stem] = {...current, ...values, at:Date.now()};
      lyric.save();
    }
    function undoLyric() { const last = undoStack.pop(); if (!last) return false; setLyric(last.stem, last.values, {undoable:false}); return true; }
    function addCustom(slug, version) { (lyric.state.custom[slug] ||= []).push(version); lyric.save(); }
    function updateCustom(slug, stem, values) {
      const v = (lyric.state.custom[slug] || []).find(x => x.stem === stem); if (!v) return;
      Object.assign(v, values); if (values.lyrics != null) v.suno = {...(v.suno || {}), lyrics:values.lyrics};
      lyric.save();
    }
    function deleteCustom(slug, stem) {
      lyric.state.custom[slug] = (lyric.state.custom[slug] || []).filter(x => x.stem !== stem);
      if (!lyric.state.custom[slug].length) delete lyric.state.custom[slug];
      delete lyric.state.ratings[stem];
      for (const c of Object.values(lyric.state.collections || {})) c.members = (c.members || []).filter(m => m !== stem);
      if (studio.state.pick[slug] === stem) { delete studio.state.pick[slug]; studio.save(); }
      lyric.save();
    }
    function setSong(key, values) {
      const next = StudioSync.cleanSong({...(studio.state.songs[key] || {}), ...values});
      if (Object.keys(next).length) studio.state.songs[key] = next; else delete studio.state.songs[key];
      studio.save();
    }
    function setPick(slug, stem) { if (studio.state.pick[slug] === stem) return; if (stem) studio.state.pick[slug] = stem; else delete studio.state.pick[slug]; studio.save(); }
    function importLyric(data) {
      if (data?.app === "album-board") {
        lyric.state = {...lyric.state, ratings:data.ratings || {}, tracklist:data.tracklist || [], pick:data.pick || {}, custom:data.custom || {}, collections:data.collections || {}, v:data.v || 2};
        lyric.save(); return "Lyric Board scores imported";
      }
      if (data?.app === "lyric-review-backup") {
        const incoming = AlbumSync.prepare(migrateLyric(data.lyrics || {}, lyricBySlug));
        if (incoming._sync.owner && lyric.state._sync.owner && incoming._sync.owner !== lyric.state._sync.owner) throw Error("that backup belongs to a different account");
        lyric.replace(AlbumSync.project(lyric.state, AlbumSync.merge(lyric.state._sync.records, incoming._sync.records), lyric.state._sync.owner));
        lyric.save(); return "Review backup restored";
      }
      throw Error("not a Lyric Board export or review backup");
    }
    function start() {
      if (!firebase?.auth || !firebase?.database || !firebase.apps?.length) { onStatus("lyric", "Lyric reviews are saved on this device."); return; }
      try {
        lyric.start(firebase, (t, f) => onStatus("lyric", t, f));
        studio.start(firebase, (t, f) => onStatus("studio", t, f));
      } catch (err) { onStatus("lyric", "Lyric sync couldn't start. Your changes are saved on this device.", true); }
    }
    return {
      start, retry:() => { lyric.retry(); studio.retry(); },
      lyric:() => lyric.state, studio:() => studio.state,
      audio:() => planner()?.audio || {ratings:{}}, planner:() => planner()?.state || normalizePlan({albums:{}, considered:{}, sessions:{}}),
      setLyric, undoLyric, canUndoLyric:() => undoStack.length > 0, addCustom, updateCustom, deleteCustom, setSong, setPick, importLyric,
      exportLyric:() => { const {_sync, ...s} = lyric.state; return {app:"album-board", exported:new Date().toISOString(), ...s}; },
      exportReview:() => ({app:"lyric-review-backup", exported:new Date().toISOString(), lyrics:lyric.state, audio:planner()?.audio || null}),
      exportStudio:() => { const {_sync, ...s} = studio.state; return {app:"studio-board", exported:new Date().toISOString(), ...s}; },
    };
  }
  return {create, migrateLyric, normalizePlan, DEFAULT_ALBUMS};
});
