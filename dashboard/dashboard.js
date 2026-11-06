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
let calDay = "";
function tickClock(){
  const now = new Date();
  const [hm, ampm] = now.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"}).split(" ");
  $("clockTime").innerHTML = esc(hm) + (ampm ? `<span class="ampm">${esc(ampm)}</span>` : "");
  $("clockDate").textContent = now.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});
  const day = now.toDateString();
  if(day !== calDay){ calDay = day; renderCalendar(now); }
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

function weatherSetup(msg){
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
async function loadWeather(){
  $("wxUnits").textContent = units() === "c" ? "°C" : "°F";
  if(!validPlace(prefs.place)){ prefs.place = {...DEFAULT_PLACE}; savePrefs(); }
  const p = prefs.place;
  try {
    const q = new URLSearchParams({latitude:p.lat, longitude:p.lon, timezone:"auto", forecast_days:"5",
      current:"temperature_2m,weather_code", daily:"weather_code,temperature_2m_max,temperature_2m_min",
      temperature_unit: units() === "c" ? "celsius" : "fahrenheit"});
    const w = await fetch("https://api.open-meteo.com/v1/forecast?" + q).then(r => { if(!r.ok) throw 0; return r.json(); });
    const now = wmo(w.current.weather_code), d = w.daily, r = Math.round;
    $("wxPlace").innerHTML = `${esc(p.name)} <button type="button" class="chip" id="wxChange" title="Change place">Change</button>`;
    $("wxChange").onclick = () => weatherSetup();
    $("wxBody").innerHTML = `<div class="wx-now"><div class="wx-temp">${r(w.current.temperature_2m)}°</div>
        <div class="wx-icon" aria-hidden="true">${now.icon}</div>
        <div><div class="wx-cond">${now.text}</div><div class="wx-hilo">H ${r(d.temperature_2m_max[0])}° · L ${r(d.temperature_2m_min[0])}°</div></div></div>
      <div class="wx-days">${d.time.map((t, i) => { const c = wmo(d.weather_code[i]);
        const name = i ? new Date(t + "T12:00").toLocaleDateString([], {weekday:"short"}) : "Today";
        return `<div><div class="day">${name}</div><div class="ic" title="${c.text}">${c.icon}</div><div>${r(d.temperature_2m_max[i])}° <span class="lo">${r(d.temperature_2m_min[i])}°</span></div></div>`; }).join("")}</div>`;
  } catch { $("wxBody").innerHTML = `<div class="empty">Weather is unavailable right now.</div>`; }
}
$("wxUnits").onclick = () => { prefs.units = units() === "c" ? "f" : "c"; savePrefs(); loadWeather(); };

/* ---------------- usage feed ---------------- */
const PROVIDER_COLOR = {claude:"var(--claude)", codex:"var(--codex)"};
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

function renderUsage(){
  const now = Date.now();
  const byId = Object.fromEntries((feed?.providers || []).map(p => [p.id, p]));
  for(const type of ['burn','history']){
    const row = $(type === 'burn' ? 'burnRow' : 'historyRow');
    row.innerHTML = ['codex','claude'].map(id => {
      const p = byId[id];
      if(!p) return `<article class="provider-widget" style="--pc:${PROVIDER_COLOR[id]}"><b>${id === 'codex' ? 'Codex' : 'Claude'}</b><p class="empty">${feedError ? 'Usage feed unavailable. Retry refresh.' : feed ? 'Provider unavailable in feed.' : 'Loading…'}</p></article>`;
      return `<article class="provider-widget" style="--pc:${PROVIDER_COLOR[id]}">${GrindWidgets.card(p,type,feed,now,!!feedError)}</article>`;
    }).join('');
  }
  const age = feed?.checkedAt ? now - Date.parse(feed.checkedAt) : null;
  $('feedAge').textContent = feedError ? 'Feed unavailable · showing last received readings' : age == null ? '' : `Feed checked ${fmtAgo(age)}`;
  $('feedAge').classList.toggle('warn', !!feedError || age > FEED_STALE_MS);
}
$('refreshUsage').onclick = () => loadFeed();

/* ---------------- start ---------------- */
tickClock(); setInterval(tickClock, 1000);
loadWeather(); setInterval(loadWeather, 30 * 60 * 1000);
loadFeed(); setInterval(loadFeed, FEED_POLL_MS);
setInterval(renderUsage, 60 * 1000);   // Update countdowns; measurement timestamps stay fixed.
document.addEventListener("visibilitychange", () => { if(!document.hidden){ loadFeed(); tickClock(); } });
