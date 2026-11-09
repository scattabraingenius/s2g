/* Local mode: only when the Studio Track Catalog server serves this page (it injects window.CATALOG_LOCAL).
   Adds Studio file paths and opening files, playlists and coverage, Refresh inventory, Save to Studio, and copies
   song decisions into the catalog's own notes (data/annotations.json) so its "Your call" view stays current.
   On the public site this file does nothing. */
(function (root) {
  "use strict";
  const session = root.CATALOG_LOCAL || null;
  const api = {enabled:!!session, catalog:null, ready:null};
  if (!session) { root.StudioLocal = api; return; }
  const headers = {"Content-Type":"application/json", "X-Catalog-Token":session.token};
  async function json(url, options) {
    const res = await fetch(url, options), data = await res.json().catch(() => ({}));
    if (!res.ok) throw Error(data.error || "the catalog server answered " + res.status);
    return data;
  }
  api.ready = json("/api/catalog").then(cat => {
    api.catalog = cat;
    api.filesBySong = {};
    const byId = Object.fromEntries((cat.files || []).map(f => [f.id, f]));
    for (const s of cat.songs || []) api.filesBySong[s.id] = (s.file_ids || []).map(id => byId[id]).filter(Boolean);
    return cat;
  }).catch(err => { api.error = err.message; return null; });
  api.fileUrl = id => "/api/file?id=" + encodeURIComponent(id);
  api.saveLyrics = body => json("/api/lyrics", {method:"POST", headers, body:JSON.stringify(body)});
  api.refresh = async (onDone) => {
    await json("/api/refresh", {method:"POST", headers, body:"{}"});
    for (let i = 0; i < 600; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const st = await json("/api/state");
      if (!st.refreshing) { onDone?.(st.refresh_error || null); return st; }
    }
    throw Error("the refresh is taking longer than 20 minutes");
  };
  // Song decisions -> the catalog's notes. Its validator only accepts a chosen take that the catalog knows for
  // that song, so other chosen takes stay in the Studio store only. Saves are batched (the catalog rebuilds its
  // page on every save).
  const pending = {};
  let timer = null;
  api.mirrorDecision = (catalogId, d) => {
    if (!catalogId || !/^[a-z0-9-]{1,160}$/.test(catalogId)) return;
    pending[catalogId] = d; clearTimeout(timer); timer = setTimeout(flush, 2500);
  };
  async function flush() {
    const batch = {...pending}; for (const k of Object.keys(pending)) delete pending[k];
    try {
      const st = await json("/api/state"), notes = st.annotations && st.annotations.schema === 1 ? st.annotations : {schema:1, songs:{}, clips:{}};
      const songs = {...(notes.songs || {})}, known = Object.fromEntries((api.catalog?.songs || []).map(s => [s.id, new Set(s.clip_ids || [])]));
      for (const [id, d] of Object.entries(batch)) {
        songs[id] = {status:d.status || "", chosen_take:d.chosen && known[id]?.has(d.chosen) ? d.chosen : "", next_action:(d.next || "").slice(0, 500), notes:(d.notes || "").slice(0, 20000), updated:new Date().toISOString()};
      }
      await json("/api/annotations", {method:"POST", headers, body:JSON.stringify({annotations:{schema:1, songs, clips:notes.clips || {}}, revision:st.revision})});
      api.mirrorError = null;
    } catch (err) { api.mirrorError = err.message; Object.assign(pending, batch); }
    root.dispatchEvent?.(new CustomEvent("studio-local-mirror", {detail:{error:api.mirrorError}}));
  }
  // Decisions the catalog already holds (from its own "Your call" form) for songs the Studio store hasn't decided.
  api.importedDecisions = async () => {
    try { const st = await json("/api/state"); return st.annotations?.songs || {}; } catch (err) { return {}; }
  };
  root.StudioLocal = api;
})(typeof window === "object" ? window : globalThis);
