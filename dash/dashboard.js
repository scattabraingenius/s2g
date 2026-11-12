"use strict";
/* The Grind dashboard: clock, month calendar, weather, and CodexBar usage.

   Usage is written by scripts/usage-feed/push_usage.py on the Mac into a secret gist (one file,
   usage.json). FEED_GIST is that gist's id; ?feed=<url> overrides it for testing. The gist only
   holds percentages, reset times and plan names, because anyone with this page's source can read it. */
const FEED_USER = "scattabraingenius";
const FEED_GIST = "994158e57243b2b3faa16adc029f0e0d";
const FEED_FILE = "usage.json";
const FEED_POLL_MS = 2 * 60 * 1000;
const FEED_STALE_MS = 30 * 60 * 1000;   // the Mac pushes at least every 15 minutes while awake
const STORE_KEY = "grind.dashboard.v1";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("../service-worker.js").catch(() => {});

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const prefs = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch {} };
// Default city, rather than a device location prompt, on a new browser or cleared storage.
const DEFAULT_PLACE = {name:"Troy, MI", lat:42.606, lon:-83.150};
const validPlace = p => p && typeof p.name === "string" && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/* ---------------- clock + calendar ---------------- */
let calDay = "", clockTimer = null;
/* Hours and minutes stay the hero; seconds and AM/PM are smaller and dimmer beside them. */
const CLOCK_FMT = new Intl.DateTimeFormat([], {hour:"numeric", minute:"2-digit", second:"2-digit"});
function clockHtml(now){
  const parts = CLOCK_FMT.formatToParts(now), part = type => parts.find(p => p.type === type)?.value || "";
  const ampm = part("dayPeriod");
  return `${esc(part("hour"))}:${esc(part("minute"))}<span class="sec">:${esc(part("second"))}</span>` + (ampm && prefs.showClockPeriod === true ? `<span class="ampm">${esc(ampm)}</span>` : "");
}
$('clockPeriod')?.setAttribute?.('aria-pressed', String(prefs.showClockPeriod === true));
$('clockPeriod')?.addEventListener?.('click', () => {
  prefs.showClockPeriod = prefs.showClockPeriod !== true;
  savePrefs();
  $('clockPeriod').setAttribute('aria-pressed', String(prefs.showClockPeriod));
  tickClock();
});
function tickClock(){
  const now = new Date();
  $("clockTime").innerHTML = clockHtml(now);
  const day = now.toDateString();
  if(day !== calDay){ calDay = day; renderCalendar(now); }
}
/* Re-armed just after each whole second, so the display never visibly skips a second the way a
   drifting setInterval(1000) can. */
function runClock(){
  tickClock();
  globalThis.renderNext?.();   // the countdown ticks with the clock (defined further down; absent in tests)
  globalThis.clearTimeout?.(clockTimer);
  clockTimer = globalThis.setTimeout?.(runClock, 1000 - Date.now() % 1000 + 15);
}
function renderCalendar(now){
  $("calMonth").textContent = now.toLocaleDateString([], {month:"long", year:"numeric"});
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(first); start.setDate(1 - first.getDay());
  let html = ["S","M","T","W","T","F","S"].map(d => `<div class="dow">${d}</div>`).join("");
  for(let i = 0; i < 42; i++){
    const d = new Date(start); d.setDate(start.getDate() + i);
    if(i === 35 && d.getMonth() !== now.getMonth()) break;   // drop an all-next-month last row
    const cls = d.getMonth() !== now.getMonth() ? " out" : d.toDateString() === now.toDateString() ? " today" : "";
    html += `<div class="d${cls}">${d.getDate()}</div>`;
  }
  $("calGrid").innerHTML = html;
}

/* ---------------- weather (Open-Meteo, no key) ---------------- */
const WMO = [[0,"☀️","Clear"],[1,"🌤️","Mostly clear"],[2,"⛅","Partly cloudy"],[3,"☁️","Cloudy"],[45,"🌫️","Fog"],[48,"🌫️","Fog"],
  [51,"🌦️","Drizzle"],[53,"🌦️","Drizzle"],[55,"🌧️","Drizzle"],[56,"🌧️","Freezing drizzle"],[57,"🌧️","Freezing drizzle"],
  [61,"🌧️","Light rain"],[63,"🌧️","Rain"],[65,"🌧️","Heavy rain"],[66,"🌨️","Freezing rain"],[67,"🌨️","Freezing rain"],
  [71,"🌨️","Light snow"],[73,"🌨️","Snow"],[75,"❄️","Heavy snow"],[77,"🌨️","Snow grains"],[80,"🌦️","Showers"],[81,"🌧️","Showers"],
  [82,"⛈️","Heavy showers"],[85,"🌨️","Snow showers"],[86,"🌨️","Snow showers"],[95,"⛈️","Thunderstorm"],[96,"⛈️","Thunderstorm"],[99,"⛈️","Thunderstorm"]];
const wmo = code => { const m = WMO.find(w => w[0] === code) || [0,"🌡️","—"]; return {icon:m[1], text:m[2]}; };
const units = () => prefs.units === "c" ? "c" : "f";

let wxSetupOpen = false;
function weatherSetup(msg){
  wxSetupOpen = true;
  $("wxPlace").textContent = "Weather";
  $("wxBody").innerHTML = `<div class="wx-setup">${msg ? `<span>${esc(msg)}</span>` : ""}
    <button type="button" id="wxLocate">Use my location</button>
    <input id="wxCity" type="search" placeholder="or type a city" aria-label="City">
    ${validPlace(prefs.place) ? '<button type="button" id="wxCancel">Cancel</button>' : ''}
  </div>`;
  if($("wxCancel")) $("wxCancel").onclick = () => loadWeather();
  $("wxLocate").onclick = () => navigator.geolocation.getCurrentPosition(
    pos => { prefs.place = {name:"My location", lat:+pos.coords.latitude.toFixed(3), lon:+pos.coords.longitude.toFixed(3)}; savePrefs(); loadWeather(); },
    () => weatherSetup("Location was blocked."), {timeout:10000});
  $("wxCity").onkeydown = async e => {
    if(e.key !== "Enter" || !e.target.value.trim()) return;
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(e.target.value.trim())}`).then(r => r.json());
      const g = r.results && r.results[0];
      if(!g) return weatherSetup("No city by that name.");
      prefs.place = {name:g.name, lat:g.latitude, lon:g.longitude}; savePrefs(); loadWeather();
    } catch { weatherSetup("Could not reach the weather service."); }
  };
}
/* The last forecast is kept so the hourly slots and strip can move on every minute without a new
   request; the forecast itself is refetched every 30 minutes. */
let lastWx = null;
const H = () => globalThis.GrindHourly;
const wxSlots = () => H() ? H().normSlots(prefs.wxSlots) : [7, 12, 16, 20];
async function loadWeather(){
  wxSetupOpen = false;
  $("wxUnits").textContent = units() === "c" ? "°C" : "°F";
  if(!validPlace(prefs.place)){ prefs.place = {...DEFAULT_PLACE}; savePrefs(); }
  const p = prefs.place;
  try {
    const q = new URLSearchParams({latitude:p.lat, longitude:p.lon, timezone:"auto", forecast_days:"5",
      current:"temperature_2m,weather_code", daily:"weather_code,temperature_2m_max,temperature_2m_min",
      hourly:"temperature_2m,apparent_temperature,precipitation_probability,weather_code",
      temperature_unit: units() === "c" ? "celsius" : "fahrenheit"});
    const w = await fetch("https://api.open-meteo.com/v1/forecast?" + q).then(r => { if(!r.ok) throw 0; return r.json(); });
    lastWx = w;
    $("wxPlace").innerHTML = `${esc(p.name)} <button type="button" class="chip" id="wxChange" title="Change place">Change</button>`;
    $("wxChange").onclick = () => weatherSetup();
    renderWeather();
  } catch { lastWx = null; $("wxBody").innerHTML = `<div class="empty">Weather is unavailable right now.</div>`; }
}
function renderWeather(){
  const w = lastWx; if(!w || wxSetupOpen) return;   // never wipe the place picker while it is open
  const now = wmo(w.current.weather_code), d = w.daily, r = Math.round;
  $("wxBody").innerHTML = `<div class="wx-now"><div class="wx-temp">${r(w.current.temperature_2m)}°</div>
      <div class="wx-icon" aria-hidden="true">${now.icon}</div>
      <div><div class="wx-cond">${now.text}</div><div class="wx-hilo">H ${r(d.temperature_2m_max[0])}° · L ${r(d.temperature_2m_min[0])}°</div></div></div>
    ${slotsHtml(w)}
    <div class="wx-strip" id="wxStrip"></div>
    <div class="wx-days">${d.time.map((t, i) => { const c = wmo(d.weather_code[i]);
      const name = i ? new Date(t + "T12:00").toLocaleDateString([], {weekday:"short"}) : "Today";
      return `<div><div class="day">${name}</div><div class="ic" title="${c.text}">${c.icon}</div><div>${r(d.temperature_2m_max[i])}° <span class="lo">${r(d.temperature_2m_min[i])}°</span></div></div>`; }).join("")}</div>`;
  drawStrip();
}
function slotsHtml(w){
  const pick = H()?.pickSlots(w.hourly, w.utc_offset_seconds, Date.now(), prefs.wxSlots);
  if(!pick) return "";
  const r = Math.round, day = pick.tomorrow ? new Date(pick.date + "T12:00").toLocaleDateString([], {weekday:"short"}) + " " : "";
  return `<div class="wx-slots" role="list" aria-label="${pick.tomorrow ? "Tomorrow" : "Today"} by the hour">${pick.slots.map(s => {
    const label = day + H().hourLabel(s.hour, true);
    if(s.missing) return `<div class="wx-slot" role="listitem"><div class="when">${label}</div><div class="feels">No data</div></div>`;
    const c = wmo(s.code);
    return `<div class="wx-slot${s.passed ? " passed" : ""}${s.current ? " current" : ""}" role="listitem">
      <div class="when">${label}</div>
      <div class="ic" title="${c.text}" aria-label="${c.text}">${c.icon}</div>
      <div class="t">${r(s.temp)}°</div>
      <div class="feels">Feels ${r(s.feels)}°</div>
      <div class="rain" title="Chance of rain">💧 ${Number.isFinite(s.rain) ? r(s.rain) : "–"}%</div></div>`; }).join("")}</div>`;
}
function drawStrip(){
  const host = $("wxStrip"), w = lastWx; if(!host || !w || !H()) return;
  const pts = H().stripWindow(w.hourly, w.utc_offset_seconds, Date.now(), 24);
  host.innerHTML = H().stripSvg(pts, host.clientWidth || 320, prefs.wxSlots);
}
/* Times editor: pick the hourly check-in slots (whole hours), saved on this device. */
function wxTimesEditor(open){
  const box = $("wxTimesEdit"), btn = $("wxTimes");
  box.hidden = !open; btn.setAttribute("aria-expanded", String(open));
  if(!open) return;
  const opts = sel => Array.from({length:24}, (_, h) => `<option value="${h}"${h === sel ? " selected" : ""}>${H() ? H().hourLabel(h, true) : h}</option>`).join("");
  const cur = wxSlots();
  box.innerHTML = `<span>Check-in times</span>${[0,1,2,3].map(i => `<select aria-label="Time ${i + 1}" data-slot="${i}">${opts(cur[i] ?? [7,12,16,20][i])}</select>`).join("")}
    <button type="button" class="chip" id="wxTimesSave">Save</button><button type="button" class="chip" id="wxTimesReset">Default</button>`;
  $("wxTimesSave").onclick = () => {
    prefs.wxSlots = wxSlotsFrom([...box.querySelectorAll("select")].map(s => +s.value)); savePrefs();
    wxTimesEditor(false); renderWeather();
  };
  $("wxTimesReset").onclick = () => { delete prefs.wxSlots; savePrefs(); wxTimesEditor(false); renderWeather(); };
}
const wxSlotsFrom = arr => H() ? H().normSlots(arr) : arr;
$("wxTimes").onclick = () => wxTimesEditor($("wxTimesEdit").hidden);
$("wxUnits").onclick = () => { prefs.units = units() === "c" ? "f" : "c"; savePrefs(); loadWeather(); };

/* ---------------- usage feed ---------------- */
let feed = null, feedError = "";

function feedUrls(){
  const override = new URLSearchParams(location.search).get("feed");
  if(override) return [{url:override, raw:true}];
  if(!FEED_GIST) return [];
  // The API answers fresh data; a browser revalidation that comes back 304 does not use up the
  // 60-an-hour anonymous limit. The raw file is the fallback when the limit is hit anyway.
  return [{url:`https://api.github.com/gists/${FEED_GIST}`},
          {url:`https://gist.githubusercontent.com/${FEED_USER}/${FEED_GIST}/raw/${FEED_FILE}?t=${Date.now()}`, raw:true}];
}
async function loadFeed(){
  const urls = feedUrls();
  if(!urls.length){ feedError = "setup"; return renderUsage(); }
  for(const {url, raw} of urls){
    try {
      const r = await fetch(url, {cache:"no-cache"});
      if(!r.ok) throw new Error(r.status);
      const body = await r.json();
      feed = raw ? body : JSON.parse(body.files[FEED_FILE].content);
      feedError = "";
      return renderUsage();
    } catch(e) { feedError = "unreachable"; }
  }
  renderUsage();
}

function fmtLeft(ms){
  if(ms <= 0) return "now";
  const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}
function fmtAgo(ms){ const m = Math.round(ms / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${fmtLeft(ms)} ago`; }

/* Runway card: verdict, one weekly chart for both providers, provider tiles, insights, history.
   All numbers come from GrindWidgets.usageModel in usage-widgets.js. */
const SHOW = ["both","codex","claude"];
const usageShow = () => SHOW.includes(prefs.usageShow) ? prefs.usageShow : "both";
const widthOf = id => Math.max(300, Math.round($(id).clientWidth || 600));
let usageModel = null;

function renderUsage(){
  const now = Date.now(), G = globalThis.GrindWidgets;
  const age = feed?.checkedAt ? now - Date.parse(feed.checkedAt) : null;
  $('feedAge').textContent = feedError ? 'Feed unavailable · showing last received readings' : age == null ? '' : `Feed checked ${fmtAgo(age)}`;
  $('feedAge').classList.toggle('warn', !!feedError || age > FEED_STALE_MS);
  if(typeof G?.usageModel !== "function") return;
  usageModel = G.usageModel(feed, now, !!feedError);
  const show = usageShow();
  for(const b of document.querySelectorAll?.("[data-show]") || []) b.setAttribute("aria-pressed", String(b.dataset.show === show));
  if(!usageModel.ready){
    $('usageVerdict').textContent = feedError ? 'Usage feed unavailable. Try Refresh.' : feed ? 'No provider data in the feed.' : 'Loading usage…';
    for(const id of ['runway','runwayLegend','usageTiles','usageInsights','dailyChart','tokenChart']) $(id).innerHTML = '';
    return;
  }
  $('usageVerdict').innerHTML = G.verdict(usageModel);
  drawRunway();
  $('usageTiles').innerHTML = usageModel.ids.filter(id => show === "both" || show === id).map(id => G.tile(usageModel, id)).join('');
  $('usageTiles').classList.toggle('single', show !== "both" || usageModel.ids.length < 2);
  $('usageInsights').innerHTML = G.insightsHtml(usageModel);
  $('dailyChart').innerHTML = G.dailyChart(usageModel, widthOf('dailyChart'));
  $('tokenChart').innerHTML = G.tokenChart(usageModel, widthOf('tokenChart'));
}
function drawRunway(){
  const G = globalThis.GrindWidgets, show = usageShow(), host = $('runway'), tip = $('runwayTip');
  const r = G.runway(usageModel, widthOf('runway'), show);
  host.innerHTML = r.svg; $('runwayLegend').innerHTML = G.runwayLegend(usageModel, show); tip.hidden = true;
  const svg = host.querySelector?.("svg"); if(!svg || !r.t1) return;
  const xh = svg.querySelector(".xhair");
  const move = e => {
    const box = svg.getBoundingClientRect(), px = (e.clientX - box.left) * (r.W / box.width);
    const t = r.t0 + (px - r.pad.l) / (r.W - r.pad.l - r.pad.r) * (r.t1 - r.t0);
    if(t < r.t0 || t > r.t1) return leave();
    xh.setAttribute("x1", px); xh.setAttribute("x2", px); xh.setAttribute("opacity", ".4");
    tip.innerHTML = G.runwayTip(usageModel, t, show); tip.hidden = false;
    const wrap = $('runwayWrap').getBoundingClientRect(), tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(0, e.clientX - wrap.left - tw / 2), wrap.width - tw) + "px";
  };
  const leave = () => { tip.hidden = true; xh.setAttribute("opacity", "0"); };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", leave);
}
for(const b of document.querySelectorAll?.("[data-show]") || []) b.onclick = () => { prefs.usageShow = b.dataset.show; savePrefs(); renderUsage(); };
// Quota-per-day opens by default on wide screens; both sections remember their state per device.
for(const id of ["usageDaily","usageLogs"]){
  const d = $(id), open = prefs.usageOpen?.[id];
  if(!d.addEventListener) continue;
  d.open = open ?? (id === "usageDaily" && !!globalThis.matchMedia?.("(min-width: 900px)").matches);
  d.addEventListener("toggle", () => { prefs.usageOpen = {...prefs.usageOpen, [id]: d.open}; savePrefs(); if(d.open && usageModel?.ready) renderUsage(); });
}
let resizeTimer;
globalThis.addEventListener?.("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => usageModel?.ready && renderUsage(), 150); });
$('refreshUsage').onclick = () => loadFeed();

/* ---------------- layout ---------------- */
/* Card registry. `frac` is the default width as a share of the row (layout.js turns it into columns
   for whatever screen this is). New cards are added here and appear at the end of saved layouts. */
const CARDS = [
  {id:"clock",    title:"Clock",         frac:0.25},
  {id:"calendar", title:"Calendar",      frac:0.25},
  {id:"weather",  title:"Weather",       frac:0.5},
  {id:"next",     title:"Next deadline", frac:0.5},
  {id:"capture",  title:"Capture",       frac:0.5},
  {id:"usage",    title:"AI usage",      frac:1},
];

/* ---------------- sign-in, Capture card, Next deadline ---------------- */
/* Same Google sign-in as the main app (reused automatically on this site and browser). The dashboard
   only READS planner tasks, and only writes Vault records through VaultStore. While signed out, tasks
   come from this browser's copy (grind.plan.v1), which the main app keeps when it is open here. */
const vaultStore = globalThis.VaultStore?.create() || null;
let captureUI = null, tasksRef = null, cloudTasks = null, tasksSource = "none", tasksError = "";
const cloud = globalThis.GrindCloud?.create({
  onUser(user){
    if(tasksRef){ try { tasksRef.off(); } catch {} tasksRef = null; }
    if(user){
      vaultStore?.attach(cloud.ref(VaultSync.PATH + user.uid));
      tasksRef = cloud.plannerRef("tasks");
      tasksRef.on("value", snap => { const v = snap.val(); cloudTasks = Array.isArray(v) ? v : Object.values(v || {}); tasksSource = "cloud"; tasksError = ""; renderNext(true); },
        err => { tasksSource = "local"; tasksError = err?.code === "PERMISSION_DENIED" ? "This account can't read The Grind." : "Tasks could not be read."; renderNext(true); });
    } else {
      vaultStore?.detach(); cloudTasks = null; tasksSource = "local"; renderNext(true);
    }
    captureUI?.refresh();
  },
  onConnected(on){ vaultStore?.setOffline(!on); captureUI?.refresh(); },
  onState(state){ if(state === "unavailable"){ tasksSource = "local"; renderNext(true); } captureUI?.refresh(); },
}) || null;
function localTasks(){ try { const v = JSON.parse(localStorage.getItem("grind.plan.v1") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }
let nextHtml = "";
function renderNext(force){
  const host = $("nextBody"), N = globalThis.GrindNextTask; if(!host || !N) return;
  const now = Date.now(), fromCloud = tasksSource === "cloud";
  const tasks = fromCloud ? cloudTasks : localTasks();
  const {next, overdue} = N.select(tasks, now);
  const note = tasksError ? `<span class="warn">${esc(tasksError)}</span>` : fromCloud ? "" : tasks.length ? "From this browser · may be out of date" : "";
  let html = "";
  if(next) html += `<div class="nx-count${next.dueNow ? " due" : ""}">${esc(N.countdown(next, now))}</div>
      <div class="nx-title">${esc(next.task.task || "Untitled task")}</div>
      <div class="nx-when">${esc(N.whenLabel(next, now))}${next.task.priority ? ` · priority ${esc(next.task.priority)}` : ""}</div>`;
  else html += `<div class="nx-empty">${tasks.length || fromCloud ? "No upcoming deadlines." : cloud && cloud.state !== "unavailable" && !cloud.user && cloud.authReady ? "Sign in to see your Grind deadlines." : "Your Grind deadlines appear here."}</div>`;
  if(overdue.length) html += `<div class="nx-overdue">${overdue.length} overdue · oldest: ${esc(overdue[0].task.task || "Untitled task")} (${esc(N.whenLabel(overdue[0], now))})</div>`;
  $("nextSource").innerHTML = note;
  if(force || html !== nextHtml){ nextHtml = html; host.innerHTML = html; }
}
globalThis.addEventListener?.("storage", e => { if(e.key === "grind.plan.v1" && tasksSource !== "cloud") renderNext(true); });
if(vaultStore && globalThis.GrindCapture && $("dashCapture").nodeType){
  /* No entry text on the wall screen (decided 2026-11-09): status and counts only. */
  captureUI = GrindCapture.mount($("dashCapture"), {store: vaultStore, cloud, recent: 0, rows: 2, draftKey: "dash",
    onRefresh(){ const n = vaultStore.entries().length; $("captureCount").textContent = n ? `${n} in the Vault` : ""; }});
}
cloud?.start();
/* A card that changes size redraws its own charts. One frame of batching keeps a drag or a span
   change to a single redraw. Kept here rather than in usage-widgets.js, which the Stream Deck plugin
   ships a copy of. */
const redrawQueued = new Set();
function cardResized(id){
  if(redrawQueued.has(id)) return;
  redrawQueued.add(id);
  (globalThis.requestAnimationFrame || (f => f()))(() => {
    redrawQueued.delete(id);
    if(id === "usage" && usageModel?.ready) renderUsage();
    if(id === "weather") drawStrip();
  });
}
if(globalThis.GrindLayout && document.querySelector){
  GrindLayout.mount({grid: document.querySelector("main.grid"), registry: CARDS, prefs, save: savePrefs,
    search: location.search, onResize: cardResized, bar: $("layoutBar"), toggle: $("editLayout")});
}

/* ---------------- start ---------------- */
runClock();
loadWeather(); setInterval(loadWeather, 30 * 60 * 1000);
setInterval(renderWeather, 60 * 1000);   // Move the hourly slots and strip along between forecasts.
loadFeed(); setInterval(loadFeed, FEED_POLL_MS);
setInterval(renderUsage, 60 * 1000);   // Update countdowns; measurement timestamps stay fixed.
document.addEventListener("visibilitychange", () => { if(!document.hidden){ loadFeed(); runClock(); renderWeather(); } });
