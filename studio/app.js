/* Studio Board: one page for songs, lyric versions, Suno takes and albums.
   Songs and Inventory are drawn here. Triage, Album picks, Sessions, Albums and Cleanup are the Album Planner's
   own views (audio/album/planner.js, hosted through host.js), and every take card on a song page is the planner's
   card, so scores, statuses, notes, renames, delete tags, compare and keys work the same everywhere. */
(function () {
  "use strict";
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js").catch(() => {});
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const R = window.ReviewTools, P = () => window.PlannerApp;
  const M = StudioModel.create({lyricSongs:window.LYRIC_SONGS, takeSongs:window.TAKE_SONGS, studio:window.STUDIO});
  const LOCAL = window.CATALOG_LOCAL || null;   // set when the Studio Track Catalog server serves this page
  const L = window.StudioLocal || {enabled:false};
  const VIEW_KEY = "grind.studio.v1.view";
  const PLANNER_VIEWS = ["sort", "consider", "sessions", "albums", "cleanup"];
  const VIEWS = ["songs", ...PLANNER_VIEWS, "inventory"];
  const KEY_VIEWS = ["sort", "consider", "sessions"];
  const LOCATIONS = [["all", "All songs"], ["both", "Written and on Suno"], ["local", "Written, not on Suno"], ["suno", "Suno only"], ["new", "Has newer Suno takes"], ["album", "Has a take on an album"]];
  // [key, label, kind, natural direction]. The kind decides the wording of the direction button.
  const SORTS = [["recent", "Recent activity", "date", "desc"], ["title", "Title, A to Z", "text", "asc"], ["score", "Best score", "num", "desc"], ["takes", "Most takes", "num", "desc"],
    ["created", "Date created", "date", "desc"], ["edited", "Last edited", "date", "desc"], ["firstTake", "First Suno take", "date", "asc"], ["latestTake", "Latest Suno take", "date", "desc"], ["written", "Date written", "date", "desc"]];
  const SORT_WORDS = {date:{desc:"Newest first", asc:"Oldest first"}, text:{asc:"A to Z", desc:"Z to A"}, num:{desc:"Highest first", asc:"Lowest first"}};
  const SECTIONS = {songs:{label:"Songs", one:"song", many:"songs"}, instrumentals:{label:"Instrumentals", one:"instrumental", many:"instrumentals"}};
  // A song is an instrumental when it has no lyric packet, or no version of it has sung words (hasWords, model.js).
  // Your own copies count: writing words into an instrumental moves it to Songs. Set once the stores exist.
  let customLyrics = () => ({});
  function isInstrumental(s) {
    if (s._instr === undefined) s._instr = !M.versionsOf(s, {}).some(v => StudioModel.hasWords(v.lyrics ?? v.suno?.lyrics ?? ""));
    return s._instr && !M.versionsOf(s, customLyrics()).some(v => v.custom && StudioModel.hasWords(v.suno?.lyrics ?? v.lyrics ?? ""));
  }
  const sectionOf = key => { const s = M.bySong[key]; return s && isInstrumental(s) ? "instrumentals" : "songs"; };
  const LYRIC_STATUSES = [["short", "Shortlist"], ["maybe", "Maybe"], ["revision", "Needs revision"], ["preferred", "Preferred"], ["cut", "Cut"]];
  const SONG_STATUSES = [["needs_review", "Needs review"], ["incomplete", "Incomplete"], ["complete", "Complete"]];

  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch (err) {}
  const cleanSort = x => { const d = SORTS.find(r => r[0] === x?.by); return d ? {by:d[0], dir:x.dir === "asc" || x.dir === "desc" ? x.dir : d[3]} : null; };
  const sorts = {songs:cleanSort(prefs.sorts?.songs) || cleanSort({by:prefs.sort}) || {by:"recent", dir:"desc"}, instrumentals:cleanSort(prefs.sorts?.instrumentals) || {by:"recent", dir:"desc"}};
  // Inventory columns and sorts are remembered on this device only (this view-prefs key; nothing here syncs).
  const cleanInvSort = x => Object.fromEntries(["songs", "instrumentals", "takes"].filter(t => x?.[t]?.col).map(t => [t, {col:String(x[t].col), dir:x[t].dir === "desc" ? "desc" : "asc"}]));
  const ui = {view:"songs", section:"songs", song:null, version:null, q:"", location:prefs.location || "all", writer:prefs.writer || "all", status:prefs.status || "all", sorts, showStems:!!prefs.showStems,
    prompts:!!prefs.prompts, takeType:prefs.takeType || "listen", color:prefs.color || "yellow", editing:false, details:new Set(), inv:prefs.inv || "songs", invQ:"", invLimit:200,
    invCols:{songs:Array.isArray(prefs.invCols?.songs) ? prefs.invCols.songs.map(String) : null, takes:Array.isArray(prefs.invCols?.takes) ? prefs.invCols.takes.map(String) : null}, invSort:cleanInvSort(prefs.invSort), invOpen:null, chooserOpen:false};
  function savePrefs() { try { localStorage.setItem(VIEW_KEY, JSON.stringify({location:ui.location, writer:ui.writer, status:ui.status, sort:ui.sorts.songs.by, sorts:ui.sorts, showStems:ui.showStems, prompts:ui.prompts, takeType:ui.takeType, color:ui.color, inv:ui.inv, invCols:ui.invCols, invSort:ui.invSort})); } catch (err) {} }
  function readRoute() {
    const p = new URLSearchParams(location.search);
    const asInstr = p.get("view") === "instrumentals";
    const view = asInstr ? "songs" : VIEWS.includes(p.get("view")) ? p.get("view") : "songs";
    // Old-board links: ?song=<lyric slug>&version=<stem>&q= (Lyric Board), ?take=<id> and ?lyrics=<stem> (Album Planner).
    // A Studio key wins; otherwise the lyric slug is mapped to its Studio song. Studio's own v= wins over the old version=.
    const legacySong = x => M.bySong[x] ? x : M.songOfSlug[x] || null;
    let song = legacySong(p.get("song")), version = p.get("v") || p.get("version") || null;
    const lq = (p.get("q") || "").trim();
    if (lq && !song) ui.q = lq;
    const oldLyrics = p.get("lyrics");
    if (!song && oldLyrics && M.versionByStem[oldLyrics]) { song = M.songOfSlug[M.versionByStem[oldLyrics].slug] || null; if (song) version = oldLyrics; }
    const t = p.get("t") || (M.takes[p.get("take")] ? p.get("take") : null);
    if (t) { song = M.songOfTake[t] || M.songs.find(s => s.clips.some(c => c.id === t))?.key || song; version = M.takes[t]?.lyricStem || version; ui.details.add(t); return {view:"songs", song, version, section:sectionOf(song)}; }
    return {view, song, version, section:song ? sectionOf(song) : asInstr ? "instrumentals" : "songs"};
  }
  Object.assign(ui, readRoute());

  // ---------- stores ----------
  const syncText = {lyric:"", studio:""};
  const stores = StudioStores.create({lyricBySlug:M.lyricBySlug,
    onChange:(name, why) => { if (why === "remote") requestSongRender(); },
    onStatus:(name, text, failed) => { syncText[name] = {text, failed}; renderSyncMore(); }});
  customLyrics = () => stores.lyric().custom || {};
  const lyricRating = stem => stores.lyric().ratings[stem] || {};
  const takeRating = stem => stores.audio().ratings?.[stem] || {};
  const plan = () => stores.planner();
  const decision = key => stores.studio().songs[key] || {};
  const songStatus = s => decision(s.key).status || "needs_review";
  function saveSong(key, values) {
    stores.setSong(key, values);
    if (L.enabled) L.mirrorDecision(M.bySong[key]?.cat?.id, decision(key));
  }
  const gone = stem => !!plan().considered?.[stem]?.delDone;
  const albumOf = stem => Object.entries(plan().albums || {}).find(([, a]) => (a.order || []).includes(stem));
  const isStem = stem => M.takes[stem]?.type === "Stem";
  // Stem takes are archived: hidden everywhere until "Show archived stems" is on. Nothing is deleted.
  const typeOk = stem => isStem(stem) ? ui.showStems : ["all", "listen", "Stem"].includes(ui.takeType) || (M.takes[stem]?.type || "Vocal") === ui.takeType;
  const stemCount = () => Object.values(M.takes).filter(t => t.type === "Stem").length;
  const versionsOf = s => M.versionsOf(s, stores.lyric().custom || {});
  const textOf = v => v ? (v.custom ? (v.suno?.lyrics ?? v.lyrics ?? "") : (v.lyrics || "")) : "";
  const dur = s => { s = Math.round(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const scoreClass = n => n == null || n === "" ? "" : n >= 80 ? "hi" : n >= 50 ? "mid" : "";
  function bestScore(s) {
    const n = s.takeIds.map(id => takeRating(id).score).filter(Number.isFinite);
    for (const v of versionsOf(s)) { const r = lyricRating(v.stem); if (Number.isFinite(r.songScore)) n.push(r.songScore); }
    return n.length ? Math.max(...n) : null;
  }
  function toast(msg, undo = false) { if (P()) P().toast(msg, undo); }
  async function copyText(text, label) { try { await navigator.clipboard.writeText(text); toast("Copied " + label); } catch (err) { toast("Copy failed"); } }
  const download = (name, data) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], {type:"application/json"})); a.download = name; a.click(); URL.revokeObjectURL(a.href); };

  // ---------- navigation ----------
  const plannerVisible = () => PLANNER_VIEWS.includes(ui.view);
  function url() {
    const p = new URLSearchParams();
    if (ui.view !== "songs") p.set("view", ui.view);
    else if (ui.section === "instrumentals" && !ui.song) p.set("view", "instrumentals");
    if (ui.view === "songs" && ui.song) { p.set("song", ui.song); if (ui.version) p.set("v", ui.version); }
    if (plannerVisible()) { const n = P()?.ui; if (n?.session && ui.view === "sessions") p.set("session", n.session); if (n?.album) p.set("album", n.album); }
    return location.pathname + (p.toString() ? "?" + p : "");
  }
  function pushHistory(replace = false) {
    const st = {studio:{view:ui.view, section:ui.section, song:ui.song, version:ui.version}, plannerNavigation:P() ? {view:P().ui.view, session:P().ui.session, album:P().ui.album} : null};
    if (replace) history.replaceState(st, "", url()); else if (JSON.stringify(history.state?.studio) !== JSON.stringify(st.studio) || location.pathname + location.search !== url()) history.pushState(st, "", url());
  }
  function go(next, {push = true} = {}) {
    if (next.song !== undefined && next.song !== ui.song) { ui.editing = false; if (next.version === undefined) next.version = null; }
    // An open song decides its own section. Switching section from the rail closes a song that belongs to the other one.
    if (next.song) next.section = sectionOf(next.song);
    else if (next.section && next.section !== ui.section && next.song === undefined && ui.song && sectionOf(ui.song) !== next.section) { next.song = null; next.version = null; }
    Object.assign(ui, next);
    if (ui.song && !M.bySong[ui.song]) ui.song = null;
    if (push) pushHistory();
    if (plannerVisible()) { layout(); P()?.show(ui.view); } else { layout(); renderMain(); }
    if (ui.view === "songs" && ui.song) $("pageWrap").scrollTop = 0;
  }
  addEventListener("popstate", e => {
    const s = e.state?.studio || readRoute();
    Object.assign(ui, {view:s.view || "songs", section:s.song ? sectionOf(s.song) : s.section || "songs", song:s.song || null, version:s.version || null, editing:false});
    if (plannerVisible() && e.state?.plannerNavigation) { layout(); P()?.restore(e.state.plannerNavigation); }
    else go({}, {push:false});
  });
  window.StudioApp = {
    plannerVisible,
    // The planner moved itself (a session or album badge, Compare, a deleted album): follow it.
    plannerNavigated:nav => { if (!PLANNER_VIEWS.includes(nav.view)) return; if (ui.view !== nav.view) { ui.view = nav.view; layout(); } pushHistory(); },
    keysActive:() => KEY_VIEWS.includes(ui.view) || (ui.view === "songs" && !!ui.song),
    plannerRendered:() => { renderRail(); if (ui.view === "songs") { renderList(); requestSongRender(); } else if (ui.view === "cleanup") renderCleanupExtras(); else if (ui.view === "sessions") renderSessionExtras(); },
  };

  // ---------- chrome ----------
  function layout() {
    document.body.dataset.view = ui.view;
    document.body.classList.toggle("has-song", ui.view === "songs" && !!ui.song);
    $("plannerHost").hidden = !plannerVisible();
    $("page").hidden = plannerVisible();
    renderRail();
  }
  function renderRail() {
    const current = ui.view === "songs" ? ui.section : ui.view;
    for (const b of document.querySelectorAll(".rail-item")) { const on = b.dataset.view === current; b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); }
    const counts = sectionCounts();
    $("countSongs").textContent = counts.songs; $("countInstr").textContent = counts.instrumentals;
    $("countInstr").title = counts.prompts ? `${counts.instrumentals} instrumentals. ${counts.prompts} beat prompts are hidden until "Show beat prompts" is on.` : "";
  }
  function renderSyncMore() {
    const bits = [["lyric", "Lyric reviews"], ["studio", "Song decisions"]].filter(([k]) => syncText[k]?.text).map(([k, label]) => `<span class="${syncText[k].failed ? "failed" : ""}">${label}: ${esc(syncText[k].text)}</span>`);
    const failed = Object.values(syncText).some(x => x?.failed);
    $("syncMore").classList.toggle("has-failure", Object.values(syncText).some(x => x?.failed));
    $("syncMore").innerHTML = bits.join(" · ") + (failed ? ' <button class="btn small" id="studioRetry">Retry</button>' : "") + (L.enabled ? ` · <span class="local-badge">Local mode: Studio files and Save to Studio are on</span>${L.mirrorError ? ` · <span class="failed">Catalog notes: ${esc(L.mirrorError)}</span>` : ""}` : "");
  }

  // ---------- song list ----------
  function filteredSongs() {
    const q = ui.q.trim().toLowerCase();
    const list = M.songs.filter(s => inSection(s, ui.section) &&
      (ui.location === "all" || (ui.location === "new" ? s.newTakes > 0 : ui.location === "album" ? s.takeIds.some(albumOf) : s.location === ui.location)) &&
      (ui.writer === "all" || s.writers.includes(ui.writer)) && (ui.status === "all" || songStatus(s) === ui.status) &&
      (!q || M.searchText(s).includes(q) || (decision(s.key).notes || "").toLowerCase().includes(q) || (decision(s.key).next || "").toLowerCase().includes(q) ||
        s.takeIds.some(id => (takeRating(id).note || "").toLowerCase().includes(q)) || versionsOf(s).some(v => (lyricRating(v.stem).note || "").toLowerCase().includes(q))));
    return sortSongs(list, ui.sorts[ui.section]);
  }
  // ---------- sections and sorting ----------
  const inSection = (s, section) => (section === "instrumentals") === isInstrumental(s) && (ui.prompts || !s.prompt);
  function sectionCounts() {
    const c = {songs:0, instrumentals:0, prompts:0};
    for (const s of M.songs) { if (!isInstrumental(s)) c.songs++; else if (s.prompt) { c.prompts++; if (ui.prompts) c.instrumentals++; } else c.instrumentals++; }
    return c;
  }
  const DATE_AT = /(?:^|[\/\s])(\d{4}-\d{2}-\d{2})(?!\d)/;
  const firstDate = (...texts) => texts.map(x => DATE_AT.exec(String(x || ""))?.[1]).find(Boolean) || null;
  const earliest = list => list.filter(Boolean).sort()[0] || null, latestOf = list => list.filter(Boolean).sort().pop() || null;
  const sunoTimes = s => [...s.takeIds.filter(id => !isStem(id)).map(id => M.takes[id].createdAt), ...s.clips.map(c => c.created)];
  // Date written: the session date in the lyric version's folder name, or in the Studio batch name.
  const writtenOf = s => earliest([...M.versionsOf(s, {}).map(v => firstDate(v.folder, v.stem, v.session)), ...(s.cat?.batches || []).map(b => firstDate(b))]);
  const createdOf = s => earliest([writtenOf(s), ...sunoTimes(s)]);
  const SORT_VALUE = {
    recent:s => s.latest || null,
    title:s => s.title,
    score:s => bestScore(s),
    takes:s => s.takeIds.length + s.newTakes,
    created:createdOf,
    edited:s => s.cat?.updated || s.latest || null,
    firstTake:s => earliest(sunoTimes(s)),
    latestTake:s => latestOf(sunoTimes(s)),
    written:writtenOf,
  };
  const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, {numeric:true});
  // Songs with no value for the chosen sort always go last, whichever way it points.
  function sortSongs(list, {by, dir}) {
    const val = SORT_VALUE[by] || (() => null), sign = dir === "asc" ? 1 : -1, cache = new Map(list.map(s => [s.key, val(s)]));
    return list.sort((a, b) => {
      const x = cache.get(a.key), y = cache.get(b.key);
      if (x == null && y == null) return byTitle(a, b);
      if (x == null) return 1;
      if (y == null) return -1;
      const c = by === "title" ? x.localeCompare(y, undefined, {numeric:true}) : x < y ? -1 : x > y ? 1 : 0;
      return c * sign || byTitle(a, b);
    });
  }
  const LOC_BADGE = {local:'<span class="badge warn">Not on Suno</span>', suno:'<span class="badge">Suno only</span>'};
  function renderList() {
    if (ui.view !== "songs") return;
    const songs = filteredSongs();
    const sec = SECTIONS[ui.section], instr = ui.section === "instrumentals";
    syncSortControls();
    $("songCount").textContent = songs.length + " " + (songs.length === 1 ? sec.one : sec.many);
    $("songsCol").setAttribute("aria-label", sec.label); $("songList").setAttribute("aria-label", sec.label);
    $("songQ").placeholder = instr ? "Search instrumentals, prompts, notes ( / )" : "Search songs, lyrics, notes ( / )";
    $("fPromptsWrap").hidden = !instr;
    $("songList").innerHTML = songs.map(s => {
      const best = bestScore(s), versions = versionsOf(s).length, st = songStatus(s), onAlbum = s.takeIds.some(albumOf);
      return `<div class="song-row${s.key === ui.song ? " on" : ""}" role="option" tabindex="0" aria-selected="${s.key === ui.song}" data-song="${esc(s.key)}">
        <div class="song-row-main"><b>${esc(s.title)}</b><small>${instr ? "" : `${versions} lyric${versions === 1 ? "" : "s"} · `}${s.takeIds.length} take${s.takeIds.length === 1 ? "" : "s"}${s.writers.length ? " · " + esc(s.writers.join(", ")) : ""}</small>
        <span class="row-badges">${LOC_BADGE[s.location] || ""}${s.newTakes ? `<span class="badge new">${s.newTakes} new on Suno</span>` : ""}${onAlbum ? '<span class="badge short">On album</span>' : ""}${st === "complete" ? '<span class="badge short">Complete</span>' : st === "incomplete" ? '<span class="badge maybe">Incomplete</span>' : ""}${s.prompt ? '<span class="badge">Beat prompt</span>' : ""}</span></div>
        <span class="score ${scoreClass(best)}">${best ?? "–"}</span></div>`;
    }).join("") || `<div class="empty-note">No ${sec.many} match. Clear the search or filters.</div>`;
  }
  function syncSortControls() {
    const cur = ui.sorts[ui.section], def = SORTS.find(r => r[0] === cur.by);
    $("fSort").value = cur.by;
    $("fSortDir").textContent = (cur.dir === "asc" ? "↑ " : "↓ ") + SORT_WORDS[def[2]][cur.dir];
    $("fSortDir").setAttribute("aria-label", "Sort direction: " + SORT_WORDS[def[2]][cur.dir] + ". Click to reverse.");
  }
  function renderFilters() {
    const opt = (list, cur) => list.map(([k, l]) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
    $("fLocation").innerHTML = opt(LOCATIONS, ui.location);
    $("fWriter").innerHTML = opt([["all", "All writers"], ...M.writers.map(w => [w, w])], ui.writer);
    $("fStatus").innerHTML = opt([["all", "Any song status"], ...SONG_STATUSES], ui.status);
    $("fSort").innerHTML = opt(SORTS.map(([k, l]) => [k, "Sort: " + l]), ui.sorts[ui.section].by);
    $("fPrompts").checked = ui.prompts;
  }

  // ---------- song page ----------
  function pickVersion(s, versions) {
    if (ui.version && versions.some(v => v.stem === ui.version)) return versions.find(v => v.stem === ui.version);
    for (const slug of s.lyrics) for (const pick of [stores.studio().pick?.[slug], stores.lyric().pick?.[slug]]) { const v = versions.find(x => x.stem === pick); if (v) return v; }
    const chosen = versions.find(v => v.stem === decision(s.key).lyric); if (chosen) return chosen;
    return [...versions].reverse().find(v => M.takesForVersion(s, v.stem).length) || versions[versions.length - 1] || null;
  }
  function songHeader(s, versions) {
    const d = decision(s.key), takes = s.takeIds.filter(id => !gone(id));
    const opt = (list, cur) => list.map(([k, l]) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
    const sugg = s.cat?.suggestions?.filter(x => M.bySong[x.key]) || [];
    const home = s.cat?.home, homeNext = home?.next && !/^Listen or review/.test(home.next) ? home.next : "";
    const flags = [];
    if (s.location === "local" && !s.prompt) flags.push(`<div class="callout warn">Written, never sent to Suno.${s.cat?.files ? ` ${s.cat.files} Studio files.` : ""}</div>`);
    if (s.newTakes) flags.push(`<div class="callout">${s.newTakes} newer take${s.newTakes === 1 ? " is" : "s are"} on Suno but not in the board snapshot yet. They're under the takes, where you can add them to Album picks.</div>`);
    if (sugg.length) flags.push(`<div class="callout quiet">Might be the same song as ${sugg.map(x => `<button class="linkish" data-song="${esc(x.key)}">${esc(M.bySong[x.key].title)}</button>`).join(", ")}.</div>`);
    return `<div class="song-head">
      <button class="btn small back" data-song-back>← ${SECTIONS[sectionOf(s.key)].label}</button>
      <div class="song-title"><h1>${esc(s.title)}</h1>
        <div class="meta">${esc(s.writers.join(", ") || "Writer unknown")} · ${isInstrumental(s) ? `Instrumental${versions.length > 1 ? ` · ${versions.length} prompt versions` : ""}` : `${versions.length} lyric versions`} · ${s.takeIds.length} takes on the board${s.trashedTakes ? ` · ${s.trashedTakes} trashed on Suno` : ""}${M.akaOf(s).length ? `<br>Also called ${esc(M.akaOf(s).join(", "))}` : ""}</div></div>
      <div class="decision">
        <label>Song status <select data-song-field="status">${opt(SONG_STATUSES, songStatus(s))}</select></label>
        <label>Chosen take <select data-song-field="chosen">${opt([["", "None chosen yet"], ...takes.map(id => [id, P().nameOf(id) + " · " + P().takeLabel(M.takes[id])])], d.chosen || "")}</select></label>
        ${isInstrumental(s) ? "" : `<label class="wide">Chosen lyric <select data-song-field="lyric">${opt([["", "None chosen yet"], ...versions.map(v => [v.stem, M.versionLabel(v)])], d.lyric || "")}</select></label>`}
        <label class="wide">Next action <input data-song-text="next" value="${esc(d.next ?? homeNext)}" placeholder="Re-run the hook with a half-time verse 2" maxlength="500"></label>
        <details class="wide song-notes"${d.notes ? " open" : ""}><summary>Song notes${d.notes ? "" : " (none yet)"}</summary><textarea data-song-text="notes" rows="3" maxlength="20000" placeholder="Listening notes for the whole song">${esc(d.notes || "")}</textarea></details>
      </div>
      ${flags.join("")}
    </div>`;
  }
  function versionChips(s, versions, current) {
    if (isInstrumental(s)) return versions.length > 1 ? chipsHtml(s, versions, current, "Prompt versions") : "";
    if (!versions.length) return `<div class="empty-note">No lyric versions on the Lyric Board for this song yet.${s.cat?.versions?.length ? " The Studio has " + esc(s.cat.versions.join(", ")) + "." : ""}</div>`;
    return chipsHtml(s, versions, current, "Lyric versions");
  }
  function chipsHtml(s, versions, current, label) {
    const chosen = decision(s.key).lyric;
    return `<div class="version-chips" role="tablist" aria-label="${label}">${versions.map(v => {
      const r = lyricRating(v.stem), takes = M.takesForVersion(s, v.stem);
      const sc = [...takes.map(id => takeRating(id).score), r.songScore].filter(Number.isFinite);
      const best = sc.length ? Math.max(...sc) : null, st = LYRIC_STATUSES.find(([k]) => k === r.status);
      return `<button class="vchip${v.stem === current?.stem ? " on" : ""}" role="tab" aria-selected="${v.stem === current?.stem}" data-version="${esc(v.stem)}" title="${esc(M.versionLabel(v))}">
        <span>${v.stem === chosen ? "★ " : ""}${esc(M.shortVersionLabel(v, s.title))}</span><small>${esc(v.custom ? (v.savedTo ? "saved to Studio" : "your copy") : v.session || "")}${takes.length ? " · " + takes.length + " takes" : ""}${st ? " · " + st[1] : ""}</small>${best != null ? `<b class="${scoreClass(best)}">${best}</b>` : ""}</button>`;
    }).join("")}</div>`;
  }
  function field(label, value, key) {
    if (value == null || value === "") return "";
    return `<div class="sfield"><div class="sfield-head"><span>${esc(label)}</span><small>${value.length.toLocaleString()} chars</small><button class="btn small" data-copy="${esc(key)}">Copy</button></div><pre class="field-text">${esc(value)}</pre></div>`;
  }
  const colorNames = () => ({...Object.fromEntries(R.colors), ...(lyricRating("__review_preferences__").colorLabels || {})});
  function editor(v) {
    const su = v.suno || {};
    return `<div class="lyric-edit">
      ${v.custom ? `<label>Version name<input data-ed="label" value="${esc(v.label || "")}" maxlength="80"></label>` : ""}
      <label>Lyrics<textarea class="lyric-editor" id="lyricEditor" data-ed="lyrics" spellcheck="true">${esc(textOf(v))}</textarea></label>
      ${v.custom ? `<label>Suno title<input data-ed="title" value="${esc(su.title || v.title || "")}"></label>
        <label>Style<textarea data-ed="style" rows="4">${esc(su.style || "")}</textarea></label>
        ${su.instrumental != null ? `<label>Instrumental style<textarea data-ed="instrumental" rows="3">${esc(su.instrumental || "")}</textarea></label>` : ""}
        <label>Excluded styles<textarea data-ed="exclude" rows="2">${esc(su.exclude || "")}</textarea></label>` : ""}
      <div class="hint" id="editHint">${v.custom ? "Changes save as you type to this copy." : "Your first change makes your own copy (\"My copy\"). The original version is never changed."}</div>
    </div>`;
  }
  function lyricsPane(s, v) {
    if (!v) return `<div class="pane lyrics-pane"><div class="empty-note">Pick a lyric version to read it.</div></div>`;
    const r = lyricRating(v.stem), text = textOf(v), names = colorNames(), marks = R.marks(r);
    const sources = v.sourceLocations || (v.studioSource ? [v.studioSource] : []);
    return `<div class="pane lyrics-pane" id="lyrics">
      <div class="pane-head"><div><b id="lyricTitle">${esc(v.custom ? (v.label || "My copy") : (v.suno?.title || v.title || s.title))}</b><small>${esc(M.versionLabel(v))}${v.savedTo ? " · saved to " + esc(v.savedTo) : ""}</small></div>
        <div class="pane-tools"><button class="btn small${ui.editing ? " primary" : ""}" data-edit>${ui.editing ? "Done" : "Edit"}</button><button class="btn small" data-copy="lyrics">Copy</button>${v.custom && LOCAL ? `<button class="btn small" data-save-studio title="Write this copy as a new lyric file in the song's Studio folder">Save to Studio</button>` : ""}${v.custom ? `<button class="btn small danger" data-del-copy>Delete copy</button>` : ""}</div></div>
      ${v.header ? `<div class="version-header">${esc(v.header)}</div>` : ""}
      ${ui.editing ? editor(v) : `<div class="swatches" role="radiogroup" aria-label="Highlight colour">${R.colors.map(([c]) => `<button class="swatch swatch-${c}${ui.color === c ? " on" : ""}" role="radio" aria-checked="${ui.color === c}" data-color="${c}">${esc(names[c])}</button>`).join("")}<button class="btn small" data-color-names>Rename colours</button><button class="btn small" data-lyric-undo ${stores.canUndoLyric() ? "" : "disabled"}>Undo</button></div>
      <pre class="lyrics review-lyrics" id="lyricText" tabindex="0" aria-label="Lyrics. Tap a line or select words to highlight.">${R.html(text, r).replace(/(<span class="review-line"[^>]*>)(\[[^\]<\n]+\])/g, '$1<span class="tag">$2</span>')}</pre>
      <div class="hint">Tap a line, or select words, to highlight in the chosen colour. Tap a highlighted line again to remove it.</div>`}
      <div class="review-row">
        <label>Readiness <select data-lyric-field="readiness">${R.options(r.readiness || "unassessed")}</select></label>
        <div class="lyric-status">${LYRIC_STATUSES.map(([k, l]) => `<button class="btn small s-${k}" aria-pressed="${r.status === k}" data-lyric-status="${k}">${l}</button>`).join("")}</div>
        <div class="tags">${R.tags.map(t => `<button class="chip" aria-pressed="${(r.tags || []).includes(t)}" data-lyric-tag="${esc(t)}">${esc(t)}</button>`).join("")}</div>
      </div>
      <label class="note-label">Notes on this version<textarea data-lyric-note rows="3" placeholder="What hit, what to fix">${esc(r.note || "")}</textarea></label>
      ${Number.isFinite(r.score) ? `<p class="hint">Earlier Lyric Board score: ${esc(r.score)} (kept).</p>` : ""}
      ${marks.length ? `<details class="panel" open><summary>${marks.length} passage note${marks.length === 1 ? "" : "s"}</summary>${marks.map(m => `<div class="passage"><span class="badge swatch-${esc(m.color)}">${esc(names[m.color] || m.color)}</span>${R.valid(m, text) ? "" : '<span class="badge warn">Text changed</span>'}<blockquote>${esc(m.quote)}</blockquote><input class="mark-comment" data-mark-comment="${esc(m.key)}" value="${esc(m.comment || "")}" maxlength="1000" placeholder="Comment on this passage"><button class="btn small" data-del-mark="${esc(m.key)}">Remove</button></div>`).join("")}</details>` : ""}
      <details class="panel"><summary>Suno fields</summary>
        ${field("Title", v.suno?.title || v.title, "title")}${field("Style", v.suno?.style, "style")}${field("Instrumental style", v.suno?.instrumental, "instrumental")}${field("Excluded styles", v.suno?.exclude, "exclude")}${field("Lyrics for Suno", v.suno?.lyrics ?? v.lyrics, "sunoLyrics")}
        ${v.naming ? `<div class="hint">Suno naming: <code>${esc(v.naming)}</code>.[clip number]</div>` : ""}
      </details>
      ${sources.length ? `<details class="panel"><summary>Where this version came from (${sources.length})</summary><ul class="sources">${sources.map(p => `<li><code>${esc(p)}</code></li>`).join("")}</ul></details>` : ""}
      ${filesPanel(s)}
    </div>`;
  }
  // Instrumental song page: the style or prompt is shown as a prompt, never as lyrics. No lyric editor, highlights or lyric status.
  function promptPane(s, v) {
    if (!v) return `<div class="pane prompt-pane"><div class="pane-head"><div><b>Style and prompt</b></div></div><div class="empty-note">No style or prompt is on file for this instrumental.</div>${filesPanel(s)}</div>`;
    const su = v.suno || {}, text = textOf(v), r = lyricRating(v.stem);
    return `<div class="pane prompt-pane" id="promptPane">
      <div class="pane-head"><div><b>Style and prompt</b><small>${esc(M.versionLabel(v))}</small></div><div class="pane-tools"><button class="btn small" data-copy="prompt">Copy prompt</button></div></div>
      ${field("Style", su.style, "style")}${field("Instrumental style", su.instrumental, "instrumental")}${field("Prompt", text, "prompt")}${field("Excluded styles", su.exclude, "exclude")}
      ${!su.style && !su.instrumental && !text && !su.exclude ? '<div class="empty-note">This version has no style or prompt text.</div>' : ""}
      <label class="note-label">Notes on this prompt<textarea data-lyric-note rows="3" placeholder="What worked, what to change">${esc(r.note || "")}</textarea></label>
      ${filesPanel(s)}
    </div>`;
  }
  function filesPanel(s) {
    if (!L.enabled) return "";
    if (!L.catalog) return `<details class="panel"><summary>Studio files</summary><p class="hint">${L.error ? "Couldn't load the catalog: " + esc(L.error) : "Loading…"}</p></details>`;
    const all = L.filesBySong[s.cat?.id] || [], archived = all.filter(f => f.archived).length;
    const files = all.filter(f => !f.archived || ui.showArchived);
    return `<details class="panel files-panel"><summary>Studio files (${files.length}${archived && !ui.showArchived ? ` + ${archived} archived` : ""})</summary>
      ${archived ? `<label class="check"><input type="checkbox" id="showArchived" ${ui.showArchived ? "checked" : ""}> Show archived</label>` : ""}
      <ul class="file-list">${files.sort((a, b) => (a.kind || "").localeCompare(b.kind || "") || a.path.localeCompare(b.path)).map(f => `<li><div><b>${esc(f.kind || "file")}</b> <span class="meta">${esc([f.writer, f.version].filter(Boolean).join(" "))}${f.archived ? " · archived" : ""}</span><code>${esc(f.path)}</code></div>
        <div class="file-actions"><a class="btn small" href="${esc(L.fileUrl(f.id))}" target="_blank" rel="noopener">Open</a><button class="btn small" data-copy-path="${esc(f.path)}">Copy path</button></div>
        ${f.audio ? `<audio controls preload="none" src="${esc(L.fileUrl(f.id))}"></audio>` : ""}</li>`).join("") || '<li class="hint">No Studio files are indexed for this song.</li>'}</ul></details>`;
  }
  function takeDetails(stem) {
    const t = M.takes[stem]; if (!t) return "";
    const su = t.suno || {}, voice = t.voiceName ? (t.type === "Vocal" && t.personalVoice ? "Your voice · " : t.type === "Vocal" ? "Voice persona · " : "Persona setting · ") + t.voiceName : (t.voiceChecked ? "No voice persona listed" : "Voice not confirmed");
    const legacy = takeRating(stem).status;
    return `<div class="take-details">
      <dl>
        <dt>Voice</dt><dd>${esc(voice)}</dd>
        <dt>Lyric match</dt><dd>${esc(t.match || "–")}</dd>
        ${t.oldTitle ? `<dt>Previously</dt><dd>${esc(t.oldTitle)}</dd>` : ""}
        <dt>Model</dt><dd>${esc(t.model || "–")} · ${esc((t.createdAt || "").slice(0, 16).replace("T", " "))}</dd>
        ${legacy ? `<dt>Classic board status</dt><dd>${esc(legacy)} (kept for reference)</dd>` : ""}
        ${t.source ? `<dt>Lyric source</dt><dd><code>${esc(t.source)}</code></dd>` : ""}
        ${(t.sources || []).length ? `<dt>Source audio</dt><dd>${t.sources.map(x => `<a href="https://suno.com/song/${encodeURIComponent(x.id)}" target="_blank" rel="noopener">${esc(x.title || x.id)}</a>`).join(", ")}</dd>` : ""}
      </dl>
      ${field("Generation style", su.style, "take-style:" + stem)}${field("Excluded styles", su.exclude, "take-exclude:" + stem)}${field("Suno lyrics", su.lyrics ?? t.lyrics, "take-lyrics:" + stem)}
      <button class="btn small" data-copy="take-title:${esc(stem)}">Copy Suno title</button>
    </div>`;
  }
  function takeWrap(stem, s) {
    const chosen = decision(s.key).chosen === stem, open = ui.details.has(stem);
    return `<div class="take-wrap${chosen ? " chosen" : ""}" data-wrap="${esc(stem)}">${P().card(stem)}
      <div class="take-extra"><button class="btn small${chosen ? " primary" : ""}" data-choose="${esc(stem)}" aria-pressed="${chosen}">${chosen ? "★ Chosen take" : "☆ Choose this take"}</button><button class="btn small" data-details="${esc(stem)}" aria-expanded="${open}">Take details ${open ? "▾" : "▸"}</button></div>
      ${open ? takeDetails(stem) : ""}</div>`;
  }
  function takesPane(s, versions, v) {
    const own = v ? M.takesForVersion(s, v.stem) : [];
    const other = s.takeIds.filter(id => !own.includes(id));
    const visible = list => list.filter(id => !gone(id) && typeOk(id));
    const stems = s.takeIds.filter(isStem).length, deleted = s.takeIds.filter(gone).length, fresh = M.newClips(s);
    const considered = new Set(Object.keys(plan().considered || {}));
    const types = [["listen", "Vocals and instrumentals"], ["Vocal", "Vocals"], ["Instrumental", "Instrumentals"]];
    const stemChoice = stems ? `<label class="check stems-toggle"><input type="checkbox" id="showStems"${ui.showStems ? " checked" : ""}> Show archived stems (${stems})</label>` : "";
    const target = plan().albums?.[P().ui.album];
    return `<div class="pane takes-pane">
      <div class="pane-head"><div><b>Takes</b><small>Status buttons apply to ${esc(target?.name || "the album")} (change it at the bottom)</small></div>
        <select id="takeType" aria-label="Which takes to show">${types.map(([k, l]) => `<option value="${k}"${k === (ui.takeType === "all" || ui.takeType === "Stem" ? "listen" : ui.takeType) ? " selected" : ""}>${l}</option>`).join("")}</select></div>${stemChoice}
      ${v ? `<h3 class="sub">This version (${visible(own).length})</h3>${visible(own).map(id => takeWrap(id, s)).join("") || '<div class="empty-note">No takes of this version yet.</div>'}` : ""}
      ${visible(other).length ? `<details class="panel" ${v && visible(own).length ? "" : "open"}><summary>${v ? "Other takes of this song" : "Takes"} (${visible(other).length})</summary>${visible(other).map(id => takeWrap(id, s)).join("")}</details>` : ""}
      ${fresh.length ? `<details class="panel" open><summary>Newer on Suno, not in the board snapshot (${fresh.length})</summary>${fresh.map(c => `<div class="fresh-take"><div><b>${esc(c.title)}</b><small>${esc([c.writer, c.version, c.mode, dur(c.duration), (c.created || "").slice(0, 10)].filter(Boolean).join(" · "))}</small></div><div class="take-actions"><a class="btn small" data-play href="https://suno.com/song/${encodeURIComponent(c.id)}" target="_blank" rel="noopener">▶ Suno</a><button class="btn small" data-consider="${esc(c.id)}" ${considered.has(c.id) ? "disabled" : ""}>${considered.has(c.id) ? "In Album picks" : "Add to Album picks"}</button></div></div>`).join("")}<div class="hint">Album picks shows these as "Suno ${"xxxxxxxx"}" until the board data is rebuilt; scores and statuses carry over.</div></details>` : ""}
      <div class="hint">${[stems && !ui.showStems ? `${stems} archived stem${stems === 1 ? "" : "s"} hidden` : "", deleted ? `${deleted} deleted on Suno` : ""].filter(Boolean).join(" · ")}</div>
    </div>`;
  }
  let pendingSong = false;
  const typing = () => { const a = document.activeElement; return !!a && $("page").contains(a) && a.matches("input:not([type=checkbox]),textarea,select,[contenteditable]"); };
  function requestSongRender() { if (ui.view !== "songs") return; if (typing()) pendingSong = true; else renderSongPage(); }
  document.addEventListener("focusout", () => setTimeout(() => { if (pendingSong && !typing()) { pendingSong = false; renderSongPage(); renderList(); } }, 150));
  function renderSongPage() {
    if (ui.view !== "songs") return;
    const s = M.bySong[ui.song];
    if (!s) { $("page").innerHTML = homePage(); return; }
    const focused = document.activeElement?.closest?.("#page .card")?.dataset.stem;
    const scroll = $("pageWrap").scrollTop;
    const versions = versionsOf(s), v = pickVersion(s, versions);
    $("page").innerHTML = songHeader(s, versions) + versionChips(s, versions, v) + `<div class="song-body">${isInstrumental(s) ? promptPane(s, v) : lyricsPane(s, v)}${takesPane(s, versions, v)}</div>`;
    $("page").dataset.version = v?.stem || "";
    $("pageWrap").scrollTop = scroll;
    document.querySelectorAll("#page textarea.note").forEach(t => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 120) + "px"; });
    if (focused) $("page").querySelector(`.card[data-stem="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    if (ui.editing && !isInstrumental(s)) $("lyricEditor")?.focus({preventScroll:true});
  }
  function homePage() {
    const c = M.songs.filter(s => !s.prompt), local = c.filter(s => s.location === "local"), fresh = c.filter(s => s.newTakes);
    const decided = c.filter(s => songStatus(s) === "complete").length, counts = sectionCounts();
    return `<div class="home">
      <h1>All your songs in one place</h1>
      <p class="meta">Pick a song on the left. Its page has every lyric version beside every Suno take, with scores, album status, highlights and notes together.</p>
      <div class="stat-grid">
        <button class="stat link" data-view="songs"><b>${counts.songs}</b><span>songs with vocals</span></button>
        <button class="stat link" data-view="instrumentals"><b>${M.songs.filter(s => !s.prompt && isInstrumental(s)).length}</b><span>instrumentals</span></button>
        <div class="stat"><b>${decided}</b><span>marked complete</span></div>
        <div class="stat"><b>${Object.keys(M.versionByStem).length}</b><span>lyric versions</span></div>
        <div class="stat"><b>${Object.keys(M.takes).length}</b><span>takes on the board</span></div>
        <button class="stat link" data-view="cleanup"><b>${fresh.reduce((n, s) => n + s.newTakes, 0)}</b><span>newer Suno takes not on the board</span></button>
        <button class="stat link" data-view="cleanup"><b>${local.length}</b><span>written, never on Suno</span></button>
      </div>
      <p class="hint">Data: lyrics ${esc((window.STUDIO.sources.lyrics || "").slice(0, 10))}, takes ${esc((window.STUDIO.sources.takes || "").slice(0, 10))}, Studio catalog ${esc((window.STUDIO.sources.catalog || "").slice(0, 10))}. Press <kbd>?</kbd> for keys.</p>
    </div>`;
  }

  // ---------- Cleanup and Sessions additions ----------
  function renderCleanupExtras() {
    const c = M.songs.filter(s => !s.prompt), local = c.filter(s => s.location === "local"), fresh = c.filter(s => s.newTakes);
    const pairs = [], seen = new Set();
    for (const s of c) for (const x of s.cat?.suggestions || []) { const id = [s.key, x.key].sort().join("|"); if (M.bySong[x.key] && !seen.has(id)) { seen.add(id); pairs.push([s, M.bySong[x.key], x.similarity]); } }
    const songBtn = s => `<button class="linkish" data-song="${esc(s.key)}">${esc(s.title)}</button>`;
    const counted = list => Object.entries(list.reduce((n, x) => (n[x.title] = (n[x.title] || 0) + 1, n), {})).map(([t, n]) => esc(t) + (n > 1 ? " ×" + n : "")).join(" · ");
    $("cleanupExtras").innerHTML = `
      <h2>On Suno, not on the board yet <small>${fresh.reduce((n, s) => n + s.newTakes, 0)} takes, ${fresh.length} songs</small></h2>
      <p class="hint">Made after the board snapshot of ${esc((window.STUDIO.sources.takes || "").slice(0, 10))}. Rebuilding the board data brings them in.</p>
      <ul class="gap-list">${fresh.map(s => `<li>${songBtn(s)} <span class="badge new">${s.newTakes} new</span><small>${counted(M.newClips(s))}</small></li>`).join("")}</ul>
      <h2>Written, never sent to Suno <small>${local.length} songs</small></h2>
      <ul class="gap-list">${local.map(s => `<li>${songBtn(s)}<small>${versionsOf(s).length} lyric versions${s.cat?.files ? ` · ${s.cat.files} Studio files` : ""}</small></li>`).join("") || "<li>None</li>"}</ul>
      <h2>Possible duplicate songs <small>${pairs.length} pairs</small></h2>
      <ul class="gap-list">${pairs.map(([a, b, sim]) => `<li>${songBtn(a)} and ${songBtn(b)}<small>${Math.round((sim || 0) * 100)}% title match</small></li>`).join("")}</ul>`;
  }
  function renderSessionExtras() {
    const lyricSessions = Object.entries(stores.lyric().collections || {}), audioSessions = Object.entries(stores.audio().collections || {});
    if (!lyricSessions.length && !audioSessions.length) { $("sessionExtras").innerHTML = ""; return; }
    const songOfStem = stem => M.songOfSlug[M.versionByStem[stem]?.slug] || M.songOfTake[stem] || null;
    const row = ([id, c]) => {
      const songs = [...new Set((c.members || []).map(songOfStem).filter(Boolean))];
      return `<li><b>${esc(c.name)}</b> <span class="meta">${(c.members || []).length} items</span><small>${songs.map(k => `<button class="linkish" data-song="${esc(k)}">${esc(M.bySong[k].title)}</button>`).join(" · ")}</small></li>`;
    };
    $("sessionExtras").innerHTML = `<h2>Sessions from the older boards</h2><p class="hint">Lyric Board writing sessions and Classic listening sessions. Use "+ Add takes" in Album picks to pull a listening session into the planner.</p>
      ${lyricSessions.length ? `<h3 class="sub">Lyric Board sessions</h3><ul class="gap-list">${lyricSessions.map(row).join("")}</ul>` : ""}
      ${audioSessions.length ? `<h3 class="sub">Classic listening sessions</h3><ul class="gap-list">${audioSessions.map(row).join("")}</ul>` : ""}`;
  }

  // ---------- Inventory ----------
  const csvCell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  // ----- Column registry. Every field the data has is a column; nothing here reads lyric text. -----
  // [id, label, group, type, shown by default, getter]. A getter returns text, a number, a date string or a list.
  const nameTake = id => M.takes[id]?.title || id;
  const sunoAll = s => s.clips.filter(c => !isStem(c.id));
  const liveTakes = s => s.takeIds.filter(id => !isStem(id) && !gone(id));
  const scoresOf = s => s.takeIds.map(id => takeRating(id).score).filter(Number.isFinite);
  const reviewed = s => versionsOf(s).filter(v => { const r = lyricRating(v.stem); return r.status || r.songScore != null || r.note || (r.tags || []).length || (r.readiness && r.readiness !== "unassessed"); });
  const count = (list, f) => list.filter(f).length;
  const uniq = list => [...new Set(list.filter(Boolean))];
  const WHERE = {both:"Studio and Suno", local:"Studio only", suno:"Suno only"};
  const albumNames = s => uniq(s.takeIds.map(id => { const a = albumOf(id); return a && a[1].name.split(" ·")[0]; }));
  const SONG_COLS = [
    ["title", "Title", "Identity", "text", true, s => s.title],
    ["key", "Song id", "Identity", "text", false, s => s.key],
    ["section", "Section", "Identity", "text", false, s => isInstrumental(s) ? "Instrumental" : "Song"],
    ["aka", "Also called", "Identity", "text", false, s => M.akaOf(s)],
    ["prompt", "Beat prompt", "Identity", "text", false, s => s.prompt ? "yes" : ""],
    ["where", "Where", "Identity", "text", true, s => WHERE[s.location] || ""],
    ["writers", "Writers", "Identity", "text", true, s => s.writers],
    ["catStatus", "Catalog status", "Identity", "text", false, s => s.cat?.status || ""],
    ["written", "Date written", "Dates", "date", false, writtenOf],
    ["created", "Date created", "Dates", "date", false, createdOf],
    ["edited", "Last edited", "Dates", "date", false, s => s.cat?.updated || s.latest || null],
    ["recent", "Recent activity", "Dates", "date", true, s => s.latest || null],
    ["firstTake", "First Suno take", "Dates", "date", false, s => earliest(sunoTimes(s))],
    ["latestTake", "Latest Suno take", "Dates", "date", false, s => latestOf(sunoTimes(s))],
    ["catUpdated", "Catalog updated", "Dates", "date", false, s => s.cat?.updated || null],
    ["lyricVersions", "Lyric versions", "Lyrics", "num", true, s => isInstrumental(s) ? 0 : versionsOf(s).length],
    ["copies", "My copies", "Lyrics", "num", false, s => count(versionsOf(s), v => v.custom)],
    ["sung", "Has sung words", "Lyrics", "text", false, s => isInstrumental(s) ? "no" : "yes"],
    ["lyricSessions", "Lyric sessions", "Lyrics", "text", false, s => uniq(versionsOf(s).map(v => v.session))],
    ["lyricWriters", "Lyric writers", "Lyrics", "text", false, s => uniq(versionsOf(s).map(v => v.writer))],
    ["catVersions", "Catalog versions", "Lyrics", "text", false, s => s.cat?.versions || []],
    ["batches", "Batches", "Lyrics", "text", false, s => s.cat?.batches || []],
    ["packetsOk", "Packets complete", "Lyrics", "num", false, s => s.cat?.packets?.complete ?? null],
    ["packetsInc", "Packets incomplete", "Lyrics", "num", false, s => s.cat?.packets?.incomplete ?? null],
    ["reviewed", "Reviewed lyric versions", "Lyric review", "num", false, s => reviewed(s).length],
    ["lyricStatuses", "Lyric statuses", "Lyric review", "text", false, s => uniq(versionsOf(s).map(v => LYRIC_STATUSES.find(([k]) => k === lyricRating(v.stem).status)?.[1]))],
    ["lyricTags", "Lyric tags", "Lyric review", "text", false, s => uniq(versionsOf(s).flatMap(v => lyricRating(v.stem).tags || []))],
    ["lyricReady", "Lyric readiness", "Lyric review", "text", false, s => uniq(versionsOf(s).map(v => lyricRating(v.stem).readiness).filter(x => x && x !== "unassessed"))],
    ["lyricNotes", "Lyric notes", "Lyric review", "num", false, s => count(versionsOf(s), v => lyricRating(v.stem).note)],
    ["lyricScore", "Best lyric score", "Lyric review", "num", false, s => { const n = versionsOf(s).map(v => lyricRating(v.stem).songScore).filter(Number.isFinite); return n.length ? Math.max(...n) : null; }],
    ["boardTakes", "Takes on board", "Suno takes", "num", true, s => count(s.takeIds, id => !isStem(id))],
    ["activeTakes", "Active takes", "Suno takes", "num", false, s => liveTakes(s).length],
    ["vocalTakes", "Vocal takes", "Suno takes", "num", false, s => count(s.takeIds, id => M.takes[id].type === "Vocal")],
    ["instrTakes", "Instrumental takes", "Suno takes", "num", false, s => count(s.takeIds, id => M.takes[id].type === "Instrumental")],
    ["stemTakes", "Archived stem takes", "Suno takes", "num", false, s => count(s.takeIds, isStem)],
    ["newTakes", "New on Suno", "Suno takes", "num", false, s => s.newTakes],
    ["trashedTakes", "Trashed on Suno", "Suno takes", "num", false, s => s.trashedTakes],
    ["rejectedTakes", "Rejected on Suno", "Suno takes", "num", false, s => count(s.clips, c => c.rejected)],
    ["deletedTakes", "Deleted from board", "Suno takes", "num", false, s => count(s.takeIds, gone)],
    ["clips", "Suno clips", "Suno takes", "num", false, s => s.clips.length],
    ["totalLen", "Total length (s)", "Suno takes", "num", false, s => Math.round(sunoAll(s).reduce((n, c) => n + (c.duration || 0), 0)) || null],
    ["longest", "Longest take (s)", "Suno takes", "num", false, s => Math.round(Math.max(0, ...sunoAll(s).map(c => c.duration || 0))) || null],
    ["models", "Models", "Suno takes", "text", false, s => uniq([...s.takeIds.map(id => M.takes[id].model), ...s.clips.map(c => c.model)])],
    ["modes", "Modes", "Suno takes", "text", false, s => uniq(s.clips.map(c => c.mode))],
    ["best", "Best score", "Scores", "num", true, bestScore],
    ["avg", "Average take score", "Scores", "num", false, s => { const n = scoresOf(s); return n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length) : null; }],
    ["scored", "Scored takes", "Scores", "num", false, s => scoresOf(s).length],
    ["unscored", "Unscored takes", "Scores", "num", false, s => count(s.takeIds, id => !isStem(id) && !Number.isFinite(takeRating(id).score))],
    ["picks", "Takes in Album picks", "Albums", "num", false, s => count(s.takeIds, id => plan().considered?.[id])],
    ["onAlbum", "Takes on an album", "Albums", "num", false, s => count(s.takeIds, albumOf)],
    ["albums", "Albums", "Albums", "text", false, albumNames],
    ["status", "Song status", "Decisions", "text", true, s => SONG_STATUSES.find(([k]) => k === songStatus(s))[1]],
    ["chosenTake", "Chosen take", "Decisions", "text", false, s => decision(s.key).chosen ? nameTake(decision(s.key).chosen) : ""],
    ["chosenLyric", "Chosen lyric", "Decisions", "text", false, s => { const v = versionsOf(s).find(x => x.stem === decision(s.key).lyric); return v ? M.versionLabel(v) : ""; }],
    ["next", "Next action", "Decisions", "text", false, s => decision(s.key).next || ""],
    ["notes", "Song notes", "Decisions", "text", false, s => decision(s.key).notes || ""],
    ["files", "Studio files", "Studio", "num", false, s => s.cat?.files ?? null],
    ["suggest", "Possible duplicates", "Studio", "text", false, s => (s.cat?.suggestions || []).map(x => M.bySong[x.key]?.title).filter(Boolean)],
    ["archivedOnly", "Archived only", "Studio", "text", false, s => s.cat?.archivedOnly ? "yes" : ""],
  ];
  // A take row is {stem, t (board take) or clip (newer on Suno), song, title, base, type, writer, created, duration, model, mode, where}.
  const takeAlbum = r => (r.stem ? albumOf(r.stem) : null);
  const takeItem = r => (r.stem ? plan().considered?.[r.stem] : null);
  const TAKE_COLS = [
    ["title", "Suno take", "Take", "text", true, r => r.title],
    ["song", "Song", "Take", "text", true, r => r.song?.title || r.base || ""],
    ["section", "Section", "Take", "text", false, r => r.song ? (isInstrumental(r.song) ? "Instrumental" : "Song") : ""],
    ["type", "Type", "Take", "text", true, r => r.type],
    ["writer", "Writer", "Take", "text", true, r => r.writer],
    ["created", "Created", "Take", "date", true, r => r.created || null],
    ["len", "Length (s)", "Take", "num", true, r => r.duration ? Math.round(r.duration) : null],
    ["model", "Model", "Take", "text", false, r => r.model],
    ["mode", "Mode", "Take", "text", false, r => r.mode],
    ["where", "Where", "Take", "text", true, r => r.where],
    ["score", "Score", "Take", "num", true, r => r.t ? takeRating(r.stem).score ?? null : null],
    ["ready", "Readiness", "Take", "text", false, r => r.t ? takeRating(r.stem).readiness || "" : ""],
    ["note", "Take note", "Take", "text", false, r => r.t ? takeRating(r.stem).note || "" : ""],
    ["album", "Album", "Albums", "text", true, r => { const a = takeAlbum(r); return a ? a[1].name.split(" ·")[0] : ""; }],
    ["albumPos", "Album position", "Albums", "num", false, r => { const a = takeAlbum(r); return a ? a[1].order.indexOf(r.stem) + 1 : null; }],
    ["picks", "In Album picks", "Albums", "text", false, r => takeItem(r) ? "yes" : ""],
    ["del", "Delete tag", "Albums", "text", false, r => { const i = takeItem(r); return i?.delDone ? "done" : i?.del ? "tagged" : ""; }],
    ["id", "Take id", "Details", "text", false, r => r.stem || ""],
    ["version", "Version", "Details", "text", false, r => r.t?.version ?? ""],
    ["takeNo", "Take number", "Details", "text", false, r => r.t?.take ?? ""],
    ["session", "Session", "Details", "text", false, r => r.t?.session || ""],
    ["source", "Source", "Details", "text", false, r => r.t?.source || ""],
    ["match", "Match", "Details", "text", false, r => r.t?.match || ""],
    ["packet", "Packet version", "Details", "text", false, r => r.t?.packetVersion ?? ""],
    ["oldTitle", "Previous title", "Details", "text", false, r => r.t?.oldTitle || ""],
    ["voice", "Voice name", "Details", "text", false, r => r.t?.voiceName || ""],
    ["personal", "Personal voice", "Details", "text", false, r => r.t?.personalVoice ? "yes" : ""],
    ["voiceChecked", "Voice checked", "Details", "text", false, r => r.t?.voiceChecked ? "yes" : ""],
    ["lyricVersion", "Lyric version", "Details", "text", false, r => r.t?.lyricStem || ""],
    ["style", "Suno style", "Details", "text", false, r => r.t?.suno?.style || ""],
  ];
  const COLS = {songs:SONG_COLS, instrumentals:SONG_COLS, takes:TAKE_COLS};
  const colFor = tab => COLS[tab] || SONG_COLS;
  const colSet = tab => tab === "takes" ? "takes" : "songs";   // Songs and Instrumentals share one column choice
  // ui.invCols[set] is null (use the defaults) or the list of visible column ids. Saved on this device only.
  function visibleCols(tab) { const chosen = ui.invCols[colSet(tab)]; return colFor(tab).filter(c => chosen ? chosen.includes(c[0]) : c[4]); }
  const cellText = v => Array.isArray(v) ? v.join("; ") : v == null ? "" : String(v);
  const shownCell = (c, v) => c[3] === "date" ? cellText(v).slice(0, 10) : cellText(v);

  // ----- Rows for each tab -----
  function songRows(tab) {
    return M.songs.filter(s => (tab === "instrumentals") === isInstrumental(s) && (ui.prompts || !s.prompt)).map(s => ({key:s.key, s}));
  }
  function takeRows({everything = false} = {}) {
    const board = Object.values(M.takes).filter(t => everything || t.type !== "Stem" || ui.showStems).map(t => ({key:M.songOfTake[t.stem], stem:t.stem, t, song:M.bySong[M.songOfTake[t.stem]], title:t.title, base:t.baseTitle, type:t.type, writer:t.writer, created:t.createdAt, duration:t.duration, model:t.model, mode:"", where:gone(t.stem) ? "Deleted on Suno" : "On the board"}));
    const clips = M.songs.flatMap(s => s.clips.filter(c => !c.onBoard).map(c => ({key:s.key, stem:c.id, clip:c, song:s, title:c.title, base:c.base, type:"", writer:c.writer, created:c.created, duration:c.duration, model:c.model, mode:c.mode || "", where:c.trashed ? "Trashed on Suno" : "Newer on Suno"})));
    return [...board, ...clips];
  }
  function fileRows() {
    const cat = L.catalog;
    if (ui.inv === "files" && cat) {
      const songOf = Object.fromEntries((cat.songs || []).flatMap(s => (s.file_ids || []).map(id => [id, s.id])));
      const keyOfCat = Object.fromEntries(M.songs.filter(s => s.cat).map(s => [s.cat.id, s.key]));
      return {head:["Path", "Song", "Type", "Writer", "Version", "Size", "Modified", "Archived"],
        rows:cat.files.map(f => ({key:keyOfCat[songOf[f.id]], file:f.id, cells:[f.path, M.bySong[keyOfCat[songOf[f.id]]]?.title || f.title, f.kind, f.writer, f.version, Math.round((f.size || 0) / 1024) + " KB", (f.modified || "").slice(0, 10), f.archived ? "yes" : ""]}))};
    }
    if (ui.inv === "playlists" && cat) return {head:["Playlist", "Tracks reported", "Owned", "Checked"],
      rows:(cat.playlists || []).map(p => ({url:p.url, cells:[p.name, p.song_count ?? "", p.owned ? "yes" : "not confirmed", (p.checked || "").slice(0, 16).replace("T", " ")]}))};
    return {head:["Loading"], rows:[]};
  }
  const isLocalTab = tab => ["files", "playlists", "coverage"].includes(tab);
  const rowSource = (tab, r) => tab === "takes" ? r : r.s;
  // A table is {cols, rows}; each row carries the raw value per column, so sorting, the screen and the CSV agree.
  function tableFor(tab, {everything = false} = {}) {
    if (isLocalTab(tab)) { const {head, rows} = fileRows(); return {local:true, cols:head.map((h, i) => [String(i), h, "", "text"]), rows:rows.map(r => ({...r, vals:r.cells}))}; }
    const cols = everything ? colFor(tab) : visibleCols(tab);
    const src = tab === "takes" ? takeRows({everything}) : everything ? M.songs.filter(s => (tab === "instrumentals") === isInstrumental(s)).map(s => ({key:s.key, s})) : songRows(tab);
    return {cols, rows:src.map(r => ({...r, vals:cols.map(c => c[5](rowSource(tab, r)))}))};
  }
  function filterRows(tab, rows) {
    const q = ui.invQ.trim().toLowerCase(); if (!q) return rows;
    // Looks at every column of the row, not just the visible ones, and never at lyric text.
    if (isLocalTab(tab)) return rows.filter(r => r.cells.join(" ").toLowerCase().includes(q));
    return rows.filter(r => colFor(tab).some(c => cellText(c[5](rowSource(tab, r))).toLowerCase().includes(q)));
  }
  function sortRows(tab, cols, rows) {
    const cur = ui.invSort[tab], i = cur ? cols.findIndex(c => c[0] === cur.col) : -1; if (i < 0) return rows;
    const type = cols[i][3], sign = cur.dir === "asc" ? 1 : -1;
    const val = r => { const v = r.vals[i]; return v == null || v === "" || (Array.isArray(v) && !v.length) ? null : Array.isArray(v) ? v.join("; ") : v; };
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      return (type === "num" ? Number(x) - Number(y) : String(x).localeCompare(String(y), undefined, {numeric:true, sensitivity:"base"})) * sign;
    });
  }
  const csvOf = (cols, rows) => "\ufeff" + [cols.map(c => c[1]), ...rows.map(r => r.vals.map((v, i) => shownCell(cols[i], v)))].map(r => r.map(csvCell).join(",")).join("\r\n");
  function downloadCsv(name, text) {
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], {type:"text/csv"})); link.download = name; link.click(); URL.revokeObjectURL(link.href);
  }
  // The rows currently shown (filtered and sorted) for a tab.
  function shownTable(tab) { const t = tableFor(tab); return {...t, rows:sortRows(tab, t.cols, filterRows(tab, t.rows))}; }
  function coverageHtml() {
    const cat = L.catalog; if (!cat) return `<p class="hint">${L.error ? esc(L.error) : "Loading the catalog…"}</p>`;
    const src = cat.coverage?.sources || {};
    return `<div class="coverage">${Object.entries(src).map(([name, obj]) => `<div class="panel"><b>${esc(name)}</b><dl>${Object.entries(obj).filter(([k]) => k !== "scan_errors").map(([k, v]) => `<dt>${esc(k.replaceAll("_", " "))}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl></div>`).join("")}</div>
      ${(cat.coverage?.issues || []).length ? `<h3 class="sub">Coverage notes</h3><ul class="sources">${cat.coverage.issues.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${(cat.coverage?.excluded || []).length ? `<h3 class="sub">Not scanned</h3><ul class="sources">${cat.coverage.excluded.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="hint">Catalog built ${esc((cat.built || "").slice(0, 16).replace("T", " "))} with ${esc(cat.sunox_version || "Sunox")}. Every Suno request is read-only.</p>`;
  }
  function invTableHtml() {
    const tab = ui.inv, t = shownTable(tab), total = tableFor(tab).rows.length, cur = ui.invSort[tab];
    const head = t.cols.map(c => {
      const on = cur?.col === c[0];
      return `<th${on ? ` aria-sort="${cur.dir === "asc" ? "ascending" : "descending"}"` : ""}>${t.local ? esc(c[1]) : `<button class="th-sort" data-inv-sort="${esc(c[0])}" title="Sort by ${esc(c[1])}">${esc(c[1])}${on ? (cur.dir === "asc" ? " ↑" : " ↓") : ""}</button>`}</th>`;
    }).join("");
    const body = t.rows.slice(0, ui.invLimit).map(r => {
      const id = tab === "takes" ? r.stem : r.key, openable = !t.local;
      return `<tr${openable ? ` data-inv-row="${esc(id)}"` : ""}${r.stem && openable ? ` data-take="${esc(r.stem)}"` : ""}>${r.vals.map((v, i) => {
        const text = shownCell(t.cols[i], v);
        if (i !== 0) return `<td${t.cols[i][3] === "num" ? ' class="num"' : ""}>${esc(text)}</td>`;
        return `<td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(text)}</a>` : r.file ? `<a href="${esc(L.fileUrl(r.file))}" target="_blank" rel="noopener"><code>${esc(text)}</code></a>${r.key ? ` <button class="linkish" data-song="${esc(r.key)}">song</button>` : ""}` : `<button class="linkish" data-inv-row="${esc(id)}">${esc(text)}</button>`}</td>`;
      }).join("")}</tr>`;
    }).join("");
    return `<p class="hint" id="invHint">${t.rows.length} of ${total} rows.${LOCAL ? "" : " Studio files, playlists and coverage appear when the board is opened from the local catalog server."}</p>
      <div class="table-wrap"><table class="inv-table"><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${t.cols.length || 1}" class="empty-note">No rows match.</td></tr>`}</tbody></table></div>
      ${t.rows.length > ui.invLimit ? `<button class="btn small" id="invMore">Show ${Math.min(200, t.rows.length - ui.invLimit)} more</button>` : ""}`;
  }
  function chooserHtml() {
    const tab = ui.inv, all = colFor(tab), on = new Set(visibleCols(tab).map(c => c[0])), groups = [...new Set(all.map(c => c[2]))];
    return `<details class="col-chooser" id="colChooser"${ui.chooserOpen ? " open" : ""}><summary>Columns (${on.size} of ${all.length})</summary>
      <div class="col-actions"><button class="btn small" id="colsAll">Show all</button><button class="btn small" id="colsReset">Reset to default</button></div>
      <div class="col-groups">${groups.map(g => `<fieldset><legend>${esc(g)}</legend>${all.filter(c => c[2] === g).map(c => `<label class="check"><input type="checkbox" data-inv-col="${esc(c[0])}"${on.has(c[0]) ? " checked" : ""}> ${esc(c[1])}</label>`).join("")}</fieldset>`).join("")}</div></details>`;
  }
  // The detail drawer: everything on one song or one take, in groups. No lyric text.
  const dl = rows => `<dl class="drawer-grid">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  function songDrawer(s) {
    const groups = [...new Set(SONG_COLS.map(c => c[2]))];
    const takes = s.takeIds.filter(id => ui.showStems || !isStem(id)).map(id => { const t = M.takes[id], r = takeRating(id), a = albumOf(id);
      return `<tr><td>${esc(t.title)}</td><td>${esc(t.type)}</td><td>${esc(t.writer)}</td><td>${esc((t.createdAt || "").slice(0, 10))}</td><td class="num">${esc(dur(t.duration))}</td><td class="num">${esc(r.score ?? "")}</td><td>${esc(a ? a[1].name.split(" ·")[0] + " #" + (a[1].order.indexOf(id) + 1) : "")}</td><td>${esc(gone(id) ? "Deleted on Suno" : "On the board")}</td></tr>`; }).join("");
    const clips = s.clips.filter(c => !c.onBoard).map(c => `<tr><td>${esc(c.title)}</td><td>${esc(c.mode || "")}</td><td>${esc(c.writer)}</td><td>${esc((c.created || "").slice(0, 10))}</td><td class="num">${esc(dur(c.duration))}</td><td></td><td></td><td>${esc(c.trashed ? "Trashed on Suno" : "Newer on Suno")}</td></tr>`).join("");
    const versions = versionsOf(s).map(v => [M.versionLabel(v), [v.writer, v.session, v.custom ? "my copy" : "", v.chars ? v.chars + " characters" : ""].filter(Boolean).join(" · ")]);
    return `<div class="drawer-head"><div><b>${esc(s.title)}</b><small>${esc(isInstrumental(s) ? "Instrumental" : "Song")}</small></div><div><button class="btn small" data-song="${esc(s.key)}">Open song page</button> <button class="btn small" id="invDrawerCsv" title="Every field of this song as a CSV file">Export this song</button> <button class="btn small" id="invDrawerClose" aria-label="Close details">Close</button></div></div>
      ${groups.map(g => `<section><h4>${esc(g)}</h4>${dl(SONG_COLS.filter(c => c[2] === g).map(c => [c[1], shownCell(c, c[5](s)) || "–"]))}</section>`).join("")}
      ${versions.length ? `<section><h4>Lyric versions (names only, no text)</h4>${dl(versions)}</section>` : ""}
      <section><h4>Suno takes</h4><div class="table-wrap"><table class="inv-table"><thead><tr><th>Take</th><th>Type or mode</th><th>Writer</th><th>Created</th><th>Length</th><th>Score</th><th>Album</th><th>Where</th></tr></thead><tbody>${takes + clips || '<tr><td colspan="8" class="empty-note">No takes.</td></tr>'}</tbody></table></div></section>
      ${L.enabled && L.filesBySong && s.cat ? `<section><h4>Studio files (this computer)</h4>${dl((L.filesBySong[s.cat.id] || []).map(f => [f.kind || "file", f.path]))}</section>` : ""}`;
  }
  function takeDrawer(stem) {
    const r = takeRows({everything:true}).find(x => x.stem === stem); if (!r) return "";
    const groups = [...new Set(TAKE_COLS.map(c => c[2]))];
    return `<div class="drawer-head"><div><b>${esc(r.title)}</b><small>${esc(r.song?.title || "")}</small></div><div>${r.key ? `<button class="btn small" data-song="${esc(r.key)}">Open song page</button> ` : ""}<button class="btn small" id="invDrawerClose" aria-label="Close details">Close</button></div></div>
      ${groups.map(g => `<section><h4>${esc(g)}</h4>${dl(TAKE_COLS.filter(c => c[2] === g).map(c => [c[1], shownCell(c, c[5](r)) || "–"]))}</section>`).join("")}`;
  }
  function renderDrawer() {
    const box = $("invDrawer"); if (!box) return;
    const id = ui.invOpen, html = !id ? "" : ui.inv === "takes" ? takeDrawer(id) : M.bySong[id] ? songDrawer(M.bySong[id]) : "";
    box.hidden = !html; box.innerHTML = html;
  }
  const invTabs = () => [["songs", "Songs"], ["instrumentals", "Instrumentals"], ["takes", "Every Suno take"], ...(L.enabled ? [["files", "Studio files"], ["playlists", "Playlists"], ["coverage", "Coverage"]] : [])].map(([k, l]) => `<button class="chip" role="tab" aria-pressed="${ui.inv === k}" data-inv="${k}">${l}</button>`).join("") + (L.enabled ? '<button class="btn small" id="invRefresh" title="Re-scan the Studio and read Suno again (read-only)">Refresh inventory</button>' : "");
  function renderInventory() {
    if (!["songs", "instrumentals", "takes", "files", "playlists", "coverage"].includes(ui.inv) || (!L.enabled && isLocalTab(ui.inv))) ui.inv = "songs";
    const tab = ui.inv, local = isLocalTab(tab);
    if (tab === "coverage") { $("page").innerHTML = `<div class="inventory"><h1>Inventory</h1><div class="tools"><div class="seg-tabs" role="tablist">${invTabs()}</div></div>${coverageHtml()}</div>`; return; }
    $("page").innerHTML = `<div class="inventory">
      <h1>Inventory</h1>
      <p class="hint">Everything the Studio knows about each song, in one table. Choose the columns, sort by any of them, click a row for all of its data. Lyric text is never shown or exported here. Column choices stay on this device.</p>
      <div class="tools"><div class="seg-tabs" role="tablist">${invTabs()}</div>
        ${tab === "takes" && stemCount() ? `<label class="check stems-toggle"><input type="checkbox" id="showStems"${ui.showStems ? " checked" : ""}> Show archived stems (${stemCount()})</label>` : ""}
        ${tab === "instrumentals" ? `<label class="check stems-toggle"><input type="checkbox" id="fPrompts"${ui.prompts ? " checked" : ""}> Show beat prompts</label>` : ""}
        <input type="search" id="invQ" value="${esc(ui.invQ)}" placeholder="Filter rows (searches every field)" aria-label="Filter rows">
        ${local ? '<button class="btn small" id="invCsv">Export CSV</button>' : '<button class="btn small" id="invCsv" title="The columns you can see now, in the order shown">Export CSV (visible columns)</button><button class="btn small" id="invCsvAll" title="Every column and every row, stems and beat prompts included">Export CSV (everything)</button>'}</div>
      ${local ? "" : chooserHtml()}
      <div id="invBody">${invTableHtml()}</div>
      <aside class="inv-drawer" id="invDrawer" hidden aria-label="Details"></aside>
    </div>`;
    renderDrawer();
  }
  function refreshInvBody() { const b = $("invBody"); if (b) b.innerHTML = invTableHtml(); }

  // ---------- render ----------
  function renderMain() {
    if (ui.view === "songs") { renderList(); renderSongPage(); }
    else if (ui.view === "inventory") renderInventory();
  }

  // ---------- editing lyrics ----------
  let editTimer = null, editTarget = null;
  function currentVersion() { const s = M.bySong[ui.song]; return s ? versionsOf(s).find(v => v.stem === $("page").dataset.version) || null : null; }
  function onEditorInput(el) {
    const s = M.bySong[ui.song], v = currentVersion(); if (!s || !v) return;
    const fieldName = el.dataset.ed;
    if (!v.custom) {
      if (fieldName !== "lyrics" || el.value === textOf(v)) return;
      const n = (stores.lyric().custom?.[v.slug] || []).length + 1;
      const copy = {stem:`mine-${v.slug}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`, custom:true, version:0, label:"My copy " + n, writer:"Me", session:v.session, copiedFrom:v.stem,
        title:v.title, lyrics:el.value, header:"", suno:{title:v.suno?.title || v.title, lyrics:el.value, style:v.suno?.style || "", exclude:v.suno?.exclude || "", ...(v.suno?.instrumental != null ? {instrumental:v.suno.instrumental} : {})}, created:Date.now()};
      stores.addCustom(v.slug, copy); stores.setPick(v.slug, copy.stem);
      ui.version = copy.stem; $("page").dataset.version = copy.stem; pushHistory(true);
      $("lyricTitle").textContent = copy.label; $("editHint").textContent = `Saved as ${copy.label}. Changes keep saving as you type. Click Done to see the other fields.`;
      toast("Your own copy started: " + copy.label);
      return;
    }
    editTarget = {slug:v.slug, stem:v.stem};
    clearTimeout(editTimer);
    editTimer = setTimeout(() => flushEdit(), 400);
  }
  function flushEdit() {
    clearTimeout(editTimer); editTimer = null;
    if (!editTarget) return;
    const {slug, stem} = editTarget, values = {}, v = (stores.lyric().custom?.[slug] || []).find(x => x.stem === stem); if (!v) return;
    const su = {...(v.suno || {})};
    for (const el of document.querySelectorAll("#page [data-ed]")) {
      const k = el.dataset.ed;
      if (k === "label") values.label = el.value.trim() || v.label;
      else if (k === "lyrics") { values.lyrics = el.value; su.lyrics = el.value; }
      else su[k] = el.value;
    }
    values.suno = su; editTarget = null;
    stores.updateCustom(slug, stem, values);
  }
  async function saveToStudio() {
    const s = M.bySong[ui.song], v = currentVersion(); if (!LOCAL || !s || !v?.custom) return;
    flushEdit();
    try {
      const data = await L.saveLyrics({song_key:s.cat?.id || s.key, title:s.title, text:textOf(v), based_on:v.copiedFrom || ""});
      stores.updateCustom(v.slug, v.stem, {savedTo:data.path, savedVersion:data.version});
      toast("Saved to Studio as " + data.path.split("/").pop()); renderSongPage();
    } catch (err) { toast("Couldn't save to Studio: " + err.message); }
  }

  // ---------- highlights ----------
  document.addEventListener("pointerup", e => {
    const box = $("lyricText"); if (!box || !box.contains(e.target)) return;
    const v = currentVersion(); if (!v) return;
    const text = textOf(v), sel = getSelection();
    const lineOf = node => (node?.nodeType === 3 ? node.parentElement : node)?.closest?.(".review-line");
    let start, end;
    if (sel && !sel.isCollapsed && box.contains(sel.anchorNode)) {
      const offset = (node, off) => { const line = lineOf(node); if (!line) return null; const range = document.createRange(); range.selectNodeContents(line); range.setEnd(node, off); return +line.dataset.start + range.toString().length; };
      const a = offset(sel.anchorNode, sel.anchorOffset), b = offset(sel.focusNode, sel.focusOffset);
      if (a == null || b == null) return; start = Math.min(a, b); end = Math.max(a, b);
    } else { const line = lineOf(e.target); if (!line) return; start = +line.dataset.start; end = +line.dataset.end; }
    if (end <= start || !text.slice(start, end).trim()) return;
    const existing = R.marks(lyricRating(v.stem)).find(m => m.start === start && m.end === end);
    if (existing) { stores.setLyric(v.stem, {[existing.key]:null}); toast("Highlight removed"); }
    else { stores.setLyric(v.stem, {["mark:" + crypto.randomUUID()]:{start, end, quote:text.slice(start, end), fingerprint:R.fingerprint(text), color:ui.color, comment:""}}); toast("Highlighted"); }
    sel?.removeAllRanges(); renderSongPage();
  });

  // ---------- events ----------
  document.addEventListener("click", e => {
    // Planner links to a take ("Details", "Open in Lyric Board"): open it here instead of loading a new page.
    const a = e.target.closest?.('a[href^="./?t="]');
    if (a && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      const stem = new URL(a.href).searchParams.get("t"), song = M.songOfTake[stem];
      if (ui.view === "songs" && ui.song === song) { ui.details.has(stem) ? ui.details.delete(stem) : ui.details.add(stem); renderSongPage(); return; }
      ui.details.add(stem); go({view:"songs", song, version:M.takes[stem]?.lyricStem || null}); return;
    }
    const cp = e.target.closest?.("[data-copy-path]"); if (cp) { copyText(cp.dataset.copyPath, "path"); return; }
    const t = e.target.closest("[data-view],#fSortDir,[data-song],[data-version],[data-song-back],[data-edit],[data-color],[data-color-names],[data-lyric-undo],[data-copy],[data-choose],[data-details],[data-consider],[data-lyric-status],[data-lyric-tag],[data-del-mark],[data-del-copy],[data-save-studio],[data-inv],[data-inv-sort],[data-inv-row],#invCsv,#invCsvAll,#invDrawerCsv,#invDrawerClose,#colsAll,#colsReset,#invMore,#studioRetry,#dataBtn,#dataClose,#lyricExport,#reviewExport,#studioExport,#lyricImport,#colorSave,#colorCancel");
    if (!t) return;
    if (t.id === "studioRetry") return stores.retry();
    if (t.id === "invRefresh") {
      t.disabled = true; t.textContent = "Refreshing…"; toast("Refreshing the inventory. This reads the Studio and Suno and can take a few minutes.");
      L.refresh(err => toast(err ? "Refresh finished with a problem: " + err : "Inventory refreshed. Reloading…")).then(() => location.reload()).catch(err => { toast("Couldn't refresh: " + err.message); t.disabled = false; t.textContent = "Refresh inventory"; });
      return;
    }
    if (t.id === "dataBtn") return $("dataDialog").showModal();
    if (t.id === "dataClose") return $("dataDialog").close();
    if (t.id === "lyricExport") return download("lyric-board-" + new Date().toISOString().slice(0, 10) + ".json", stores.exportLyric());
    if (t.id === "reviewExport") return download("lyric-review-" + new Date().toISOString().slice(0, 10) + ".json", stores.exportReview());
    if (t.id === "studioExport") return download("studio-decisions-" + new Date().toISOString().slice(0, 10) + ".json", stores.exportStudio());
    if (t.id === "lyricImport") return $("lyricImportFile").click();
    if (t.id === "colorCancel") return $("colorDialog").close();
    if (t.id === "colorSave") {
      const labels = Object.fromEntries([...document.querySelectorAll("#colorFields input")].map(i => [i.dataset.colorKey, i.value.trim().slice(0, 50) || Object.fromEntries(R.colors)[i.dataset.colorKey]]));
      stores.setLyric("__review_preferences__", {colorLabels:labels}); $("colorDialog").close(); renderSongPage(); return;
    }
    if (t.dataset.inv) { ui.inv = t.dataset.inv; ui.invLimit = 200; ui.invOpen = null; savePrefs(); return renderInventory(); }
    if (t.id === "invMore") { ui.invLimit += 200; return refreshInvBody(); }
    if (t.dataset.invSort) {
      const cur = ui.invSort[ui.inv], col = colFor(ui.inv).find(c => c[0] === t.dataset.invSort);
      ui.invSort[ui.inv] = cur?.col === col[0] ? {col:col[0], dir:cur.dir === "asc" ? "desc" : "asc"} : {col:col[0], dir:col[3] === "text" ? "asc" : "desc"};
      ui.invLimit = 200; savePrefs(); return refreshInvBody();
    }
    if (t.dataset.invRow !== undefined) { ui.invOpen = t.dataset.invRow; renderDrawer(); $("invDrawer")?.scrollIntoView?.({block:"nearest"}); return; }
    if (t.id === "invDrawerClose") { ui.invOpen = null; return renderDrawer(); }
    if (t.id === "invDrawerCsv") {
      const s = M.bySong[ui.invOpen]; if (!s) return;
      downloadCsv(`studio-song-${s.key}.csv`, csvOf(SONG_COLS, [{vals:SONG_COLS.map(c => c[5](s))}])); return;
    }
    if (t.id === "colsAll" || t.id === "colsReset") {
      ui.invCols[colSet(ui.inv)] = t.id === "colsAll" ? colFor(ui.inv).map(c => c[0]) : null;
      savePrefs(); ui.chooserOpen = true; renderInventory(); return;
    }
    if (t.id === "invCsv") { const tb = shownTable(ui.inv); return downloadCsv(`studio-${ui.inv}-visible.csv`, csvOf(tb.cols, tb.rows)); }
    if (t.id === "invCsvAll") { const tb = tableFor(ui.inv, {everything:true}); return downloadCsv(`studio-${ui.inv}-everything.csv`, csvOf(tb.cols, tb.rows)); }
    if (t.dataset.view === "instrumentals") return go({view:"songs", section:"instrumentals"});
    if (t.dataset.view === "songs" && t.matches(".rail-item,.stat")) return go({view:"songs", section:"songs"});
    if (t.id === "fSortDir") { const cur = ui.sorts[ui.section]; cur.dir = cur.dir === "asc" ? "desc" : "asc"; savePrefs(); return renderList(); }
    if (t.dataset.view) return go({view:t.dataset.view});
    if (t.dataset.song !== undefined) {
      if (!t.dataset.song) return;
      const take = t.closest("[data-take]")?.dataset.take;
      if (take && M.takes[take]) ui.details.add(take);
      return go({view:"songs", song:t.dataset.song, version:take ? M.takes[take]?.lyricStem || null : null});
    }
    if (t.dataset.songBack !== undefined) return go({song:null, version:null});
    const s = M.bySong[ui.song];
    if (t.dataset.version) { ui.editing = false; const v = versionsOf(s).find(x => x.stem === t.dataset.version); if (v) stores.setPick(v.slug, v.stem); return go({version:t.dataset.version}); }
    if (t.dataset.edit !== undefined) { if (ui.editing) flushEdit(); ui.editing = !ui.editing; renderSongPage(); renderList(); return; }
    if (t.dataset.color) { ui.color = t.dataset.color; savePrefs(); return renderSongPage(); }
    if (t.dataset.colorNames !== undefined) {
      const names = colorNames();
      $("colorFields").innerHTML = R.colors.map(([c]) => `<label class="color-field"><span class="swatch swatch-${c}">${esc(Object.fromEntries(R.colors)[c])}</span><input data-color-key="${c}" value="${esc(names[c])}" maxlength="50"></label>`).join("");
      return $("colorDialog").showModal();
    }
    if (t.dataset.lyricUndo !== undefined) { if (stores.undoLyric()) toast("Review change undone"); return renderSongPage(); }
    if (t.dataset.copy) {
      const [kind, stem] = t.dataset.copy.split(":"), v = currentVersion(), tk = stem ? M.takes[stem] : null;
      const val = {lyrics:textOf(v), prompt:textOf(v), title:v?.suno?.title || v?.title, style:v?.suno?.style, instrumental:v?.suno?.instrumental, exclude:v?.suno?.exclude, sunoLyrics:v?.suno?.lyrics ?? v?.lyrics,
        "take-style":tk?.suno?.style, "take-exclude":tk?.suno?.exclude, "take-lyrics":tk?.suno?.lyrics ?? tk?.lyrics, "take-title":tk?.title}[kind];
      return val ? copyText(val, {sunoLyrics:"Suno lyrics", "take-style":"generation style", "take-exclude":"excluded styles", "take-lyrics":"Suno lyrics", "take-title":"Suno title"}[kind] || kind) : toast("Nothing to copy");
    }
    if (t.dataset.choose) { const cur = decision(s.key).chosen; saveSong(s.key, {chosen:cur === t.dataset.choose ? "" : t.dataset.choose}); toast(cur === t.dataset.choose ? "Chosen take cleared" : "Chosen take set"); renderSongPage(); return; }
    if (t.dataset.details) { ui.details.has(t.dataset.details) ? ui.details.delete(t.dataset.details) : ui.details.add(t.dataset.details); return renderSongPage(); }
    if (t.dataset.consider) { const n = P().consider([t.dataset.consider]); toast(n ? "Added to Album picks" : "Already in Album picks"); return renderSongPage(); }
    if (t.dataset.saveStudio !== undefined) return saveToStudio();
    if (t.dataset.delCopy !== undefined) {
      const v = currentVersion(); if (!v?.custom || !confirm(`Delete "${v.label || "My copy"}"? Its highlights and notes go too. The original version stays.`)) return;
      stores.deleteCustom(v.slug, v.stem); ui.version = v.copiedFrom || null; ui.editing = false; toast("Copy deleted"); return go({}, {push:false});
    }
    const stem = $("page").dataset.version; if (!stem) return;
    if (t.dataset.lyricStatus) { stores.setLyric(stem, {status:lyricRating(stem).status === t.dataset.lyricStatus ? null : t.dataset.lyricStatus}); return renderSongPage(); }
    if (t.dataset.lyricTag) { const tags = new Set(lyricRating(stem).tags || []); tags.has(t.dataset.lyricTag) ? tags.delete(t.dataset.lyricTag) : tags.add(t.dataset.lyricTag); stores.setLyric(stem, {tags:[...tags]}); return renderSongPage(); }
    if (t.dataset.delMark) { stores.setLyric(stem, {[t.dataset.delMark]:null}); return renderSongPage(); }
  });
  const textTimers = {};
  function debounce(key, fn) { clearTimeout(textTimers[key]); textTimers[key] = setTimeout(() => { delete textTimers[key]; fn(); }, 400); }
  document.addEventListener("input", e => {
    const t = e.target;
    if (t.id === "songQ") { ui.q = t.value; return renderList(); }
    if (t.id === "invQ") { ui.invQ = t.value; ui.invLimit = 200; return refreshInvBody(); }
    if (t.dataset.ed) return onEditorInput(t);
    const key = ui.song;
    if (t.dataset.songText) { const f = t.dataset.songText, val = t.value; return debounce("song:" + f, () => saveSong(key, {[f]:val})); }
    const stem = $("page").dataset.version;
    if (t.matches("[data-lyric-note]")) { const val = t.value; return debounce("note:" + stem, () => stores.setLyric(stem, {note:val}, {undoable:false})); }
    if (t.dataset.markComment) { const k = t.dataset.markComment, val = t.value; return debounce("mark:" + k, () => { const m = lyricRating(stem)[k]; if (m) stores.setLyric(stem, {[k]:{...m, comment:val}}, {undoable:false}); }); }
  });
  // Flush pending text saves when a box loses focus or the page is hidden.
  function flushAll() { for (const [k, id] of Object.entries(textTimers)) { clearTimeout(id); delete textTimers[k]; } for (const el of document.querySelectorAll("#page [data-song-text],#page [data-lyric-note],#page [data-mark-comment]")) el.dispatchEvent(new Event("change", {bubbles:true})); if (editTarget) flushEdit(); }
  addEventListener("pagehide", flushAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushAll(); });
  document.addEventListener("change", e => {
    const t = e.target;
    if (t.id === "fLocation") { ui.location = t.value; savePrefs(); return renderList(); }
    if (t.id === "fWriter") { ui.writer = t.value; savePrefs(); return renderList(); }
    if (t.id === "fStatus") { ui.status = t.value; savePrefs(); return renderList(); }
    if (t.id === "fSort") { const d = SORTS.find(r => r[0] === t.value); ui.sorts[ui.section] = {by:d[0], dir:d[3]}; savePrefs(); return renderList(); }
    if (t.dataset.invCol) {
      const set = colSet(ui.inv), cur = new Set(visibleCols(ui.inv).map(c => c[0]));
      t.checked ? cur.add(t.dataset.invCol) : cur.delete(t.dataset.invCol);
      if (!cur.size) { cur.add(colFor(ui.inv)[0][0]); t.checked = t.dataset.invCol === colFor(ui.inv)[0][0]; }
      ui.invCols[set] = colFor(ui.inv).map(c => c[0]).filter(id => cur.has(id));   // keeps the table's own column order
      ui.chooserOpen = true; savePrefs(); const sum = document.querySelector?.("#colChooser summary"); if (sum) sum.textContent = `Columns (${cur.size} of ${colFor(ui.inv).length})`;
      return refreshInvBody();
    }
    if (t.id === "showStems") { ui.showStems = t.checked; savePrefs(); return ui.view === "inventory" ? renderInventory() : renderSongPage(); }
    if (t.id === "fPrompts") { ui.prompts = t.checked; savePrefs(); renderRail(); return ui.view === "inventory" ? renderInventory() : renderList(); }
    if (t.id === "takeType") { ui.takeType = t.value; savePrefs(); return renderSongPage(); }
    if (t.id === "showArchived") { ui.showArchived = t.checked; return renderSongPage(); }
    if (t.id === "lyricImportFile") {
      const f = t.files[0]; if (!f) return;
      f.text().then(text => { toast(stores.importLyric(JSON.parse(text))); renderMain(); }).catch(err => toast("Import failed: " + err.message)).finally(() => { t.value = ""; });
      return;
    }
    const key = ui.song, stem = $("page").dataset.version;
    if (t.dataset.songField) { saveSong(key, {[t.dataset.songField]:t.value}); renderList(); if (t.dataset.songField !== "status") renderSongPage(); return; }
    if (t.dataset.songText) { clearTimeout(textTimers["song:" + t.dataset.songText]); delete textTimers["song:" + t.dataset.songText]; if ((decision(key)[t.dataset.songText] || "") !== t.value) saveSong(key, {[t.dataset.songText]:t.value}); return; }
    if (t.dataset.lyricField) { stores.setLyric(stem, {[t.dataset.lyricField]:t.value}); return; }
    if (t.matches("[data-lyric-note]")) { clearTimeout(textTimers["note:" + stem]); delete textTimers["note:" + stem]; if ((lyricRating(stem).note || "") !== t.value) stores.setLyric(stem, {note:t.value}, {undoable:false}); return; }
    if (t.dataset.markComment) { const m = lyricRating(stem)[t.dataset.markComment]; if (m && (m.comment || "") !== t.value) stores.setLyric(stem, {[t.dataset.markComment]:{...m, comment:t.value}}, {undoable:false}); }
  });
  document.addEventListener("focusout", e => { if (e.target.dataset?.ed && editTarget) flushEdit(); });
  document.addEventListener("keydown", e => {
    if (e.defaultPrevented) return;
    if (e.target.closest?.(".song-row") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); return go({view:"songs", song:e.target.closest(".song-row").dataset.song}); }
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.("input,textarea,select,[contenteditable]") || document.querySelector("dialog[open]")) return;
    if (e.key === "/") { e.preventDefault(); if (ui.view !== "songs") go({view:"songs"}); $("songQ").focus(); $("songQ").select(); }
    else if (e.key === "Escape" && ui.view === "inventory" && ui.invOpen) { ui.invOpen = null; renderDrawer(); }
    else if (e.key === "Escape" && ui.view === "songs" && ui.song && !ui.editing && !document.querySelector(".menu:not(.hidden)")) go({song:null});
    else if (e.key === "[" || e.key === "]") {
      if (ui.view !== "songs") return;
      const rows = filteredSongs(), i = rows.findIndex(r => r.key === ui.song), next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "]" ? 1 : -1)))];
      if (next) { e.preventDefault(); go({song:next.key}); document.querySelector(`.song-row[data-song="${CSS.escape(next.key)}"]`)?.scrollIntoView({block:"nearest"}); }
    }
  });
  // The tracklist bar opens and closes on every screen size here (the planner only does that on phones).
  $("panelBar").addEventListener("click", () => document.body.classList.toggle("dock-open", $("trackPanel").classList.contains("open")));

  if (ui.q) $("songQ").value = ui.q;   // from an old-board ?q= link
  renderFilters();
  pushHistory(true);
  layout();
  if (plannerVisible()) P()?.show(ui.view); else renderMain();
  stores.start();
  renderSyncMore();
  if (L.enabled) {
    addEventListener("studio-local-mirror", renderSyncMore);
    L.ready.then(async () => {
      // Decisions saved in the catalog's own "Your call" form fill songs the Studio Board hasn't decided yet.
      const notes = await L.importedDecisions(), keyOfCat = Object.fromEntries(M.songs.filter(s => s.cat).map(s => [s.cat.id, s.key]));
      for (const [id, n] of Object.entries(notes)) {
        const key = keyOfCat[id]; if (!key || Object.keys(decision(key)).length) continue;
        const values = {status:n.status || undefined, chosen:n.chosen_take || undefined, next:n.next_action || undefined, notes:n.notes || undefined};
        if (Object.values(values).some(Boolean)) stores.setSong(key, values);
      }
      renderMain(); renderSyncMore();
    });
  }
})();
