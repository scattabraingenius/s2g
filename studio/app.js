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
  const SORTS = [["recent", "Recent activity"], ["title", "Title"], ["score", "Best score"], ["takes", "Most takes"]];
  const LYRIC_STATUSES = [["short", "Shortlist"], ["maybe", "Maybe"], ["revision", "Needs revision"], ["preferred", "Preferred"], ["cut", "Cut"]];
  const SONG_STATUSES = [["needs_review", "Needs review"], ["incomplete", "Incomplete"], ["complete", "Complete"]];

  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(VIEW_KEY)) || {}; } catch (err) {}
  const ui = {view:"songs", song:null, version:null, q:"", location:prefs.location || "all", writer:prefs.writer || "all", status:prefs.status || "all", sort:prefs.sort || "recent",
    prompts:!!prefs.prompts, takeType:prefs.takeType || "listen", color:prefs.color || "yellow", editing:false, details:new Set(), inv:prefs.inv || "songs", invQ:"", invLimit:200};
  function savePrefs() { try { localStorage.setItem(VIEW_KEY, JSON.stringify({location:ui.location, writer:ui.writer, status:ui.status, sort:ui.sort, prompts:ui.prompts, takeType:ui.takeType, color:ui.color, inv:ui.inv})); } catch (err) {} }
  function readRoute() {
    const p = new URLSearchParams(location.search);
    const view = VIEWS.includes(p.get("view")) ? p.get("view") : "songs";
    let song = M.bySong[p.get("song")] ? p.get("song") : null, version = p.get("v") || null;
    const t = p.get("t");
    if (t) { song = M.songOfTake[t] || M.songs.find(s => s.clips.some(c => c.id === t))?.key || song; version = M.takes[t]?.lyricStem || version; ui.details.add(t); return {view:"songs", song, version}; }
    return {view, song, version};
  }
  Object.assign(ui, readRoute());

  // ---------- stores ----------
  const syncText = {lyric:"", studio:""};
  const stores = StudioStores.create({lyricBySlug:M.lyricBySlug,
    onChange:(name, why) => { if (why === "remote") requestSongRender(); },
    onStatus:(name, text, failed) => { syncText[name] = {text, failed}; renderSyncMore(); }});
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
  const typeOk = stem => ui.takeType === "all" || (ui.takeType === "listen" ? !isStem(stem) : (M.takes[stem]?.type || "Vocal") === ui.takeType);
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
    if (ui.view === "songs" && ui.song) { p.set("song", ui.song); if (ui.version) p.set("v", ui.version); }
    if (plannerVisible()) { const n = P()?.ui; if (n?.session && ui.view === "sessions") p.set("session", n.session); if (n?.album) p.set("album", n.album); }
    return location.pathname + (p.toString() ? "?" + p : "");
  }
  function pushHistory(replace = false) {
    const st = {studio:{view:ui.view, song:ui.song, version:ui.version}, plannerNavigation:P() ? {view:P().ui.view, session:P().ui.session, album:P().ui.album} : null};
    if (replace) history.replaceState(st, "", url()); else if (JSON.stringify(history.state?.studio) !== JSON.stringify(st.studio) || location.pathname + location.search !== url()) history.pushState(st, "", url());
  }
  function go(next, {push = true} = {}) {
    if (next.song !== undefined && next.song !== ui.song) { ui.editing = false; if (next.version === undefined) next.version = null; }
    Object.assign(ui, next);
    if (push) pushHistory();
    if (plannerVisible()) { layout(); P()?.show(ui.view); } else { layout(); renderMain(); }
    if (ui.view === "songs" && ui.song) $("pageWrap").scrollTop = 0;
  }
  addEventListener("popstate", e => {
    const s = e.state?.studio || readRoute();
    Object.assign(ui, {view:s.view || "songs", song:s.song || null, version:s.version || null, editing:false});
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
    for (const b of document.querySelectorAll(".rail-item")) { const on = b.dataset.view === ui.view; b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); }
    $("countSongs").textContent = M.songs.filter(s => !s.prompt).length;
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
    const list = M.songs.filter(s => (ui.prompts || !s.prompt) &&
      (ui.location === "all" || (ui.location === "new" ? s.newTakes > 0 : ui.location === "album" ? s.takeIds.some(albumOf) : s.location === ui.location)) &&
      (ui.writer === "all" || s.writers.includes(ui.writer)) && (ui.status === "all" || songStatus(s) === ui.status) &&
      (!q || M.searchText(s).includes(q) || (decision(s.key).notes || "").toLowerCase().includes(q) || (decision(s.key).next || "").toLowerCase().includes(q) ||
        s.takeIds.some(id => (takeRating(id).note || "").toLowerCase().includes(q)) || versionsOf(s).some(v => (lyricRating(v.stem).note || "").toLowerCase().includes(q))));
    const by = {
      recent:(a, b) => (b.latest || "").localeCompare(a.latest || ""),
      title:(a, b) => a.title.localeCompare(b.title, undefined, {numeric:true}),
      score:(a, b) => (bestScore(b) ?? -1) - (bestScore(a) ?? -1),
      takes:(a, b) => (b.takeIds.length + b.newTakes) - (a.takeIds.length + a.newTakes),
    }[ui.sort] || (() => 0);
    return list.sort((a, b) => by(a, b) || a.title.localeCompare(b.title, undefined, {numeric:true}));
  }
  const LOC_BADGE = {local:'<span class="badge warn">Not on Suno</span>', suno:'<span class="badge">Suno only</span>'};
  function renderList() {
    if (ui.view !== "songs") return;
    const songs = filteredSongs();
    $("songCount").textContent = songs.length + (songs.length === 1 ? " song" : " songs");
    $("songList").innerHTML = songs.map(s => {
      const best = bestScore(s), versions = versionsOf(s).length, st = songStatus(s), onAlbum = s.takeIds.some(albumOf);
      return `<div class="song-row${s.key === ui.song ? " on" : ""}" role="option" tabindex="0" aria-selected="${s.key === ui.song}" data-song="${esc(s.key)}">
        <div class="song-row-main"><b>${esc(s.title)}</b><small>${versions} lyric${versions === 1 ? "" : "s"} · ${s.takeIds.length} take${s.takeIds.length === 1 ? "" : "s"}${s.writers.length ? " · " + esc(s.writers.join(", ")) : ""}</small>
        <span class="row-badges">${LOC_BADGE[s.location] || ""}${s.newTakes ? `<span class="badge new">${s.newTakes} new on Suno</span>` : ""}${onAlbum ? '<span class="badge short">On album</span>' : ""}${st === "complete" ? '<span class="badge short">Complete</span>' : st === "incomplete" ? '<span class="badge maybe">Incomplete</span>' : ""}${s.prompt ? '<span class="badge">Beat prompt</span>' : ""}</span></div>
        <span class="score ${scoreClass(best)}">${best ?? "–"}</span></div>`;
    }).join("") || `<div class="empty-note">No songs match. Clear the search or filters.</div>`;
  }
  function renderFilters() {
    const opt = (list, cur) => list.map(([k, l]) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(l)}</option>`).join("");
    $("fLocation").innerHTML = opt(LOCATIONS, ui.location);
    $("fWriter").innerHTML = opt([["all", "All writers"], ...M.writers.map(w => [w, w])], ui.writer);
    $("fStatus").innerHTML = opt([["all", "Any song status"], ...SONG_STATUSES], ui.status);
    $("fSort").innerHTML = opt(SORTS.map(([k, l]) => [k, "Sort: " + l.toLowerCase()]), ui.sort);
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
      <button class="btn small back" data-song-back>← Songs</button>
      <div class="song-title"><h1>${esc(s.title)}</h1>
        <div class="meta">${esc(s.writers.join(", ") || "Writer unknown")} · ${versions.length} lyric versions · ${s.takeIds.length} takes on the board${s.trashedTakes ? ` · ${s.trashedTakes} trashed on Suno` : ""}${M.akaOf(s).length ? `<br>Also called ${esc(M.akaOf(s).join(", "))}` : ""}</div></div>
      <div class="decision">
        <label>Song status <select data-song-field="status">${opt(SONG_STATUSES, songStatus(s))}</select></label>
        <label>Chosen take <select data-song-field="chosen">${opt([["", "None chosen yet"], ...takes.map(id => [id, P().nameOf(id) + " · " + P().takeLabel(M.takes[id])])], d.chosen || "")}</select></label>
        <label class="wide">Chosen lyric <select data-song-field="lyric">${opt([["", "None chosen yet"], ...versions.map(v => [v.stem, M.versionLabel(v)])], d.lyric || "")}</select></label>
        <label class="wide">Next action <input data-song-text="next" value="${esc(d.next ?? homeNext)}" placeholder="Re-run the hook with a half-time verse 2" maxlength="500"></label>
        <details class="wide song-notes"${d.notes ? " open" : ""}><summary>Song notes${d.notes ? "" : " (none yet)"}</summary><textarea data-song-text="notes" rows="3" maxlength="20000" placeholder="Listening notes for the whole song">${esc(d.notes || "")}</textarea></details>
      </div>
      ${flags.join("")}
    </div>`;
  }
  function versionChips(s, versions, current) {
    if (!versions.length) return `<div class="empty-note">No lyric versions on the Lyric Board for this song yet.${s.cat?.versions?.length ? " The Studio has " + esc(s.cat.versions.join(", ")) + "." : ""}</div>`;
    const chosen = decision(s.key).lyric;
    return `<div class="version-chips" role="tablist" aria-label="Lyric versions">${versions.map(v => {
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
    const types = [["listen", "Vocals and instrumentals"], ["Vocal", "Vocals"], ["Instrumental", "Instrumentals"], ["Stem", "Stems"], ["all", "Everything"]];
    const target = plan().albums?.[P().ui.album];
    return `<div class="pane takes-pane">
      <div class="pane-head"><div><b>Takes</b><small>Status buttons apply to ${esc(target?.name || "the album")} (change it at the bottom)</small></div>
        <select id="takeType" aria-label="Which takes to show">${types.map(([k, l]) => `<option value="${k}"${k === ui.takeType ? " selected" : ""}>${l}</option>`).join("")}</select></div>
      ${v ? `<h3 class="sub">This version (${visible(own).length})</h3>${visible(own).map(id => takeWrap(id, s)).join("") || '<div class="empty-note">No takes of this version yet.</div>'}` : ""}
      ${visible(other).length ? `<details class="panel" ${v && visible(own).length ? "" : "open"}><summary>${v ? "Other takes of this song" : "Takes"} (${visible(other).length})</summary>${visible(other).map(id => takeWrap(id, s)).join("")}</details>` : ""}
      ${fresh.length ? `<details class="panel" open><summary>Newer on Suno, not in the board snapshot (${fresh.length})</summary>${fresh.map(c => `<div class="fresh-take"><div><b>${esc(c.title)}</b><small>${esc([c.writer, c.version, c.mode, dur(c.duration), (c.created || "").slice(0, 10)].filter(Boolean).join(" · "))}</small></div><div class="take-actions"><a class="btn small" data-play href="https://suno.com/song/${encodeURIComponent(c.id)}" target="_blank" rel="noopener">▶ Suno</a><button class="btn small" data-consider="${esc(c.id)}" ${considered.has(c.id) ? "disabled" : ""}>${considered.has(c.id) ? "In Album picks" : "Add to Album picks"}</button></div></div>`).join("")}<div class="hint">Album picks shows these as "Suno ${"xxxxxxxx"}" until the board data is rebuilt; scores and statuses carry over.</div></details>` : ""}
      <div class="hint">${[stems && !["Stem", "all"].includes(ui.takeType) ? `${stems} stems hidden` : "", deleted ? `${deleted} deleted on Suno` : ""].filter(Boolean).join(" · ")}</div>
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
    $("page").innerHTML = songHeader(s, versions) + versionChips(s, versions, v) + `<div class="song-body">${lyricsPane(s, v)}${takesPane(s, versions, v)}</div>`;
    $("page").dataset.version = v?.stem || "";
    $("pageWrap").scrollTop = scroll;
    document.querySelectorAll("#page textarea.note").forEach(t => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, 120) + "px"; });
    if (focused) $("page").querySelector(`.card[data-stem="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    if (ui.editing) $("lyricEditor")?.focus({preventScroll:true});
  }
  function homePage() {
    const c = M.songs.filter(s => !s.prompt), local = c.filter(s => s.location === "local"), fresh = c.filter(s => s.newTakes);
    const decided = c.filter(s => songStatus(s) === "complete").length;
    return `<div class="home">
      <h1>All your songs in one place</h1>
      <p class="meta">Pick a song on the left. Its page has every lyric version beside every Suno take, with scores, album status, highlights and notes together.</p>
      <div class="stat-grid">
        <div class="stat"><b>${c.length}</b><span>songs</span></div>
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
  function inventoryRows() {
    const cat = L.catalog;
    if (ui.inv === "files" && cat) {
      const songOf = Object.fromEntries((cat.songs || []).flatMap(s => (s.file_ids || []).map(id => [id, s.id])));
      const keyOfCat = Object.fromEntries(M.songs.filter(s => s.cat).map(s => [s.cat.id, s.key]));
      return {head:["Path", "Song", "Type", "Writer", "Version", "Size", "Modified", "Archived"],
        rows:cat.files.map(f => ({key:keyOfCat[songOf[f.id]], file:f.id, cells:[f.path, M.bySong[keyOfCat[songOf[f.id]]]?.title || f.title, f.kind, f.writer, f.version, Math.round((f.size || 0) / 1024) + " KB", (f.modified || "").slice(0, 10), f.archived ? "yes" : ""]}))};
    }
    if (ui.inv === "playlists" && cat) return {head:["Playlist", "Tracks reported", "Owned", "Checked"],
      rows:(cat.playlists || []).map(p => ({url:p.url, cells:[p.name, p.song_count ?? "", p.owned ? "yes" : "not confirmed", (p.checked || "").slice(0, 16).replace("T", " ")]}))};
    if (["files", "playlists", "coverage"].includes(ui.inv) && !cat) return {head:["Loading"], rows:[]};
    if (ui.inv === "songs") return {head:["Song", "Where", "Song status", "Writers", "Lyric versions", "Board takes", "New on Suno", "Trashed", "Studio files", "Best score", "Latest"],
      rows:M.songs.filter(s => ui.prompts || !s.prompt).map(s => ({key:s.key, cells:[s.title, {both:"Studio and Suno", local:"Studio only", suno:"Suno only"}[s.location], SONG_STATUSES.find(([k]) => k === songStatus(s))[1], s.writers.join(", "), versionsOf(s).length, s.takeIds.length, s.newTakes, s.trashedTakes, s.cat?.files ?? "", bestScore(s) ?? "", (s.latest || "").slice(0, 10)]}))};
    const albumName = id => plan().albums?.[id]?.name.split(" ·")[0];
    const board = Object.values(M.takes).map(t => { const a = albumOf(t.stem); return {key:M.songOfTake[t.stem], stem:t.stem, cells:[t.title, M.bySong[M.songOfTake[t.stem]]?.title || t.baseTitle, t.type, t.writer, dur(t.duration), (t.createdAt || "").slice(0, 10), takeRating(t.stem).score ?? "", a ? albumName(a[0]) + " #" + (a[1].order.indexOf(t.stem) + 1) : "", gone(t.stem) ? "Deleted on Suno" : "On the board"]}; });
    const clips = M.songs.flatMap(s => s.clips.filter(c => !c.onBoard).map(c => ({key:s.key, stem:c.id, cells:[c.title, s.title, c.mode || "", c.writer, dur(c.duration), (c.created || "").slice(0, 10), "", "", c.trashed ? "Trashed on Suno" : "Newer on Suno"]})));
    return {head:["Suno take", "Song", "Type", "Writer", "Length", "Created", "Score", "On album", "Where"], rows:[...board, ...clips].sort((a, b) => String(b.cells[5]).localeCompare(String(a.cells[5])))};
  }
  function coverageHtml() {
    const cat = L.catalog; if (!cat) return `<p class="hint">${L.error ? esc(L.error) : "Loading the catalog…"}</p>`;
    const src = cat.coverage?.sources || {};
    return `<div class="coverage">${Object.entries(src).map(([name, obj]) => `<div class="panel"><b>${esc(name)}</b><dl>${Object.entries(obj).filter(([k]) => k !== "scan_errors").map(([k, v]) => `<dt>${esc(k.replaceAll("_", " "))}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl></div>`).join("")}</div>
      ${(cat.coverage?.issues || []).length ? `<h3 class="sub">Coverage notes</h3><ul class="sources">${cat.coverage.issues.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      ${(cat.coverage?.excluded || []).length ? `<h3 class="sub">Not scanned</h3><ul class="sources">${cat.coverage.excluded.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="hint">Catalog built ${esc((cat.built || "").slice(0, 16).replace("T", " "))} with ${esc(cat.sunox_version || "Sunox")}. Every Suno request is read-only.</p>`;
  }
  const invTabs = () => [["songs", "Songs"], ["takes", "Every Suno take"], ...(L.enabled ? [["files", "Studio files"], ["playlists", "Playlists"], ["coverage", "Coverage"]] : [])].map(([k, l]) => `<button class="chip" role="tab" aria-pressed="${ui.inv === k}" data-inv="${k}">${l}</button>`).join("") + (L.enabled ? '<button class="btn small" id="invRefresh" title="Re-scan the Studio and read Suno again (read-only)">Refresh inventory</button>' : "");
  function renderInventory() {
    if (!L.enabled && ["files", "playlists", "coverage"].includes(ui.inv)) ui.inv = "songs";
    if (ui.inv === "coverage") { $("page").innerHTML = `<div class="inventory"><h1>Inventory</h1><div class="tools"><div class="seg-tabs" role="tablist">${invTabs()}</div></div>${coverageHtml()}</div>`; return; }
    const {head, rows} = inventoryRows(), q = ui.invQ.trim().toLowerCase();
    const shown = q ? rows.filter(r => r.cells.join(" ").toLowerCase().includes(q)) : rows;
    $("page").innerHTML = `<div class="inventory">
      <h1>Inventory</h1>
      <div class="tools"><div class="seg-tabs" role="tablist">${invTabs()}</div>
        <input type="search" id="invQ" value="${esc(ui.invQ)}" placeholder="Filter rows" aria-label="Filter rows"><button class="btn small" id="invCsv">Export CSV</button></div>
      <p class="hint">${shown.length} of ${rows.length} rows.${LOCAL ? "" : " Studio files, playlists and coverage appear when the board is opened from the local catalog server."}</p>
      <div class="table-wrap"><table class="inv-table"><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${shown.slice(0, ui.invLimit).map(r => `<tr${r.url || r.file ? "" : ` data-song="${esc(r.key || "")}"`}${r.stem ? ` data-take="${esc(r.stem)}"` : ""}>${r.cells.map((c, i) => `<td>${i !== 0 ? esc(c) : r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(c)}</a>` : r.file ? `<a href="${esc(L.fileUrl(r.file))}" target="_blank" rel="noopener"><code>${esc(c)}</code></a>${r.key ? ` <button class="linkish" data-song="${esc(r.key)}">song</button>` : ""}` : `<button class="linkish">${esc(c)}</button>`}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${shown.length > ui.invLimit ? `<button class="btn small" id="invMore">Show ${Math.min(200, shown.length - ui.invLimit)} more</button>` : ""}
    </div>`;
  }

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
    const t = e.target.closest("[data-view],[data-song],[data-version],[data-song-back],[data-edit],[data-color],[data-color-names],[data-lyric-undo],[data-copy],[data-choose],[data-details],[data-consider],[data-lyric-status],[data-lyric-tag],[data-del-mark],[data-del-copy],[data-save-studio],[data-inv],#invCsv,#invMore,#studioRetry,#dataBtn,#dataClose,#lyricExport,#reviewExport,#studioExport,#lyricImport,#colorSave,#colorCancel");
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
    if (t.dataset.inv) { ui.inv = t.dataset.inv; ui.invLimit = 200; savePrefs(); return renderInventory(); }
    if (t.id === "invMore") { ui.invLimit += 200; return renderInventory(); }
    if (t.id === "invCsv") {
      const {head, rows} = inventoryRows(), q = ui.invQ.trim().toLowerCase(), shown = q ? rows.filter(r => r.cells.join(" ").toLowerCase().includes(q)) : rows;
      const text = "﻿" + [head, ...shown.map(r => r.cells)].map(r => r.map(csvCell).join(",")).join("\r\n");
      const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([text], {type:"text/csv"})); link.download = `studio-${ui.inv}.csv`; link.click(); URL.revokeObjectURL(link.href); return;
    }
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
      const val = {lyrics:textOf(v), title:v?.suno?.title || v?.title, style:v?.suno?.style, instrumental:v?.suno?.instrumental, exclude:v?.suno?.exclude, sunoLyrics:v?.suno?.lyrics ?? v?.lyrics,
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
    if (t.id === "invQ") { ui.invQ = t.value; ui.invLimit = 200; const pos = t.selectionStart; renderInventory(); const n = $("invQ"); n.focus(); n.setSelectionRange(pos, pos); return; }
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
    if (t.id === "fSort") { ui.sort = t.value; savePrefs(); return renderList(); }
    if (t.id === "fPrompts") { ui.prompts = t.checked; savePrefs(); return ui.view === "inventory" ? renderInventory() : renderList(); }
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
    else if (e.key === "Escape" && ui.view === "songs" && ui.song && !ui.editing && !document.querySelector(".menu:not(.hidden)")) go({song:null});
    else if (e.key === "[" || e.key === "]") {
      if (ui.view !== "songs") return;
      const rows = filteredSongs(), i = rows.findIndex(r => r.key === ui.song), next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "]" ? 1 : -1)))];
      if (next) { e.preventDefault(); go({song:next.key}); document.querySelector(`.song-row[data-song="${CSS.escape(next.key)}"]`)?.scrollIntoView({block:"nearest"}); }
    }
  });
  // The tracklist bar opens and closes on every screen size here (the planner only does that on phones).
  $("panelBar").addEventListener("click", () => document.body.classList.toggle("dock-open", $("trackPanel").classList.contains("open")));

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
