"use strict";
// Album Planner. Score and notes are Audio Board records (one score per take everywhere).
// Albums, the per-album status of every take (see planner-status.js), sessions, renames and the Delete tag are planner records.
// A host page (the Studio Board) registers the shared worker from its own folder.
if ("serviceWorker" in navigator && !window.PLANNER_HOST) navigator.serviceWorker.register("../../service-worker.js").catch(() => {});
const KEY = "grind.planner.v1";
// Optional host page (the Studio Board) that shows these views inside its own shell. Absent on the Audio Board page,
// where everything below behaves exactly as before.
const HOST = window.PLANNER_HOST || null;
const hostOwnsPage = () => !!HOST && !HOST.plannerVisible();   // the host is showing its own page (a song), not a planner view
const AUDIO_KEY = "grind.audio.v1";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone = v => JSON.parse(JSON.stringify(v));
const uid = prefix => prefix + "-" + crypto.randomUUID().slice(0, 8);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const TAKES = {};
// Suno labels some instrumentals "Vocal". A take with no sung words (empty, or only tags like [Instrumental]) is an instrumental.
const hasWords = text => /[\p{L}\p{N}]/u.test(String(text || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " "));
for (const s of window.ALBUM_SONGS || []) {
  const v = s.versions[0], lyrics = v.suno?.lyrics ?? v.lyrics;
  TAKES[s.slug] = {...v, type:(v.type || "Vocal") === "Vocal" && typeof lyrics === "string" && !hasWords(lyrics) ? "Instrumental" : v.type, stem:s.slug, title:s.title, baseTitle:s.baseTitle || s.title};
}
const DEFAULT_ALBUMS = {debut:{name:"Album 1 · Debut", created:1, order:[], cut:[], target:12, statusV:2}, second:{name:"Album 2", created:2, order:[], cut:[], target:12, statusV:2}};
const STATUS_LABEL = PlannerStatus.LABELS;

// ---------- planner state ----------
function loadPlan() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && typeof s === "object") return PlannerSync.prepare(s); } catch (err) {}
  return PlannerSync.prepare(PlannerSync.empty());
}
let state = loadPlan(), previous = clone(state), cloud = null;
let deviceId; try { deviceId = localStorage.getItem(KEY + ".device"); } catch (err) {}
if (!deviceId) { deviceId = crypto.randomUUID(); try { localStorage.setItem(KEY + ".device", deviceId); } catch (err) {} }
function persist() {
  try {
    if (state._sync.owner) localStorage.setItem(KEY + ".account." + state._sync.owner, JSON.stringify(state));
    localStorage.setItem(KEY, JSON.stringify(state));
    $("saveStatus").classList.remove("failed"); $("saveStatus").textContent = "Saved on this device. Export plan keeps a separate backup.";
  } catch (err) { $("saveStatus").classList.add("failed"); $("saveStatus").textContent = "Changes could not be saved. Export a backup before closing."; }
}
function normalize() {
  if (!Object.keys(state.albums).length) for (const [id, a] of Object.entries(DEFAULT_ALBUMS)) state.albums[id] = clone(a);
  for (const a of Object.values(state.albums)) { a.order ||= []; a.cut ||= []; }
}
function save(rerender = true) {
  normalize();
  state = PlannerSync.capture(previous, state, deviceId); previous = clone(state);
  persist(); if (cloud) cloud.changed(); if (rerender) render();
}

// ---------- Audio Board state (scores, notes, and the old global flags the migration reads) ----------
const blankAudio = s => ({ratings:{}, tracklist:[], pick:{}, custom:{}, collections:{}, v:2, ...(s || {})});
function readAudio(key) { try { const s = JSON.parse(localStorage.getItem(key)); if (s && typeof s === "object") return s; } catch (err) {} return null; }
let audio = AlbumSync.prepare(blankAudio(readAudio(AUDIO_KEY))), audioPrev = clone(audio), audioCloud = null;
function persistAudio() {
  // Same keys Audio Board uses, so its next load starts from these scores too.
  try {
    if (audio._sync.owner) localStorage.setItem(AUDIO_KEY + ".account." + audio._sync.owner, JSON.stringify(audio));
    localStorage.setItem(AUDIO_KEY, JSON.stringify(audio));
  } catch (err) { $("saveStatus").classList.add("failed"); $("saveStatus").textContent = "Scores could not be saved on this device. Export Audio Board scores before closing."; }
}
const rating = stem => audio.ratings[stem] || {};
function setRating(stem, patch) {
  const local=readAudio(AUDIO_KEY);
  if(local?._sync && local._sync.owner===audio._sync.owner) {
    audio=AlbumSync.project(audio,AlbumSync.merge(audio._sync.records,AlbumSync.prepare(local)._sync.records),audio._sync.owner);audioPrev=clone(audio);
  }
  audio.ratings[stem] = {...rating(stem), ...patch, at:Date.now()};
  audio = AlbumSync.capture(audioPrev, audio, deviceId); audioPrev = clone(audio);
  persistAudio(); if (audioCloud) audioCloud.changed();
}

// ---------- undo ----------
let undoSnap = null, undoStem = null;
function snapshot(stem = null) { const {_sync, ...plan} = state; undoSnap = clone(plan); undoStem = stem; }
function undo() {
  if (!undoSnap) { toast("Nothing to undo"); return; }
  const stem = undoStem;
  Object.assign(state, clone(undoSnap)); undoSnap = null;
  save(); toast("Restored");
  const el = stem && cardEl(stem);   // the restored take gets the ring back
  if (el) { focusStem = stem; el.focus({preventScroll:true}); el.scrollIntoView({block:"nearest"}); }
}

// ---------- view prefs ----------
let viewPrefs = {}; try { viewPrefs = JSON.parse(localStorage.getItem(KEY + ".view")) || {}; } catch (err) {}
const GROUP_BYS = [["none", "No grouping"], ["song", "Group by song"], ["album", "Group by album"], ["status", "Group by status"], ["writer", "Group by writer"]];
const VIEWS = ["sort","consider","sessions","albums","cleanup"];
const BUCKETS = ["unreviewed","maybe","short","on","cut","alive"];
const ui = {sortFilter:["todo","later","done"].includes(viewPrefs.sortFilter) ? viewPrefs.sortFilter : "todo", view:VIEWS.includes(viewPrefs.view) ? viewPrefs.view : "consider", q:"", sort:viewPrefs.sort || "title", dir:viewPrefs.dir || "",
  groupBy:GROUP_BYS.some(([k]) => k === viewPrefs.groupBy) ? viewPrefs.groupBy : viewPrefs.group === false ? "none" : "song",
  type:["Vocal", "Instrumental", "Stem", "all"].includes(viewPrefs.type) ? viewPrefs.type : "Vocal", only:null, song:"", lyricsOpen:new Set(), bucket:BUCKETS.includes(viewPrefs.bucket) ? viewPrefs.bucket : "unreviewed", unscored:viewPrefs.unscored === true,
  session:viewPrefs.session || "", album:viewPrefs.album || "debut", readiness:viewPrefs.readiness || "", ssort:viewPrefs.ssort || "score", sdir:viewPrefs.sdir || ""};
let restoringNavigation = false;
const navigation = () => ({view:ui.view, session:ui.session, album:ui.album});
function saveView() {
  try { localStorage.setItem(KEY + ".view", JSON.stringify({...ui, q:undefined, only:undefined, song:undefined, lyricsOpen:undefined})); } catch (err) {}
  if (HOST) { if (!restoringNavigation) HOST.navigated(navigation()); return; }
  if (!restoringNavigation && JSON.stringify(history.state?.plannerNavigation) !== JSON.stringify(navigation())) {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(navigation())) value ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    history.pushState({plannerNavigation:navigation()}, "", url);
  }
}
const route = new URLSearchParams(location.search);
if (VIEWS.includes(route.get("view"))) ui.view = route.get("view");
if (route.has("session")) ui.session = route.get("session");
if (route.has("album")) ui.album = route.get("album");
// Links from Lyric Board and Audio Board: ?take=<uuid>, ?lyrics=<lyric version>, ?q=<search>.
if (route.has("take")) ui.only = {take:route.get("take")};
else if (route.has("lyrics")) ui.only = {lyrics:route.get("lyrics")};
if (route.has("q")) ui.q = route.get("q").trim();
history.replaceState({...history.state, plannerNavigation:navigation()}, "");
window.addEventListener("popstate", e => {
  if (HOST || !e.state?.plannerNavigation) return;
  Object.assign(ui, e.state.plannerNavigation);
  restoringNavigation = true; saveView(); restoringNavigation = false; render();
});

// ---------- helpers ----------
const take = stem => TAKES[stem] || window.ALBUM_TRASHED_TAKES?.[stem] || {stem, title:"Suno " + stem.slice(0, 8), baseTitle:"Not in catalogue", missing:true, writer:"", duration:0, createdAt:""};
const item = stem => state.considered[stem] || {};
const available = stems => stems.filter(stem => !!TAKES[stem]);
// Keep saved records for unavailable takes; only the current catalog is rendered.
const visibleAlbum = a => ({...a, order:available(a.order), cut:available(a.cut)});
const live = () => available(Object.keys(state.considered)).filter(s => !item(s).delDone);   // deleted on Suno = gone from the plan
const album = () => state.albums[ui.album];
// One status per take per album: unreviewed, maybe, short, on, cut.
const statusOf = (stem, id = ui.album) => PlannerStatus.statusOf(state, audio.ratings, stem, id);
const isCut = (stem, id = ui.album) => statusOf(stem, id) === "cut";
const tagged = stem => !!item(stem).del && !item(stem).delDone;
const eligible = stem => !item(stem).delDone && !isCut(stem) && !tagged(stem);
const albumOf = stem => Object.entries(state.albums).find(([, a]) => a.order.includes(stem));
const catalog = () => Object.keys(TAKES).filter(s => !item(s).delDone);
const pool = () => ui.only ? [...new Set([...catalog(), ...live()])] : live();   // a link to one take can reach any catalogue take
const typeOk = s => ui.type === "all" || (take(s).type || "Vocal") === ui.type;
const ensure = stem => { if (!state.considered[stem]) state.considered[stem] = {added:Date.now()}; return state.considered[stem]; };
const lyricHtml = text => esc(text).replace(/^(\[[^\]\n]+\])/gm, '<span class="tag">$1</span>');
const voiceText = t => t.voiceName ? (t.type === "Vocal" && t.personalVoice ? "Your voice · " : t.type === "Vocal" ? "Voice persona · " : "Persona setting · ") + t.voiceName : "";
const sessionsOf = stem => Object.entries(state.sessions).filter(([, s]) => s.members.includes(stem));
const shortName = a => a.name.split(" ·")[0];
function nameOf(stem) { const i = item(stem); return i.name || take(stem).title; }
function nameHtml(stem) {
  const i = item(stem), t = take(stem);
  return i.name && i.name !== t.title && !i.renameDone ? `${esc(i.name)} <span class="old">[${esc(t.title)}]</span>` : esc(nameOf(stem));
}
// "Two People to Mourn.M1.2" is "M1.2" wherever space is tight.
function labelOf(stem) { const t = take(stem); return !item(stem).name && t.title.startsWith(t.baseTitle + ".") ? t.title.slice(t.baseTitle.length + 1) : nameOf(stem); }
const dur = s => { s = Math.round(s || 0); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const longDur = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + "h " : "") + m + "m " + String(s % 60).padStart(2, "0") + "s"; };
const lyricSearch = title => String(title || "").replace(/^[A-Z]-\s+/, "").replace(/(\s+(v\d+|\d+|misc|-\s*\w+))+$/i, "").trim();
const lyricHref = stem => { const t = take(stem); return t.lyricSlug && t.lyricStem ? `../../lyrics/?song=${encodeURIComponent(t.lyricSlug)}&version=${encodeURIComponent(t.lyricStem)}` : `../../lyrics/?q=${encodeURIComponent(lyricSearch(t.baseTitle))}`; };
const suno = stem => "https://suno.com/song/" + encodeURIComponent(stem);
// Desktop: every Play opens in one reused "player" tab, so the previous take stops when the next one loads.
// The tab is not opened "noopener" on purpose: a browser can only find a named tab it is still linked to.
// Phones keep the plain link (the Suno app or the browser handles it, and it streams there).
const desktopPlayer = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
function playOnSuno(stem) {
  const url = suno(stem);
  if (!desktopPlayer()) { window.open(url, "_blank", "noopener"); return; }
  const w = window.open("", "sunoPlayer");   // same name = same tab; a new blank tab the first time
  if (!w) { window.open(url, "_blank", "noopener"); return; }
  w.location.href = url; w.focus();
}
function boardHref(href) {
  const url = new URL(href, location.href);
  url.searchParams.set("returnTo", location.pathname + location.search);
  return url.pathname + url.search;
}
const scoreClass = n => n == null ? "" : n >= 80 ? "hi" : n >= 50 ? "mid" : "";
function takeLabel(t) { return [t.type && t.type !== "Vocal" ? t.type : "", t.writer && t.writer !== "Unknown" ? t.writer : "", t.packetVersion ? "lyrics v" + t.packetVersion : "", t.take ? "take " + t.take : "", t.duration ? dur(t.duration) : "", voiceText(t)].filter(Boolean).join(" · "); }
let toastTimer;
function toast(msg, withUndo = false) {
  $("toastText").textContent = msg; $("toastUndo").classList.toggle("hidden", !withUndo);
  $("toast").classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(() => $("toast").classList.remove("on"), withUndo ? 6000 : 1600);
}
async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch (err) { return false; } }

// Track target: amber when over, red when well over. "Well over" is more than a quarter of the target (at least 3 tracks).
function targetState(a) {
  const order = available(a.order), n = order.length, target = a.target || 12, over = Math.max(0, n - target);
  const level = !over ? "" : over > Math.max(2, Math.ceil(target * .25)) ? "bad" : "warn";
  const total = order.reduce((sum, s) => sum + (take(s).duration || 0), 0);
  return {n, target, over, level, total, text:`${n}/${target} tracks${over ? " · " + over + " over target" : ""}`};
}
// Songs that appear more than once on an album: baseTitle → stems.
function dupesOn(a) {
  const by = new Map();
  for (const s of available(a.order)) { const b = take(s).baseTitle; if (!by.has(b)) by.set(b, []); by.get(b).push(s); }
  return new Map([...by].filter(([, list]) => list.length > 1));
}

// ---------- migrating to one status per take per album ----------
// Back up first, then convert each album once. Safe to call again and across devices: an album that carries
// statusV is skipped, and a signed-in device waits until it has loaded its account before converting anything.
const MIGRATION_KEY = KEY + ".migration", BACKUP_KEY = KEY + ".premigration";
const needsMigration = () => Object.values(state.albums).some(a => !PlannerStatus.isMigrated(a));
function migrationLog() { try { const l = JSON.parse(localStorage.getItem(MIGRATION_KEY)); if (l && Array.isArray(l.runs)) return l; } catch (err) {} return {runs:[], seen:true}; }
function ensureMigrated(force = false) {
  normalize();
  if (!needsMigration()) return false;
  if (!force && state._sync.owner && !(sync.plan.synced && sync.audio.synced)) return false;
  try {
    if (!localStorage.getItem(BACKUP_KEY)) {
      const {_sync, ...plan} = state;
      localStorage.setItem(BACKUP_KEY, JSON.stringify({app:"album-planner-premigration", at:new Date().toISOString(), plan, audioFlags:Object.fromEntries(Object.entries(audio.ratings).filter(([, r]) => r?.status).map(([s, r]) => [s, r.status]))}));
    }
  } catch (err) {}
  const result = PlannerStatus.migrate(state, audio.ratings, s => !!TAKES[s], s => take(s).title);
  const log = migrationLog();
  log.runs.push({at:new Date().toISOString(), albums:result.albums.map(id => state.albums[id].name), conflicts:result.log, pulledIn:result.pulledIn.map(s => take(s).title)});
  log.seen = !result.log.length && !result.pulledIn.length;
  try { localStorage.setItem(MIGRATION_KEY, JSON.stringify(log)); } catch (err) {}
  save(false);
  return true;
}

// ---------- actions ----------
function consider(stems) {
  let added = 0;
  for (const stem of stems) if (!state.considered[stem]) { state.considered[stem] = {added:Date.now()}; added++; }
  if (added) save();
  return added;
}
function newAlbum() {
  const name = prompt("New album name", "Album " + (Object.keys(state.albums).length + 1));
  if (!name?.trim()) return null;
  const id = uid("a"); state.albums[id] = {name:name.trim(), created:Date.now(), order:[], cut:[], target:12, statusV:PlannerStatus.VERSION};
  return id;
}
// Change one take's status on one album. The card collapses out of the list if it no longer belongs there.
function setStatus(stem, status, id = ui.album) {
  ensureMigrated(true);
  if (!state.albums[id]) return;
  const now = statusOf(stem, id);
  if (status === "on") { if (now !== "on") placeTake(stem, id); return; }
  if (now === status) return;
  snapshot(stem);
  PlannerStatus.set(state, stem, id, status);
  save(false); toast(`${labelOf(stem)} → ${STATUS_LABEL[status]}`, true);
  settle(stem);
}
const toggleStatus = (stem, status) => setStatus(stem, statusOf(stem) === status ? "unreviewed" : status);
// Putting a take on an album: one take per song, so ask before adding a second take of the same song.
function placeTake(stem, id) {
  ensureMigrated(true);
  const a = state.albums[id]; if (!a || a.order.includes(stem)) return;
  const clash = a.order.filter(m => m !== stem && take(m).baseTitle === take(stem).baseTitle);
  if (clash.length) askReplace(stem, id, clash); else commitPlace(stem, id, []);
}
function commitPlace(stem, id, replaced) {
  const a = state.albums[id]; snapshot(stem);
  const index = replaced.length ? Math.min(...replaced.map(r => a.order.indexOf(r))) : -1;
  for (const r of replaced) PlannerStatus.set(state, r, id, "short");
  PlannerStatus.set(state, stem, id, "on", index);
  ensure(stem); delete state.considered[stem].later;
  save(false);
  toast(replaced.length ? `${labelOf(stem)} replaces ${replaced.map(labelOf).join(" and ")} on ${shortName(a)}` : `${labelOf(stem)} → ${shortName(a)} #${a.order.indexOf(stem) + 1}`, true);
  settle(stem); for (const r of replaced) settle(r);
}
let pendingPlace = null;
function askReplace(stem, id, clash) {
  const name = shortName(state.albums[id]);
  $("replaceTitle").textContent = `Replace ${clash.map(labelOf).join(" and ")} with ${labelOf(stem)} on ${name}?`;
  $("replaceText").textContent = `"${take(stem).baseTitle}" is already on ${name}. Replace puts ${labelOf(stem)} in the same spot and moves ${clash.length > 1 ? "the others" : labelOf(clash[0])} to Shortlist. Keep both leaves two takes of the song on the album, with a warning on each.`;
  pendingPlace = {stem, id, clash}; $("replaceDialog").showModal();
}
function toggleDelete(stem) {
  const i = ensure(stem); snapshot(stem);
  if (i.del) { delete i.del; save(false); toast("Delete tag removed", true); settle(stem); return; }
  i.del = true; for (const a of Object.values(state.albums)) a.order = a.order.filter(m => m !== stem);
  save(false); toast("Tagged to delete on Suno. It's on the Suno cleanup list.", true); settle(stem);
}
function rename(stem) {
  const i = ensure(stem), t = take(stem);
  const next = prompt(`Rename "${t.title}" in the planner.\nThe Suno title stays in brackets until you mark it renamed. Leave empty to undo.`, i.name || t.title);
  if (next == null) return;
  const v = next.trim();
  if (!v || v === t.title) { delete i.name; delete i.renameDone; } else { i.name = v; delete i.renameDone; }
  save();
}
function newSession(name, stems) {
  const id = uid("s");
  state.sessions[id] = {name, created:Date.now(), note:"", members:[...new Set(stems)]};
  for (const stem of stems) if (!state.considered[stem]) state.considered[stem] = {added:Date.now()};
  return id;
}

// ---------- the take card (Album picks, Triage and Sessions use the same one) ----------
function card(stem, opts = {}) {
  const t = take(stem), r = rating(stem), a = album(), st = statusOf(stem), placed = albumOf(stem), del = tagged(stem), name = nameOf(stem);
  const others = Object.entries(state.albums).filter(([id]) => id !== ui.album).sort(([, x], [, y]) => x.created - y.created);
  const twin = placed && dupesOn(placed[1]).has(t.baseTitle);
  const badges = [
    placed ? `<button class="badge link placed" data-goto-album="${esc(placed[0])}" title="Open this album">${esc(placed[1].name)} #${placed[1].order.indexOf(stem) + 1}</button>` : "",
    twin ? `<span class="badge warn" title="Two takes of this song are on ${esc(placed[1].name)}">⚠ same song twice</span>` : "",
    del ? `<span class="badge del">delete</span>` : "",
    ...(opts.inSession ? [] : sessionsOf(stem).map(([id, s]) => `<button class="badge link" data-goto-session="${esc(id)}">${esc(s.name)}</button>`)),
    t.missing ? `<span class="badge cut">not in snapshot</span>` : "",
  ].join("");
  const lyrics = (t.suno?.lyrics ?? t.lyrics) || "", open = ui.lyricsOpen.has(stem);
  const seg = (k, label) => `<button class="seg s-${k}" data-status="${k}" aria-pressed="${st === k}">${label}</button>`;
  return `<article class="card st-${st}${st === "cut" ? " is-cut" : ""}${del ? " is-del" : ""}${st === "on" ? " on-album" : ""}" data-stem="${esc(stem)}" tabindex="-1">
    <div class="card-top">
      <label class="score-box"><span>Score</span><input class="score-in ${scoreClass(r.score)}" type="number" min="0" max="100" step="1" inputmode="numeric" value="${r.score ?? ""}" placeholder="–" aria-label="Score for ${esc(name)}, 0 to 100"></label>
      <div class="t"><b title="${esc(t.title)}">${nameHtml(stem)}</b><small>${esc(takeLabel(t)) || "&nbsp;"}</small></div>
      <button class="icon-btn" data-act="rename" title="Rename in planner" aria-label="Rename ${esc(name)}">edit</button>
    </div>
    <div class="badges">${badges}</div>
    <label class="meta">Listening readiness <select class="take-readiness" aria-label="Listening readiness for ${esc(name)}">${ReviewTools.options(r.readiness)}</select></label>
    ${opts.sortMode ? `<div class="card-actions buckets" role="group" aria-label="Where does ${esc(name)} go?">
      ${Object.entries(state.albums).sort(([, x], [, y]) => x.created - y.created).map(([id, o]) => `<button class="btn small bucket${o.order.includes(stem) ? " primary" : ""}" data-bucket="${esc(id)}" aria-pressed="${o.order.includes(stem)}">${esc(shortName(o))}</button>`).join("")}
      <button class="btn small" data-bucket="__new" title="Start a new album with this take">+ Album</button>
      <button class="btn small bucket${item(stem).later ? " primary" : ""}" data-bucket="__later" aria-pressed="${!!item(stem).later}">Later</button>
    </div>` : ""}
    <div class="status-seg" role="group" aria-label="Status of ${esc(name)} for ${esc(shortName(a))}">
      ${seg("maybe", "Maybe")}${seg("short", "Shortlist")}${opts.sortMode ? "" : seg("on", (st === "on" ? "✓ On " : "+ ") + esc(shortName(a)))}<span class="seg-gap"></span>${seg("cut", "Cut")}
    </div>
    <div class="media-row">
      <a class="btn small" data-play href="${suno(stem)}" target="_blank" rel="noopener">▶ Suno</a>
      <button class="btn small" type="button" data-act="lyrics" aria-expanded="${open}">Lyrics ${open ? "▾" : "▸"}</button>
      <a class="btn small" href="${esc(HOST ? HOST.detailsHref(stem) : boardHref(`../classic.html?take=${encodeURIComponent(stem)}`))}" title="Full detail view: voice persona, source takes, Suno fields">Details</a>
      <button class="btn small danger" type="button" data-act="delete" aria-pressed="${del}" title="${del ? "Remove the delete tag" : "Tag this take to delete on Suno"}">${del ? "Undelete" : "Delete"}</button>
      <span class="more">
        <button class="icon-btn more-btn" type="button" data-act="menu" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for ${esc(name)}">⋯</button>
        <div class="menu hidden" role="menu">
          ${others.map(([id, o]) => `<button role="menuitem" data-menu="addto" data-album="${esc(id)}">Add to ${esc(o.name)}${o.order.includes(stem) ? " ✓" : ""}</button>`).join("")}
          <button role="menuitem" data-menu="addto" data-album="__new">Add to new album…</button>
          ${opts.inSession ? "" : `<button role="menuitem" data-menu="compare">Compare</button>`}
        </div>
      </span>
    </div>
    <div class="lyrics-body"${open ? "" : " hidden"}>
      <a class="btn small" href="${esc(HOST ? HOST.lyricHref(stem) : boardHref(lyricHref(stem)))}" title="${t.lyricStem ? "Open the matching lyric version" : "No exact lyric match; searches Lyric Board for this song"}">${t.lyricStem ? "Open in Lyric Board ↗" : "Find lyrics ↗"}</a>
      ${lyrics ? `<pre class="lyrics">${lyricHtml(lyrics)}</pre>` : `<p class="meta">Suno has no lyrics saved for this take.</p>`}
    </div>
    <textarea class="note" rows="1" placeholder="Notes" aria-label="Notes for ${esc(name)}">${esc(r.note || "")}</textarea>
  </article>`;
}

// ---------- render ----------
let pendingRender = false, focusStem = null;
const editing = () => document.activeElement?.matches?.(".score-in, .note, #sessionNote, .title-edit, #albumTarget, select, summary");
// Replace a dropdown's options only when they actually change.
function setOptions(el, html) { if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } }
function requestRender() { if (editing()) pendingRender = true; else render(); }
document.addEventListener("focusout", () => setTimeout(() => { if (pendingRender && !editing()) { pendingRender = false; render(); } }, 150));
const cardEl = stem => (hostOwnsPage() ? HOST.cardRoot() : document).querySelector(`.card[data-stem="${CSS.escape(stem)}"]`);
function render() {
  normalize();
  if (!state.albums[ui.album]) ui.album = Object.entries(state.albums).sort(([, a], [, b]) => a.created - b.created)[0][0];
  const views = {sort:"Sort", consider:"Consider", sessions:"Sessions", albums:"Albums", cleanup:"Cleanup"};
  for (const [v, n] of Object.entries(views)) { $("view" + n).classList.toggle("hidden", ui.view !== v); $("tab" + n).setAttribute("aria-selected", ui.view === v); }
  renderTarget(); renderSummary(); renderPanel(); renderNotice();
  ({sort:renderSort, consider:renderConsider, sessions:renderSessions, albums:renderAlbums, cleanup:renderCleanup})[ui.view]();
  document.querySelectorAll("textarea.note").forEach(fit);
  if (focusStem && (!document.activeElement || document.activeElement === document.body)) cardEl(focusStem)?.focus({preventScroll:true});
  HOST?.rendered?.();
}
function renderTarget() {
  const albums = Object.entries(state.albums).sort(([, a], [, b]) => a.created - b.created), a = album(), ts = targetState(a);
  setOptions($("targetAlbum"), albums.map(([id, x]) => `<option value="${esc(id)}">${esc(x.name)}</option>`).join("") + `<option value="__new">+ New album…</option>`);
  $("targetAlbum").value = ui.album;
  $("targetStats").innerHTML = `<span class="tstat ${ts.level}">${esc(ts.text)}</span> · ${longDur(ts.total)} · ${live().filter(s => isCut(s)).length} cut`;
}
function renderSummary() {
  const stems = ui.view === "sort" ? catalog() : live(), a = album();
  const counts = Object.fromEntries(PlannerStatus.STATUSES.map(k => [k, 0]));
  for (const s of stems) if (!tagged(s)) counts[statusOf(s)]++;
  const cleanup = stems.filter(tagged).length + stems.filter(s => item(s).name && !item(s).renameDone).length;
  $("summary").textContent = `${counts.unreviewed} unreviewed for ${a.name} · ${counts.on} on the album · ${counts.cut} cut · ${stems.filter(tagged).length} marked for deletion`;
  $("countConsider").textContent = `(${live().filter(s => !tagged(s) && statusOf(s) === "unreviewed").length})`;
  $("countSort").textContent = `(${sortBuckets().todo.length})`;
  $("countSessions").textContent = Object.keys(state.sessions).length ? `(${Object.keys(state.sessions).length})` : "";
  $("countAlbums").textContent = `(${available(a.order).length})`;
  $("countCleanup").textContent = cleanup ? `(${cleanup})` : "";
  $("built").textContent = window.ALBUM_BUILT ? "Suno snapshot " + window.ALBUM_BUILT : "";
}
// Everything that shows counts or the tracklist, without touching the list of cards.
function renderChrome() {
  renderTarget(); renderSummary(); renderPanel();
  if (ui.view === "consider") renderBucketTabs();
  if (ui.view === "sort") renderSortChrome();
}

// ---------- sticky tracklist panel ----------
const PANEL_VIEWS = ["sort", "consider", "sessions"];
function renderPanel() {
  const show = HOST ? HOST.panelVisible(ui.view) : PANEL_VIEWS.includes(ui.view), panel = $("trackPanel");
  panel.classList.toggle("hidden", !show); document.body.classList.toggle("has-panel", show);
  if (!show) return;
  const a = visibleAlbum(album()), ts = targetState(a), twins = dupesOn(a);
  $("panelBar").innerHTML = `<b>${esc(shortName(a))}</b><span class="tstat ${ts.level}">${ts.n}/${ts.target}${ts.over ? " · " + ts.over + " over" : ""}</span><span class="ptotal">${longDur(ts.total)}</span><span class="chev" aria-hidden="true">▴</span>`;
  $("panelBody").innerHTML = `<p class="tstat-line ${ts.level}">${esc(ts.text)}${ts.level ? "" : ""}</p>
    <ol class="ptracks">${a.order.length ? a.order.map((stem, i) => {
      const t = take(stem), twin = twins.has(t.baseTitle);
      return `<li class="ptrack${twin ? " twin" : ""}" draggable="true" data-stem="${esc(stem)}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="n">${i + 1}</span>
        <span class="pt"><b>${nameHtml(stem)}</b>${twin ? `<small class="warn">⚠ same song as another track</small>` : ""}</span><span class="pd">${dur(t.duration)}</span>
        <span class="pc"><button class="icon-btn" data-move="-1" aria-label="Move ${esc(labelOf(stem))} up">↑</button><button class="icon-btn" data-move="1" aria-label="Move ${esc(labelOf(stem))} down">↓</button></span></li>`;
    }).join("") : `<li class="empty-note">No tracks yet. Press <kbd>A</kbd> on a take to add it.</li>`}</ol>
    <p class="ptotal-line"><span>Running total</span><b>${longDur(ts.total)}</b></p>`;
}

// Shared by Album picks and Sessions. Each sort has a natural direction; the toggle flips it.
const SORTS = {title:["Title","asc"], score:["Rating","desc"], newest:["Date","desc"], status:["Status","asc"], length:["Length","desc"], writer:["Writer","asc"]};
// Status order for the album you're building: On album, Shortlist, Maybe, Unreviewed, Cut.
const statusRank = s => ({on:0, short:1, maybe:2, unreviewed:3, cut:4}[statusOf(s)]);
const SORT_KEYS = {title:null, score:s => rating(s).score ?? null, newest:s => take(s).createdAt || null, status:statusRank, length:s => take(s).duration || null, writer:s => take(s).writer && take(s).writer !== "Unknown" ? take(s).writer : null};
const dirOf = (sort, dir) => dir || SORTS[sort]?.[1] || "asc";
const sortDir = () => dirOf(ui.sort, ui.dir);
function sortStems(stems, sort = ui.sort, dir = sortDir()) {
  const down = dir === "desc", tie = (a, b) => nameOf(a).localeCompare(nameOf(b), undefined, {numeric:true});
  const key = SORT_KEYS[sort];
  return stems.slice().sort((a, b) => {
    if (!key) return down ? tie(b, a) : tie(a, b);
    const x = key(a), y = key(b);
    if (x == null || y == null) return (x == null) - (y == null) || tie(a, b); // missing values stay last
    const c = typeof x === "string" ? x.localeCompare(y) : x - y;
    return (down ? -c : c) || tie(a, b);
  });
}
const sortOptions = cur => Object.entries(SORTS).map(([k, [l]]) => `<option value="${k}"${cur && k === cur ? " selected" : ""}>Sort: ${l.toLowerCase()}</option>`).join("");
const dirLabel = dir => dir === "desc" ? "↓ Desc" : "↑ Asc";
// One dropdown for both Triage and Album picks: pick a song to see only its versions.
function songOptions() {
  const counts = new Map();
  for (const s of (ui.view === "sort" ? catalog() : pool()).filter(typeOk)) { const b = take(s).baseTitle; counts.set(b, (counts.get(b) || 0) + 1); }
  if (ui.song && !counts.has(ui.song)) counts.set(ui.song, 0);
  const html = `<option value="">All songs</option>` + [...counts].sort(([a], [b]) => a.localeCompare(b, undefined, {numeric:true})).map(([b, n]) => `<option value="${esc(b)}">${esc(b)} (${n})</option>`).join("");
  for (const id of ["songFilter", "sortSong"]) { setOptions($(id), html); $(id).value = ui.song; }
}
function matchesQuery(stem) {
  if (ui.readiness && (rating(stem).readiness || 'unassessed') !== ui.readiness) return false;
  if (ui.song && take(stem).baseTitle !== ui.song) return false;
  if (!ui.q) return true;
  const t = take(stem), q = ui.q.toLowerCase();
  return [nameOf(stem), t.title, t.baseTitle, t.writer, t.lyrics, t.oldTitle, rating(stem).note].some(x => String(x || "").toLowerCase().includes(q));
}

// ---------- Triage: one decision per take (album bucket or save for later) ----------
const decided = s => !!albumOf(s);
function sortBuckets() {
  const base = catalog().filter(s => typeOk(s) && !tagged(s) && !isCut(s));
  return {
    todo: base.filter(s => !decided(s) && !item(s).later),
    later: base.filter(s => !decided(s) && item(s).later),
    done: base.filter(decided),
  };
}
function bucket(stem, kind) {
  ensureMigrated(true);
  const i = ensure(stem);
  if (kind === "__later") {
    snapshot(stem);
    if (i.later) { delete i.later; save(false); toast("Back in To sort", true); }
    else { i.later = true; for (const a of Object.values(state.albums)) a.order = a.order.filter(m => m !== stem); save(false); toast("Saved for later", true); }
    settle(stem); return;
  }
  let id = kind;
  if (id === "__new") { id = newAlbum(); if (!id) return; }
  const target = state.albums[id]; if (!target) return;
  if (target.order.includes(stem)) { snapshot(stem); target.order = target.order.filter(m => m !== stem); save(false); toast("Taken off " + target.name + ". Back in To sort.", true); settle(stem); return; }
  placeTake(stem, id);
}
function renderSortChrome() {
  const b = sortBuckets();
  $("sortChips").innerHTML = [["todo", "To sort"], ["later", "Saved for later"], ["done", "On an album"]].map(([k, l]) => `<button class="chip" data-sf="${k}" aria-pressed="${ui.sortFilter === k}">${l} <small>${b[k].length}</small></button>`).join("");
  const albums = Object.values(state.albums).sort((x, y) => x.created - y.created);
  $("sortStats").textContent = albums.map(o => `${shortName(o)}: ${o.order.length}`).join(" · ") + ` · ${Object.keys(state.considered).filter(tagged).length} tagged delete`;
}
function renderSort() {
  songOptions();
  const b = sortBuckets();
  $("sortQ").value = ui.q;
  setOptions($("sortSort"), sortOptions()); $("sortSort").value = ui.sort;
  $("sortSortDir").textContent = dirLabel(sortDir());
  setOptions($("sortType"), [["Vocal", "Vocals"], ["Instrumental", "Instrumentals"], ["Stem", "Stems"], ["all", "All types"]].map(([k, l]) => `<option value="${k}">${l}</option>`).join("")); $("sortType").value = ui.type;
  renderSortChrome();
  renderSummary();
  const stems = sortStems(b[ui.sortFilter].filter(matchesQuery));
  const empty = {todo:"Nothing left to sort here. Switch the type filter, or check Saved for later.", later:"Nothing saved for later.", done:"Nothing on an album yet."}[ui.sortFilter];
  $("sortList").innerHTML = stems.length ? `<div class="cards single">${stems.map(s => card(s, {sortMode:true})).join("")}</div>` : `<p class="empty-note big">${stems.length || b[ui.sortFilter].length ? "No takes match the search." : empty}</p>`;
  document.querySelectorAll("textarea.note").forEach(fit);
}

// ---------- Album picks: one bucket per status ----------
const eligibleBase = s => !item(s).delDone && !tagged(s);
const bucketPool = () => pool().filter(s => typeOk(s) && eligibleBase(s));
const inBucket = s => (ui.bucket === "alive" ? statusOf(s) !== "cut" : statusOf(s) === ui.bucket) && (!ui.unscored || rating(s).score == null);
function renderBucketTabs() {
  const base = bucketPool(), counts = Object.fromEntries(PlannerStatus.STATUSES.map(k => [k, 0]));
  for (const s of base) counts[statusOf(s)]++;
  const tab = (k, label, n) => `<button class="bucket-tab s-${k}" role="tab" data-bucket-tab="${k}" aria-selected="${ui.bucket === k}">${label} <small>${n}</small></button>`;
  $("bucketTabs").innerHTML = ["unreviewed", "maybe", "short", "on", "cut"].map(k => tab(k, STATUS_LABEL[k], counts[k])).join("")
    + `<span class="bucket-total" title="The five counts add up to this">= ${base.length}</span><span class="bucket-sep"></span>`
    + tab("alive", "All alive", base.length - counts.cut);
}
// The status of a song across its group: which take, if any, is on the album.
function songNote(base) {
  const onIt = album().order.filter(s => take(s).baseTitle === base);
  return !onIt.length ? "" : onIt.length === 1 ? ` · on album via ${esc(labelOf(onIt[0]))}` : ` · <span class="warn">⚠ ${onIt.length} takes on album</span>`;
}
function groupHead(name, list) {
  const bySong = ui.groupBy === "song", inOne = bySong && list.length > 1 && Object.entries(state.sessions).find(([, s]) => list.every(m => s.members.includes(m)));
  return `<h3>${esc(name)} <small>${list.length} take${list.length > 1 ? "s" : ""}${bySong ? songNote(name) : ""}</small></h3>${!bySong ? "" : list.length > 1 && !inOne ? `<button class="btn small" data-compare-group="${esc(name)}">Compare all ${list.length}</button>` : inOne ? `<button class="btn small" data-goto-session="${esc(inOne[0])}">Open session</button>` : ""}`;
}
function refreshHeaders() {
  document.querySelectorAll("#considerList .group").forEach(sec => sec.querySelector("header").innerHTML = groupHead(sec.dataset.group, [...sec.querySelectorAll(".card:not(.leaving)")].map(c => c.dataset.stem)));
}
function renderConsider() {
  songOptions();
  setOptions($("sort"), sortOptions()); $("sort").value = ui.sort;
  $("sortDir").textContent = dirLabel(sortDir()); $("sortDir").setAttribute("aria-label", "Sort direction " + (sortDir() === "desc" ? "descending" : "ascending"));
  setOptions($("groupBy"), GROUP_BYS.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")); $("groupBy").value = ui.groupBy;
  setOptions($("typeFilter"), [["Vocal", "Vocals"], ["Instrumental", "Instrumentals"], ["Stem", "Stems"], ["all", "All types"]].map(([k, l]) => `<option value="${k}">${l}</option>`).join("")); $("typeFilter").value = ui.type;
  $("unscoredChip").setAttribute("aria-pressed", ui.unscored);
  $("q").value = ui.q;
  $("onlyBanner").classList.toggle("hidden", !ui.only);
  if (ui.only) $("onlyText").textContent = ui.only.take ? "Showing one take." : "Showing the takes for one lyric version.";
  renderBucketTabs();
  const onlyOk = s => !ui.only || (ui.only.take ? s === ui.only.take : take(s).lyricStem === ui.only.lyrics);
  const stems = sortStems(pool().filter(s => (ui.only || (typeOk(s) && eligibleBase(s))) && onlyOk(s) && (ui.only || inBucket(s)) && matchesQuery(s)));
  const box = $("considerList");
  if (!pool().length) { box.innerHTML = `<div class="empty-note big"><b>Nothing here yet.</b><br>Use <b>+ Add takes</b> to pull in the Audio Board session holding your album candidates, paste Suno links, or search the catalogue. Or start in <b>Triage</b>.</div>`; return; }
  if (!stems.length) { box.innerHTML = `<p class="empty-note">${ui.q || ui.song || ui.unscored ? "No takes match." : ui.bucket === "unreviewed" ? "Inbox empty. Nothing left unreviewed for " + esc(album().name) + "." : "Nothing here."}</p>`; return; }
  if (ui.groupBy === "none") { box.innerHTML = `<div class="cards single">${stems.map(s => card(s)).join("")}</div>`; return; }
  const groups = new Map();
  const keyOf = s => ui.groupBy === "album" ? (albumOf(s)?.[1].name || "Not on an album") : ui.groupBy === "status" ? STATUS_LABEL[statusOf(s)] : ui.groupBy === "writer" ? (take(s).writer && take(s).writer !== "Unknown" ? take(s).writer : "Unknown writer") : take(s).baseTitle;
  for (const s of stems) { const g = keyOf(s); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
  box.innerHTML = [...groups].map(([name, list]) => `<section class="group" data-group="${esc(name)}"><header>${groupHead(name, list)}</header><div class="cards single">${list.map(s => card(s)).join("")}</div></section>`).join("");
}

// ---------- a status change moves the card out of the way instead of redrawing the list ----------
function belongsHere(stem) {
  if (ui.view === "consider") return !!ui.only || (eligibleBase(stem) && typeOk(stem) && inBucket(stem));
  if (ui.view === "sort") return sortBuckets()[ui.sortFilter].includes(stem) && matchesQuery(stem);
  return true;
}
function settle(stem) {
  renderChrome();
  const box = hostOwnsPage() ? null : ui.view === "consider" ? $("considerList") : ui.view === "sort" ? $("sortList") : null;
  const el = box && [...box.querySelectorAll(".card")].find(c => c.dataset.stem === stem);
  if (!el) { render(); return; }
  if (belongsHere(stem)) {
    const hadFocus = el.contains(document.activeElement) || document.activeElement === el;
    const tmp = document.createElement("div"); tmp.innerHTML = card(stem, {sortMode:ui.view === "sort"});
    el.replaceWith(tmp.firstElementChild);
    const fresh = cardEl(stem); fit(fresh.querySelector("textarea.note"));
    if (hadFocus) { fresh.focus({preventScroll:true}); focusStem = stem; }
    if (ui.view === "consider") refreshHeaders();
    return;
  }
  collapseCard(el, box);
}
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
function collapseCard(el, box) {
  const cards = [...box.querySelectorAll(".card:not(.leaving)")], i = cards.indexOf(el), next = cards[i + 1] || cards[i - 1] || null;
  if (next) { focusStem = next.dataset.stem; next.focus({preventScroll:true}); next.scrollIntoView({block:"nearest", behavior:reducedMotion() ? "auto" : "smooth"}); }
  else { focusStem = null; document.activeElement?.blur?.(); }
  const done = () => {
    const sec = el.closest(".group"); el.remove(); if (sec && !sec.querySelector(".card")) sec.remove();
    if (ui.view === "consider") refreshHeaders();
    if (!box.querySelector(".card")) { if (ui.view === "consider") renderConsider(); else renderSort(); }
  };
  if (reducedMotion()) { done(); return; }
  el.style.height = el.offsetHeight + "px"; el.getBoundingClientRect();
  el.classList.add("leaving"); el.setAttribute("aria-hidden", "true"); el.style.height = "0px";
  setTimeout(done, 280);
}

function sessionStats(s) {
  const members = available(s.members).filter(m => !item(m).delDone), a = album();
  return {members, on:members.filter(m => a.order.includes(m)).length, cut:members.filter(m => isCut(m)).length, excluded:members.filter(m => !eligible(m)).length, open:members.filter(m => eligible(m) && !a.order.includes(m)).length};
}
function renderSessions() {
  const a = album();
  const entries = Object.entries(state.sessions).map(([id, s]) => [id, s, sessionStats(s)])
    .sort(([, x, sx], [, y, sy]) => (!!sx.on - !!sy.on) || x.name.localeCompare(y.name));
  if (ui.session && !state.sessions[ui.session]) ui.session = "";
  $("sessionList").innerHTML = (entries.length ? entries.map(([id, s, st]) => `<button class="session-row${ui.session === id ? " active" : ""}${st.on ? " decided" : ""}" data-session="${esc(id)}"><b>${esc(s.name)}</b><small>${st.members.length} takes${st.on ? ` · ${st.on} on ${esc(shortName(a))}` : ""}${st.cut ? ` · ${st.cut} cut` : ""}${st.open && !st.on ? ` · ${st.open} open` : ""}</small></button>`).join("")
    : `<p class="empty-note">No sessions yet. Hit <b>Compare</b> in a take's ⋯ menu, or <b>Auto-build sessions</b> on Album picks.</p>`) + `<button class="btn small" id="newEmptySession">+ New session</button>`;
  const d = $("sessionDetail"), s = state.sessions[ui.session];
  if (!s) { d.className = "detail empty"; d.innerHTML = "Pick a session to compare its takes."; return; }
  const st = sessionStats(s);
  // Excluded takes remain reviewable, but never occupy the active comparison list.
  const sdir = dirOf(ui.ssort, ui.sdir), sorted = sortStems(st.members, ui.ssort, sdir);
  const order = ui.showExcluded ? [...sorted.filter(eligible), ...sorted.filter(m => !eligible(m))] : sorted.filter(eligible);
  d.className = "detail";
  d.innerHTML = `<button class="btn small detail-back" data-back>← Sessions</button>
    <div class="field-head"><input class="title-edit" id="sessionName" value="${esc(s.name)}" aria-label="Session name"><button class="btn small danger" id="deleteSession">Delete session</button></div>
    <p class="meta">${st.members.length} takes for <b>${esc(a.name)}</b> · ${st.on} on it · ${st.cut} cut · ${st.open} still open.</p>
    <div class="tools session-sort"><select id="sessionSort" aria-label="Sort takes in this session">${sortOptions(ui.ssort)}</select><button class="btn small" id="sessionSortDir" aria-label="Sort direction ${sdir === "desc" ? "descending" : "ascending"}">${dirLabel(sdir)}</button><label class="inline"><input type="checkbox" id="showExcluded" ${ui.showExcluded ? "checked" : ""}> Show cut / delete (${st.excluded})</label></div>
    <div class="compare-grid">${order.map(m => card(m, {inSession:true})).join("") || `<p class="empty-note">No takes in this session.</p>`}</div>
    <label class="sub" for="sessionNote">Session notes</label>
    <textarea id="sessionNote" placeholder="Which verse hits harder, what to fix…">${esc(s.note || "")}</textarea>
    <div class="scope-tools"><button class="btn small" id="sessionAddMore">+ Add takes from Album picks</button></div>
    <div id="sessionAdder" class="session-options hidden"></div>`;
}

function renderAlbums() {
  const albums = Object.entries(state.albums).map(([id, a]) => [id, visibleAlbum(a)]).sort(([, a], [, b]) => a.created - b.created), a = visibleAlbum(album()), ts = targetState(a), twins = dupesOn(a);
  $("albumHead").innerHTML = `<div class="field-head"><input class="title-edit" id="albumName" value="${esc(a.name)}" aria-label="Album name">
      <span class="tools-inline"><label class="meta">Target <input type="number" id="albumTarget" min="1" max="40" value="${a.target || 12}"> tracks</label>
      <button class="btn small" id="copyAlbum">Copy tracklist</button>${albums.length > 1 ? `<button class="btn small danger" id="deleteAlbum">Delete album</button>` : ""}</span></div>
    <div class="runtime"><b>${a.order.length}</b> / ${ts.target} tracks${ts.over ? ` · <span class="tstat ${ts.level}">${ts.over} over target</span>` : ""} · <b>${longDur(ts.total)}</b> runtime<div class="bar ${ts.level}"><span style="width:${Math.min(100, a.order.length / ts.target * 100)}%"></span></div></div>`;
  const others = albums.filter(([id]) => id !== ui.album);
  $("albumTracks").innerHTML = a.order.length ? a.order.map((stem, i) => {
    const t = take(stem), r = rating(stem), twin = twins.has(t.baseTitle);
    return `<li class="track${twin ? " twin" : ""}" draggable="true" data-stem="${esc(stem)}"><span class="grip" aria-hidden="true">⋮⋮</span><span class="n">${i + 1}</span>
      <input class="score-in ${scoreClass(r.score)}" type="number" min="0" max="100" inputmode="numeric" value="${r.score ?? ""}" placeholder="–" aria-label="Score">
      <div class="t"><b>${nameHtml(stem)}</b>${twin ? ` <span class="badge warn">⚠ same song twice</span>` : ""}<small>${esc(takeLabel(t))}${r.note ? " · " + esc(r.note.slice(0, 80)) : ""}</small></div>
      <div class="ctl"><a class="btn small" data-play href="${suno(stem)}" target="_blank" rel="noopener" aria-label="Play on Suno">▶</a><button class="btn small" data-move="-1" aria-label="Move up">↑</button><button class="btn small" data-move="1" aria-label="Move down">↓</button>
      ${others.length ? `<select class="add-to" aria-label="Move to another album"><option value="">Move to…</option>${others.map(([id, o]) => `<option value="${esc(id)}">${esc(o.name)}</option>`).join("")}</select>` : ""}
      <button class="btn small" data-unplace aria-label="Take off this album">✕</button></div></li>`;
  }).join("") : `<li class="empty-note">No tracks yet. Use <b>+ ${esc(shortName(a))}</b> on any take, or place from below.</li>`;
  const pool = live().filter(s => ["short", "maybe"].includes(statusOf(s)) && !albumOf(s) && eligible(s))
    .sort((x, y) => (statusOf(x) === "short" ? 0 : 1) - (statusOf(y) === "short" ? 0 : 1) || (rating(y).score ?? -1) - (rating(x).score ?? -1));
  $("pool").innerHTML = pool.length ? `<div class="pool">${pool.map(stem => {
    const t = take(stem), r = rating(stem);
    return `<div class="pool-row" data-stem="${esc(stem)}"><span class="score ${scoreClass(r.score)}">${r.score ?? "–"}</span><div class="t"><b>${nameHtml(stem)}</b><small>${STATUS_LABEL[statusOf(stem)]} · ${esc(takeLabel(t))}</small></div><button class="btn small primary" data-place="${esc(ui.album)}">+ ${esc(shortName(a))}</button></div>`;
  }).join("")}</div>` : `<p class="empty-note">Nothing waiting. Mark takes Shortlist or Maybe to see them here.</p>`;
  renderMissing(a, albums);
}
function renderMissing(a, albums) {
  const items = [], ts = targetState(a), target = ts.target, total = ts.total;
  if (a.order.length < target) items.push(["warn", `${target - a.order.length} more track${target - a.order.length > 1 ? "s" : ""} to reach ${target}.`]);
  if (ts.over) items.push([ts.level === "bad" ? "bad" : "warn", `${ts.over} over target (${a.order.length}/${target} tracks).`]);
  if (a.order.length && total < 35 * 60) items.push(["info", `Runtime ${longDur(total)}. Most full-length rap albums land between 40 and 60 minutes.`]);
  if (total > 70 * 60) items.push(["warn", `Runtime ${longDur(total)} runs long. Consider moving tracks to another album.`]);
  for (const [b, list] of dupesOn(a)) items.push(["bad", `"${b}" is on here ${list.length} times: ${list.map(labelOf).join(", ")}.`]);
  const unscored = a.order.filter(s => rating(s).score == null);
  if (unscored.length) items.push(["info", `No score yet: ${unscored.map(nameOf).join(", ")}.`]);
  const nonVocal = a.order.filter(s => take(s).type && take(s).type !== "Vocal");
  if (nonVocal.length) items.push(["warn", `Not a vocal take: ${nonVocal.map(s => nameOf(s) + " (" + take(s).type + ")").join(", ")}.`]);
  const open = Object.entries(state.sessions).map(([id, s]) => [id, s, sessionStats(s)]).filter(([, , st]) => !st.on && st.open);
  const short = live().filter(s => statusOf(s) === "short" && !albumOf(s) && eligible(s));
  const unscoredAll = live().filter(s => rating(s).score == null && eligible(s));
  const where = new Map(); for (const [id, al] of albums) for (const s of al.order) { const b = take(s).baseTitle; if (!where.has(b)) where.set(b, new Set()); where.get(b).add(id); }
  const split = [...where].filter(([, ids]) => ids.size > 1).map(([b]) => b);
  const writers = {}; for (const s of a.order) { const w = take(s).writer || "Unknown"; writers[w] = (writers[w] || 0) + 1; }
  $("missing").innerHTML = `<h3>What's missing</h3>
    <ul class="checks">${items.length ? items.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join("") : `<li class="ok">Track count, runtime and scores look complete.</li>`}</ul>
    <h3>Still to decide</h3>
    <ul class="checks">
      <li class="${open.length ? "warn" : "ok"}">${open.length ? `${open.length} session${open.length > 1 ? "s have" : " has"} nothing on ${esc(shortName(a))} and nothing ruled out yet: ${open.map(([id, s]) => `<button class="linkish" data-goto-session="${esc(id)}">${esc(s.name)}</button>`).join(", ")}` : "Every session is either on the album or cut."}</li>
      <li class="${short.length ? "warn" : "ok"}">${short.length ? `${short.length} Shortlist take${short.length > 1 ? "s" : ""} not on any album.` : "Every Shortlist take is placed."}</li>
      <li class="${unscoredAll.length ? "info" : "ok"}">${unscoredAll.length ? `${unscoredAll.length} contender${unscoredAll.length > 1 ? "s" : ""} not scored yet.` : "Every contender is scored."}</li>
      ${split.length ? `<li class="bad">Same song on more than one album: ${esc(split.join(", "))}.</li>` : ""}
    </ul>
    ${a.order.length ? `<h3>Writer mix</h3><p class="meta">${Object.entries(writers).map(([w, n]) => `${esc(w)} ${n}`).join(" · ")}</p>` : ""}`;
}

function renderCleanup() {
  const all = available(Object.keys(state.considered));
  const dels = all.filter(s => item(s).del).sort((a, b) => !!item(a).delDone - !!item(b).delDone || nameOf(a).localeCompare(nameOf(b)));
  const renames = all.filter(s => item(s).name).sort((a, b) => !!item(a).renameDone - !!item(b).renameDone || take(a).title.localeCompare(take(b).title));
  const delTodo = dels.filter(s => !item(s).delDone), renTodo = renames.filter(s => !item(s).renameDone);
  $("cleanup").innerHTML = `<div class="cleanup-grid">
    <section><div class="field-head"><h3>Delete on Suno <small>${delTodo.length} to do</small></h3>${delTodo.length ? `<button class="btn small" id="copyDeletes">Copy links</button>` : ""}</div>
      <p class="meta">Tick a take once it's deleted on Suno. Ticked takes leave the planner; untick to bring one back. <b>Keep</b> removes the delete tag so the take comes back to Album picks.</p>
      ${dels.length ? dels.map(s => `<label class="clean-row${item(s).delDone ? " done" : ""}" data-stem="${esc(s)}"><input type="checkbox" data-del-done ${item(s).delDone ? "checked" : ""}><span class="t"><b>${esc(take(s).title)}</b><small>${esc(takeLabel(take(s)))}</small></span>${item(s).delDone ? "" : `<button class="btn small" type="button" data-untag>Keep</button>`}<a class="btn small" href="${suno(s)}" target="_blank" rel="noopener">Open on Suno</a></label>`).join("") : `<p class="empty-note">Nothing tagged. Use <b>Delete</b> in a take's ⋯ menu.</p>`}
    </section>
    <section><div class="field-head"><h3>Rename on Suno <small>${renTodo.length} to do</small></h3></div>
      <p class="meta">Copy the new name, rename on Suno, then tick it. The bracketed old name disappears once ticked.</p>
      ${renames.length ? renames.map(s => `<div class="clean-row${item(s).renameDone ? " done" : ""}" data-stem="${esc(s)}"><input type="checkbox" data-rename-done ${item(s).renameDone ? "checked" : ""} aria-label="Renamed on Suno"><span class="t"><b>${esc(item(s).name)}</b><small>was ${esc(take(s).title)}</small></span><button class="btn small" data-copy-name>Copy name</button><a class="btn small" href="${suno(s)}" target="_blank" rel="noopener">Open on Suno</a></div>`).join("") : `<p class="empty-note">No renames yet. Use <b>edit</b> on a take.</p>`}
    </section></div>`;
}

// ---------- migration notice and log ----------
function renderNotice() {
  const log = migrationLog(), run = log.runs[log.runs.length - 1], box = $("migrationNotice");
  const show = run && !log.seen;
  box.classList.toggle("hidden", !show);
  if (!show) return;
  box.innerHTML = `<span><b>Album picks now keep one status per take.</b> ${run.conflicts.length} take${run.conflicts.length === 1 ? "" : "s"} had overlapping flags${run.pulledIn.length ? `, and ${run.pulledIn.length} Audio Board Shortlist/Maybe take${run.pulledIn.length === 1 ? " was" : "s were"} added to the planner` : ""}. Your data was backed up first.</span>
    <button class="btn small" id="noticeReview">Review</button><button class="btn small" id="noticeDismiss">Dismiss</button>`;
}
function logText() {
  const log = migrationLog();
  if (!log.runs.length) return "No status migration has run on this device.";
  return log.runs.map(run => `Status migration ${run.at}\nAlbums: ${run.albums.join(", ")}\n\nConflicts (${run.conflicts.length}), first matching rule wins:\n${run.conflicts.map(c => `- ${c.title} · ${c.albumName}: ${c.flags.join(" + ")} → ${c.result}`).join("\n") || "(none)"}\n\nPulled into the planner because Audio Board had them as Shortlist/Maybe (${run.pulledIn.length}):\n${run.pulledIn.map(t => "- " + t).join("\n") || "(none)"}`).join("\n\n");
}
function openLog() {
  const log = migrationLog();
  $("logBody").innerHTML = !log.runs.length ? `<p class="meta">No status migration has run on this device. If you use the planner on another device, its log is kept there.</p>` : log.runs.map(run => `
    <h3 class="sub">${esc(new Date(run.at).toLocaleString())} · ${esc(run.albums.join(", "))}</h3>
    <p class="meta">${run.conflicts.length} conflict${run.conflicts.length === 1 ? "" : "s"}. A conflict is a take that carried more than one of: On album, Cut, Shortlist, Maybe. The first matching rule won (On album, then Cut, then Shortlist, then Maybe).</p>
    ${run.conflicts.length ? `<table class="log"><thead><tr><th>Take</th><th>Album</th><th>It had</th><th>Now</th></tr></thead><tbody>${run.conflicts.map(c => `<tr><td>${esc(c.title)}</td><td>${esc(c.albumName)}</td><td>${esc(c.flags.join(" + "))}</td><td>${esc(c.result)}</td></tr>`).join("")}</tbody></table>` : ""}
    ${run.pulledIn.length ? `<p class="meta">Added to the planner (Shortlist/Maybe on Audio Board only): ${esc(run.pulledIn.join(", "))}</p>` : ""}`).join("");
  $("logBackup").disabled = !localStorage.getItem(BACKUP_KEY);
  $("logDialog").showModal();
  if (!log.seen) { log.seen = true; try { localStorage.setItem(MIGRATION_KEY, JSON.stringify(log)); } catch (err) {} renderNotice(); }
}

// ---------- dialogs ----------
function openImport() {
  const sources = [["tracklist", "Audio Board tracklist", audio.tracklist || []], ...Object.entries(audio.collections || {}).map(([id, c]) => ["c:" + id, c.name, c.members || []])];
  $("importSources").innerHTML = sources.map(([id, name, stems]) => {
    const fresh = stems.filter(s => !state.considered[s]).length, newer = stems.filter(s => !TAKES[s]).length;
    return `<div class="import-row"><div class="t"><b>${esc(name)}</b><small>${stems.length} takes · ${fresh} new${newer ? ` · ${newer} newer than this snapshot` : ""}</small></div><button class="btn small primary" data-import="${esc(id)}" ${fresh ? "" : "disabled"}>Add ${fresh}</button></div>`;
  }).join("") + (sources.length === 1 && !audio.tracklist?.length ? `<p class="meta">No Audio Board sessions found on this device. Sign in above so the planner can read your synced Audio Board data.</p>` : "");
  $("importDialog").dataset.sources = JSON.stringify(Object.fromEntries(sources.map(([id, , stems]) => [id, stems])));
  renderCatalog(); $("importDialog").showModal();
}
function renderCatalog() {
  const q = $("catalogSearch").value.trim().toLowerCase(), all = $("catalogAll").checked;
  const list = Object.values(TAKES).filter(t => (all || t.type === "Vocal") && (!q || [t.title, t.baseTitle, t.writer, t.lyrics].some(x => String(x || "").toLowerCase().includes(q))))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, {numeric:true})).slice(0, 200);
  $("catalogResults").innerHTML = list.map(t => `<label class="session-option"><input type="checkbox" data-cat="${esc(t.stem)}" ${state.considered[t.stem] ? "checked disabled" : ""}><span><b>${esc(t.title)}</b> · ${esc(takeLabel(t))}</span></label>`).join("") || `<p class="meta">No matches.</p>`;
}
function openCompare(stem) {
  const t = take(stem), same = live().filter(s => s !== stem && take(s).baseTitle === t.baseTitle);
  const existing = Object.entries(state.sessions).filter(([, s]) => !s.members.includes(stem))
    .sort(([, a], [, b]) => (b.name === t.baseTitle) - (a.name === t.baseTitle) || a.name.localeCompare(b.name));
  const mine = sessionsOf(stem);
  $("compareTitle").textContent = "Compare " + nameOf(stem);
  $("compareBody").innerHTML = `
    ${mine.length ? `<p class="meta">Already in: ${mine.map(([id, s]) => `<button class="linkish" data-goto-session="${esc(id)}">${esc(s.name)}</button>`).join(", ")}</p>` : ""}
    <h3 class="sub">New session</h3>
    <input type="text" id="compareName" value="${esc(t.baseTitle)}" aria-label="Session name">
    ${same.length ? `<label class="inline"><input type="checkbox" id="compareSame" checked> also add the other ${same.length} take${same.length > 1 ? "s" : ""} of "${esc(t.baseTitle)}"</label>` : ""}
    <div class="scope-tools"><button class="btn primary" id="compareCreate">Start session</button></div>
    ${existing.length ? `<h3 class="sub">Or add to a session</h3><div class="session-options">${existing.map(([id, s]) => `<button class="session-row" data-add-to="${esc(id)}"><b>${esc(s.name)}</b><small>${s.members.length} takes</small></button>`).join("")}</div>` : ""}`;
  $("compareDialog").dataset.stem = stem;
  $("compareDialog").showModal();
}

// ---------- events ----------
document.querySelector(".tabs").onclick = e => { const b = e.target.closest("[data-view]"); if (!b) return; ui.view = b.dataset.view; saveView(); render(); };
$("renameAlbum").onclick = () => {
  const a = album(), name = prompt("Rename this album", a.name);
  if (name?.trim() && name.trim() !== a.name) { a.name = name.trim(); save(); toast("Album renamed"); }
};
$("targetAlbum").onchange = e => {
  if (e.target.value === "__new") { const id = newAlbum(); if (id) { ui.album = id; saveView(); save(); } else render(); return; }
  ui.album = e.target.value; saveView(); render();
};
$("q").oninput = e => { ui.q = e.target.value.trim(); renderConsider(); };
$("q").value = ui.q;
$("sort").onchange = e => { ui.sort = e.target.value; ui.dir = ""; saveView(); renderConsider(); };
$("sortDir").onclick = () => { ui.dir = sortDir() === "desc" ? "asc" : "desc"; saveView(); renderConsider(); };
$("bucketTabs").onclick = e => { const b = e.target.closest("[data-bucket-tab]"); if (b) { ui.bucket = b.dataset.bucketTab; saveView(); renderConsider(); } };
$("unscoredChip").onclick = () => { ui.unscored = !ui.unscored; saveView(); renderConsider(); };
$("sortChips").onclick = e => { const b = e.target.closest("[data-sf]"); if (b) { ui.sortFilter = b.dataset.sf; saveView(); renderSort(); } };
$("songFilter").onchange = $("sortSong").onchange = e => { ui.song = e.target.value; render(); };
$("sortQ").oninput = e => { ui.q = e.target.value.trim(); renderSort(); };
$("sortSort").onchange = e => { ui.sort = e.target.value; ui.dir = ""; saveView(); renderSort(); };
$("sortSortDir").onclick = () => { ui.dir = sortDir() === "desc" ? "asc" : "desc"; saveView(); renderSort(); };
$("sortType").onchange = e => { ui.type = e.target.value; saveView(); renderSort(); };
document.addEventListener("click", e => { const b = e.target.closest(".card [data-bucket]"); if (b) bucket(b.closest("[data-stem]").dataset.stem, b.dataset.bucket); });
$("groupBy").onchange = e => { ui.groupBy = e.target.value; saveView(); renderConsider(); };
$("typeFilter").onchange = e => { ui.type = e.target.value; saveView(); renderConsider(); };
$("clearOnly").onclick = () => { ui.only = null; history.replaceState(history.state, "", location.pathname); renderConsider(); renderChrome(); };
$("toastUndo").onclick = undo;
function gotoSession(id) { ui.view = "sessions"; ui.session = id; saveView(); render(); if (innerWidth < 820) $("sessionDetail").scrollIntoView(); }

// The ⋯ menu: Add to…, Compare.
function closeMenus(except = null) {
  document.querySelectorAll(".menu:not(.hidden)").forEach(m => { if (m === except) return; m.classList.add("hidden"); m.parentElement.querySelector("[data-act=menu]")?.setAttribute("aria-expanded", "false"); });
}
document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenus(); });
// A plain click on a Play link reuses the player tab on desktop; ctrl/shift/middle-click still open a new tab.
document.addEventListener("click", e => {
  const a = e.target.closest?.("a[data-play]");
  if (!a || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || !desktopPlayer()) return;
  e.preventDefault(); playOnSuno(new URL(a.href).pathname.split("/").pop());
});
// Every take control works the same wherever the card appears.
document.addEventListener("click", e => {
  const menuBtn = e.target.closest(".card [data-act=menu]");
  if (menuBtn) { const m = menuBtn.parentElement.querySelector(".menu"); closeMenus(m); const open = m.classList.toggle("hidden") === false; menuBtn.setAttribute("aria-expanded", open); if (open) m.querySelector("button")?.focus({preventScroll:true}); return; }
  if (!e.target.closest(".menu")) closeMenus();
  const gs = e.target.closest("[data-goto-session]"); if (gs) { document.querySelectorAll("dialog[open]").forEach(d => d.close()); gotoSession(gs.dataset.gotoSession); return; }
  const ga = e.target.closest("[data-goto-album]"); if (ga) { ui.view = "albums"; ui.album = ga.dataset.gotoAlbum; saveView(); render(); return; }
  const mi = e.target.closest(".card [data-menu]");
  if (mi) {
    const stem = mi.closest("[data-stem]").dataset.stem, kind = mi.dataset.menu; closeMenus();
    if (kind === "compare") openCompare(stem);
    if (kind === "delete") toggleDelete(stem);
    if (kind === "addto") { let id = mi.dataset.album; if (id === "__new") { id = newAlbum(); if (!id) return; } placeTake(stem, id); }
    return;
  }
  const seg = e.target.closest(".card [data-status]"); if (seg) { toggleStatus(seg.closest("[data-stem]").dataset.stem, seg.dataset.status); return; }
  const b = e.target.closest(".card [data-act]"); if (!b) return;
  const stem = b.closest("[data-stem]").dataset.stem, act = b.dataset.act;
  if (act === "rename") rename(stem);
  if (act === "delete") toggleDelete(stem);
  if (act === "lyrics") {
    const body = b.closest(".card").querySelector(".lyrics-body"), open = body.hidden;
    body.hidden = !open; b.setAttribute("aria-expanded", open); b.textContent = "Lyrics " + (open ? "▾" : "▸");
    if (open) ui.lyricsOpen.add(stem); else ui.lyricsOpen.delete(stem);
  }
});
document.addEventListener("focusin", e => { const c = e.target.closest?.(".card"); if (c) focusStem = c.dataset.stem; });
document.addEventListener("change", e => {
  const sel = e.target.closest("select.add-to"); if (!sel || !sel.value) return;
  const stem = sel.closest("[data-stem]").dataset.stem;
  let id = sel.value; if (id === "__new") { id = newAlbum(); if (!id) { sel.value = ""; return; } }
  placeTake(stem, id);
});
// Score box: commit on change, Enter jumps to the next take's box.
function commitScore(input) {
  const stem = input.closest("[data-stem]").dataset.stem, raw = input.value.trim();
  const n = raw === "" ? null : Math.max(0, Math.min(100, Math.round(Number(raw))));
  if (raw !== "" && !Number.isFinite(Number(raw))) { input.value = rating(stem).score ?? ""; return; }
  input.value = n ?? "";
  if ((rating(stem).score ?? null) === n) return;
  setRating(stem, {score:n});
  document.querySelectorAll(`[data-stem="${CSS.escape(stem)}"] .score-in`).forEach(x => { x.value = n ?? ""; x.className = "score-in " + scoreClass(n); });
}
document.addEventListener("change", e => { if (e.target.matches(".score-in")) commitScore(e.target); });
document.addEventListener("change", e => {
  if (!e.target.matches('.take-readiness')) return;
  const stem=e.target.closest('[data-stem]').dataset.stem;
  setRating(stem,{readiness:e.target.value}); requestRender();
});
for (const id of ['sortType','typeFilter']) {
  const label=document.createElement('label');label.className='meta';label.textContent='Listening ';
  const select=document.createElement('select');select.setAttribute('aria-label','Filter listening readiness');
  select.innerHTML='<option value="">All readiness</option>'+ReviewTools.options(ui.readiness);select.value=ui.readiness;
  select.className='readiness-filter';select.onchange=()=>{ui.readiness=select.value;document.querySelectorAll('.readiness-filter').forEach(s=>s.value=ui.readiness);saveView();requestRender();};
  label.append(select);$(id).after(label);
}
window.addEventListener('storage', e=>{
  if(e.key!==AUDIO_KEY||!e.newValue)return;
  try {const incoming=AlbumSync.prepare(JSON.parse(e.newValue));if(incoming._sync.owner!==audio._sync.owner)return;
    audio=AlbumSync.project(audio,AlbumSync.merge(audio._sync.records,incoming._sync.records),audio._sync.owner);audioPrev=clone(audio);requestRender();
  }catch(err){$('saveStatus').textContent='Other-tab scores could not be read. Export a backup.';}
});
document.addEventListener("keydown", e => {
  if (!e.target.matches?.(".score-in") || e.key !== "Enter") return;
  e.preventDefault(); commitScore(e.target);
  const boxes = [...document.querySelectorAll(".score-in")].filter(x => x.offsetParent), next = boxes[boxes.indexOf(e.target) + (e.shiftKey ? -1 : 1)];
  if (next) { next.focus(); next.select(); next.scrollIntoView({block:"nearest"}); } else e.target.blur();
});
// Notes save as you type (debounced) into the Audio Board note.
function fit(t) { if (!t) return; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight + 2, document.activeElement === t ? 600 : 120) + "px"; }
const noteTimers = {};
document.addEventListener("input", e => {
  if (!e.target.matches("textarea.note")) return;
  const t = e.target, stem = t.closest("[data-stem]").dataset.stem; fit(t);
  clearTimeout(noteTimers[stem]); noteTimers[stem] = setTimeout(() => setRating(stem, {note:t.value}), 400);
});
document.addEventListener("focusin", e => { if (e.target.matches?.("textarea.note")) fit(e.target); });
document.addEventListener("focusout", e => {
  if (!e.target.matches?.("textarea.note")) return;
  const stem = e.target.closest("[data-stem]").dataset.stem;
  if (noteTimers[stem]) { clearTimeout(noteTimers[stem]); delete noteTimers[stem]; if ((rating(stem).note || "") !== e.target.value) setRating(stem, {note:e.target.value}); }
  setTimeout(() => fit(e.target), 0);
});

// ---------- keyboard triage ----------
const typingIn = el => el?.closest?.("input, textarea, select, [contenteditable]:not([contenteditable=false])");
function visibleCards() { if (hostOwnsPage()) return [...HOST.cardRoot().querySelectorAll(".card:not(.leaving)")]; return [...document.querySelectorAll(`#view${{sort:"Sort", consider:"Consider", sessions:"Sessions"}[ui.view] || "None"} .card:not(.leaving)`)]; }
function focusCard(el) { if (!el) return; focusStem = el.dataset.stem; el.focus({preventScroll:true}); el.scrollIntoView({block:"nearest", behavior:reducedMotion() ? "auto" : "smooth"}); }
document.addEventListener("keydown", e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target) || document.querySelector("dialog[open]")) return;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key === "?") { e.preventDefault(); $("keysDialog").showModal(); return; }
  if (key === "z") { e.preventDefault(); undo(); return; }
  if (HOST ? !HOST.keysActive(ui.view) : !PANEL_VIEWS.includes(ui.view)) return;
  const cards = visibleCards(), at = e.target.closest?.(".card") || (focusStem && cardEl(focusStem)) || null, i = cards.indexOf(at);
  if (key === "j") { e.preventDefault(); focusCard(cards[i + 1] || (i < 0 ? cards[0] : null)); return; }
  if (key === "k") { e.preventDefault(); focusCard(i > 0 ? cards[i - 1] : i < 0 ? cards[0] : null); return; }
  const acts = {s:"short", m:"maybe", a:"on", c:"cut", u:"unreviewed"};
  if (!acts[key] && key !== " ") return;
  if (!at) { if (cards[0] && !e.target.closest("button, a, summary")) { e.preventDefault(); focusCard(cards[0]); } return; }   // first key press shows which card the keys act on
  const stem = at.dataset.stem;
  if (acts[key]) { e.preventDefault(); setStatus(stem, acts[key]); return; }
  if (!e.target.closest("button, a, summary")) { e.preventDefault(); playOnSuno(stem); }
});
$("keysClose").onclick = () => $("keysDialog").close();

// ---------- tracklist panel, replace dialog, migration log ----------
$("panelBar").onclick = () => { const open = $("trackPanel").classList.toggle("open"); $("panelBar").setAttribute("aria-expanded", open); };
$("replaceYes").onclick = () => { const p = pendingPlace; pendingPlace = null; $("replaceDialog").close(); if (p) commitPlace(p.stem, p.id, p.clash); };
$("replaceBoth").onclick = () => { const p = pendingPlace; pendingPlace = null; $("replaceDialog").close(); if (p) commitPlace(p.stem, p.id, []); };
$("replaceCancel").onclick = () => $("replaceDialog").close();
$("replaceDialog").addEventListener("close", () => { pendingPlace = null; });
$("logBtn").onclick = openLog;
$("logClose").onclick = () => $("logDialog").close();
$("logCopy").onclick = async () => toast(await copyText(logText()) ? "Log copied" : "Copy failed");
$("logBackup").onclick = () => {
  const blob = new Blob([localStorage.getItem(BACKUP_KEY) || "{}"], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "album-plan-before-status-migration.json"; a.click(); URL.revokeObjectURL(a.href);
};
document.addEventListener("click", e => {
  if (e.target.closest("#noticeReview")) openLog();
  if (e.target.closest("#noticeDismiss")) { const log = migrationLog(); log.seen = true; try { localStorage.setItem(MIGRATION_KEY, JSON.stringify(log)); } catch (err) {} renderNotice(); }
});

$("considerList").addEventListener("click", e => {
  const g = e.target.closest("[data-compare-group]"); if (!g) return;
  const stems = pool().filter(s => take(s).baseTitle === g.dataset.compareGroup && !tagged(s));
  const id = newSession(g.dataset.compareGroup, stems); save(); toast("Session started: " + g.dataset.compareGroup); gotoSession(id);
});
$("autoGroup").onclick = () => {
  const groups = new Map();
  for (const s of live()) { if (sessionsOf(s).length) continue; const b = take(s).baseTitle; if (!groups.has(b)) groups.set(b, []); groups.get(b).push(s); }
  const multi = [...groups].filter(([, l]) => l.length > 1);
  if (!multi.length) { toast("No songs with two or more takes outside a session"); return; }
  if (!confirm(`Create ${multi.length} compare sessions, one per song with 2+ takes not in a session yet?\n\n${multi.map(([b, l]) => `${b} (${l.length})`).join("\n")}`)) return;
  snapshot(); for (const [b, l] of multi) newSession(b, l); save();
  toast(`${multi.length} sessions created`, true); ui.view = "sessions"; saveView(); render();
};
$("importOpen").onclick = openImport;
$("importClose").onclick = () => $("importDialog").close();
$("importSources").onclick = e => {
  const b = e.target.closest("[data-import]"); if (!b) return;
  const n = consider(JSON.parse($("importDialog").dataset.sources)[b.dataset.import] || []); toast(`Added ${n} take${n === 1 ? "" : "s"}`); openImport();
};
$("pasteAdd").onclick = () => {
  const ids = [...new Set(($("pasteIds").value.match(UUID) || []).map(x => x.toLowerCase()))];
  const n = consider(ids), unknown = ids.filter(id => !TAKES[id]).length;
  $("pasteNote").textContent = `${ids.length} IDs found, ${n} added${unknown ? `, ${unknown} newer than this catalogue snapshot (Suno link and placeholder title until the catalogue is rebuilt)` : ""}.`;
  if (n) $("pasteIds").value = "";
};
$("catalogSearch").oninput = renderCatalog;
$("catalogAll").onchange = renderCatalog;
$("catalogResults").onchange = e => { const c = e.target.closest("[data-cat]"); if (c?.checked) { consider([c.dataset.cat]); c.disabled = true; } };
$("compareCancel").onclick = () => $("compareDialog").close();
$("compareBody").onclick = e => {
  const stem = $("compareDialog").dataset.stem;
  if (e.target.closest("#compareCreate")) {
    const name = $("compareName").value.trim() || take(stem).baseTitle;
    const stems = [stem, ...($("compareSame")?.checked ? live().filter(s => s !== stem && take(s).baseTitle === take(stem).baseTitle) : [])];
    const id = newSession(name, stems); save(); $("compareDialog").close(); toast("Session started: " + name); gotoSession(id); return;
  }
  const add = e.target.closest("[data-add-to]");
  if (add) { const s = state.sessions[add.dataset.addTo]; s.members = [...new Set([...s.members, stem])]; save(); $("compareDialog").close(); toast("Added to " + s.name); }
};

$("sessionList").onclick = e => {
  if (e.target.closest("#newEmptySession")) { const name = prompt("Session name"); if (name?.trim()) { const id = newSession(name.trim(), []); save(); gotoSession(id); } return; }
  const b = e.target.closest("[data-session]"); if (b) gotoSession(b.dataset.session);
};
$("sessionDetail").addEventListener("click", e => {
  const s = state.sessions[ui.session]; if (!s) return;
  if (e.target.closest("[data-back]")) { ui.session = ""; saveView(); renderSessions(); $("sessionList").scrollIntoView(); return; }
  if (e.target.closest("#sessionSortDir")) { ui.sdir = dirOf(ui.ssort, ui.sdir) === "desc" ? "asc" : "desc"; saveView(); renderSessions(); return; }
  if (e.target.closest("#deleteSession")) { if (!confirm(`Delete session "${s.name}"? Its takes stay in the planner.`)) return; snapshot(); delete state.sessions[ui.session]; ui.session = ""; save(); toast("Session deleted", true); return; }
  if (e.target.closest("#sessionAddMore")) {
    const box = $("sessionAdder"); box.classList.toggle("hidden");
    const options = live().filter(m => !s.members.includes(m)).sort((a, b) => nameOf(a).localeCompare(nameOf(b), undefined, {numeric:true}));
    box.innerHTML = options.map(m => `<label class="session-option"><input type="checkbox" data-add-member="${esc(m)}"><span>${esc(nameOf(m))} · ${esc(takeLabel(take(m)))}</span></label>`).join("") || `<p class="meta">Every take in Album picks is already here.</p>`;
  }
});
$("sessionDetail").addEventListener("change", e => {
  const s = state.sessions[ui.session]; if (!s) return;
  if (e.target.id === "showExcluded") { ui.showExcluded = e.target.checked; saveView(); renderSessions(); return; }
  if (e.target.id === "sessionSort") { ui.ssort = e.target.value; ui.sdir = ""; saveView(); renderSessions(); return; }
  const m = e.target.closest("[data-add-member]"); if (m?.checked) { s.members = [...new Set([...s.members, m.dataset.addMember])]; save(); return; }
  if (e.target.id === "sessionName" && e.target.value.trim()) { s.name = e.target.value.trim(); save(false); renderSummary(); }
  if (e.target.id === "sessionNote") { s.note = e.target.value; save(false); }
});

$("albumHead").addEventListener("click", async e => {
  const a = album();
  if (e.target.closest("#copyAlbum")) toast(await copyText(a.name + "\n" + a.order.map((s, i) => `${i + 1}. ${nameOf(s)} (${take(s).title}, ${dur(take(s).duration)})`).join("\n")) ? "Tracklist copied" : "Copy failed");
  if (e.target.closest("#deleteAlbum")) { if (!confirm(`Delete "${a.name}"? Its tracks stay in the planner.`)) return; snapshot(); delete state.albums[ui.album]; ui.album = ""; save(); toast("Album deleted", true); }
});
$("albumHead").addEventListener("change", e => {
  const a = album();
  if (e.target.id === "albumName" && e.target.value.trim()) { a.name = e.target.value.trim(); save(); }
  if (e.target.id === "albumTarget") { a.target = Math.max(1, Math.min(40, Number(e.target.value) || 12)); save(); }
});
// The Album tab and the side panel share the same tracklist behaviour: move buttons, take off, drag to reorder.
let dragStem = null;
for (const list of [$("albumTracks"), $("panelBody")]) {
  list.addEventListener("click", e => {
    const li = e.target.closest("[data-stem]"); if (!li || !li.matches("li.track, li.ptrack")) return;
    const a = album(), i = a.order.indexOf(li.dataset.stem);
    const mv = e.target.closest("[data-move]");
    if (mv) { const j = i + Number(mv.dataset.move); if (j < 0 || j >= a.order.length) return; [a.order[i], a.order[j]] = [a.order[j], a.order[i]]; save(); return; }
    if (e.target.closest("[data-unplace]")) { snapshot(li.dataset.stem); a.order.splice(i, 1); save(); toast(`${labelOf(li.dataset.stem)} → Unreviewed`, true); }
  });
  list.addEventListener("dragstart", e => { if (e.target.matches?.("input,select")) return; const li = e.target.closest?.("[data-stem]"); if (li?.matches("li.track, li.ptrack")) { dragStem = li.dataset.stem; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragStem); } });
  list.addEventListener("dragover", e => { if (dragStem) e.preventDefault(); });
  list.addEventListener("drop", e => {
    e.preventDefault(); const li = e.target.closest("[data-stem]"), a = album();
    if (!dragStem || !li || li.dataset.stem === dragStem) return;
    snapshot(dragStem);
    a.order.splice(a.order.indexOf(dragStem), 1);
    const rect = li.getBoundingClientRect(), to = a.order.indexOf(li.dataset.stem) + (e.clientY > rect.top + rect.height / 2 ? 1 : 0);
    a.order.splice(to, 0, dragStem); dragStem = null; save();
  });
  list.addEventListener("dragend", () => { dragStem = null; document.querySelectorAll(".dragging").forEach(x => x.classList.remove("dragging")); });
}
$("pool").addEventListener("click", e => { const b = e.target.closest("[data-place]"); if (b) placeTake(b.closest("[data-stem]").dataset.stem, b.dataset.place); });

$("cleanup").addEventListener("change", e => {
  const row = e.target.closest("[data-stem]"); if (!row) return; const i = state.considered[row.dataset.stem];
  if (e.target.matches("[data-del-done]")) {
    if (e.target.checked) { i.delDone = Date.now(); for (const s of Object.values(state.sessions)) s.members = s.members.filter(m => m !== row.dataset.stem); for (const a of Object.values(state.albums)) { a.order = a.order.filter(m => m !== row.dataset.stem); a.cut = a.cut.filter(m => m !== row.dataset.stem); } }
    else delete i.delDone;
    save();
  }
  if (e.target.matches("[data-rename-done]")) { if (e.target.checked) i.renameDone = Date.now(); else delete i.renameDone; save(); }
});
$("cleanup").addEventListener("click", async e => {
  if (e.target.closest("#copyDeletes")) { const list = Object.keys(state.considered).filter(tagged).map(s => `${take(s).title}  ${suno(s)}`).join("\n"); toast(await copyText(list) ? "Delete list copied" : "Copy failed"); }
  const c = e.target.closest("[data-copy-name]"); if (c) toast(await copyText(item(c.closest("[data-stem]").dataset.stem).name) ? "Name copied" : "Copy failed");
  const k = e.target.closest("[data-untag]");
  if (k) { e.preventDefault(); const stem = k.closest("[data-stem]").dataset.stem; snapshot(stem); delete state.considered[stem].del; save(); toast("Delete tag removed. Back in Album picks.", true); }
});

$("exportBtn").onclick = () => {
  const {_sync, ...plan} = state;
  const blob = new Blob([JSON.stringify({app:"album-planner", exported:new Date().toISOString(), ...plan}, null, 2)], {type:"application/json"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "album-plan-" + new Date().toISOString().slice(0, 10) + ".json"; a.click(); URL.revokeObjectURL(a.href);
};
$("importBtn").onclick = () => $("importFile").click();
$("importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (d?.app !== "album-planner") throw Error("not an Album Planner export");
    snapshot(); state.considered = d.considered || {}; state.sessions = d.sessions || {}; state.albums = d.albums || {}; normalize(); ensureMigrated(true); save(); toast("Imported", true);
  } catch (err) { toast("Import failed: " + err.message); }
  e.target.value = "";
};

// ---------- sync: planner records + Audio Board scores, one sign-in ----------
const sync = {plan:{text:"", failed:false, synced:false}, audio:{text:"", failed:false, synced:false}};
function showStatus() {
  const p = sync.plan, a = sync.audio;
  const text = p.failed ? p.text : a.failed ? "Scores: " + a.text : /Saving/.test(a.text) && !/Saving/.test(p.text) ? a.text : p.text;
  $("syncStatus").textContent = text; $("syncStatus").classList.toggle("failed", p.failed || a.failed);
  $("retrySyncBtn").hidden = !(p.failed || a.failed) || !cloud;
  // A signed-in device converts to the new statuses only once both stores have loaded and match the account.
  if (p.synced && a.synced && ensureMigrated()) render();
}
const account = (user, busy) => { $("accountWho").textContent = user ? (user.email || user.displayName || "") : ""; $("signInBtn").hidden = !!user || busy; $("signOutBtn").hidden = !user; };
function initSync() {
  if (typeof firebase === "undefined" || !firebase.auth || !firebase.database) { sync.plan = {text:"Saved on this device. Connect to the internet and reload to sign in.", failed:false, synced:false}; showStatus(); return; }
  try {
    if (!firebase.apps.length) firebase.initializeApp({apiKey:"AIzaSyDTcQiFsjhSzlsEl7uPJvTtsxp798XOqIQ", authDomain:"family-planner-ccafc.firebaseapp.com", databaseURL:"https://family-planner-ccafc-default-rtdb.firebaseio.com", projectId:"family-planner-ccafc"});
    cloud = PlannerSync.create({firebase, read:() => state,
      replace:next => { state = next; previous = clone(state); persist(); requestRender(); },
      selectAccount:owner => {
        if (state._sync.owner === owner) return;
        let cached = null; try { cached = JSON.parse(localStorage.getItem(KEY + ".account." + owner)); } catch (err) {}
        // First sign-in keeps the signed-out plan and merges it into the account.
        state = cached?._sync?.owner === owner ? PlannerSync.prepare(cached) : state._sync.owner ? PlannerSync.prepare(PlannerSync.empty()) : state;
        previous = clone(state); persist();
      },
      status:(text, failed = false) => { sync.plan = {text, failed, synced:/^Synced across devices/.test(text)}; showStatus(); }, account});
    audioCloud = AlbumSync.create({firebase, board:"audio", read:() => audio,
      replace:next => { audio = next; audioPrev = clone(audio); persistAudio(); requestRender(); },
      selectAccount:owner => {
        if (audio._sync.owner === owner) return;
        const cached = readAudio(AUDIO_KEY + ".account." + owner);
        audio = cached?._sync?.owner === owner ? AlbumSync.prepare(blankAudio(cached)) : audio._sync.owner ? AlbumSync.prepare(blankAudio()) : audio;
        audioPrev = clone(audio); persistAudio();
      },
      status:(text, failed = false) => { sync.audio = {text, failed, synced:/^Synced across devices/.test(text)}; showStatus(); }, account});
    $("signInBtn").onclick = () => cloud.signIn();
    $("signOutBtn").onclick = () => cloud.signOut();
    $("retrySyncBtn").onclick = () => { cloud.retry(); audioCloud.retry(); };
  } catch (err) { sync.plan = {text:"Account sync could not start. Your plan is saved on this device.", failed:true, synced:false}; showStatus(); }
}

if (!Object.keys(state.albums).length || Object.values(state.albums).some(a => !a.cut)) save(false);
ensureMigrated();   // signed-out devices convert now; signed-in devices wait for their account (see showStatus)
render();
initSync();
if (HOST) window.PlannerApp = {
  get state() { return state; }, get audio() { return audio; }, ui, take, card, statusOf, nameOf, labelOf, takeLabel, albumOf, sessionsOf, item, tagged,
  setStatus, toggleStatus, placeTake, toggleDelete, rename, setRating, rating, openCompare, playOnSuno, undo, render, requestRender, saveView, save, consider, toast, gotoSession,
  show:(view) => { if (VIEWS.includes(view)) { ui.view = view; restoringNavigation = true; saveView(); restoringNavigation = false; } render(); },
  restore:(nav) => { Object.assign(ui, nav); restoringNavigation = true; saveView(); restoringNavigation = false; render(); },
};
// Same-account cross-tab Audio Board changes are merged by the storage listener above.
