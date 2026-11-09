/* Shared fake Firebase for browser tests: a compat-SDK look-alike injected into each page, backed by
   one in-memory database in Node that every page and browser context shares. No real account or
   network is used.

   Behaves like the real web SDK where it matters for sync tests:
   - writes made while offline wait in page memory and are lost if the page closes before reconnecting;
   - transactions only run against the server and retry when the data changed underneath them;
   - value listeners fire on attach (when online) and again whenever their path or a parent/child changes;
   - a denied read goes to the cancel callback, never to the value callback.

   Usage: const fb = createBackend(); await fb.install(context, {user, offline}); ... fb.read(path). */
"use strict";
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");

const fakeSDK = String.raw`
(() => {
 const listeners = [], authListeners = [], waiters = [], queue = [];
 let user = window.__initialUser ?? null, online = !window.__startOffline;
 const clean = t => String(t || "").replace(/^\/+|\/+$/g, "");
 const snap = v => ({ val: () => v == null ? null : structuredClone(v), exists: () => v != null });
 const related = (a, b) => a === b || a.startsWith(b + "/") || b.startsWith(a + "/");
 const auth = { currentUser: user,
  setPersistence: () => Promise.resolve(),
  onAuthStateChanged(fn){ authListeners.push(fn); queueMicrotask(() => fn(user)); return () => authListeners.splice(authListeners.indexOf(fn), 1); },
  signInWithPopup: async () => { window.__fake.setUser(window.__signInAs || { uid: "test-owner", email: "owner@example.test" }); },
  signInWithRedirect: async () => { window.__fake.setUser(window.__signInAs || { uid: "test-owner", email: "owner@example.test" }); },
  signOut: async () => window.__fake.setUser(null) };
 function deliverOne(l){
  window.__backendRead(l.target, user && user.uid).then(r => {
   if(!listeners.includes(l) || !online) return;
   if(r.denied){ listeners.splice(listeners.indexOf(l), 1); l.cancel && l.cancel({ code: "PERMISSION_DENIED", message: "permission_denied" }); return; }
   l.fn(snap(r.value));
  });
 }
 const untilOnline = () => online ? Promise.resolve() : new Promise(res => waiters.push(res));
 async function write(kind, target, value){
  if(!online) return new Promise(res => queue.push({ kind, target, value: structuredClone(value), res }));
  await window.__backendWrite(kind, target, structuredClone(value), user && user.uid);
 }
 function ref(target){ target = clean(target); return {
  key: target.split("/").pop(), toString: () => target,
  child: p => ref(target + "/" + clean(p)),
  on(event, fn, cancel){
   const l = { target, fn, cancel }; listeners.push(l);
   if(target === ".info/connected"){ queueMicrotask(() => fn(snap(online))); return fn; }
   if(online) deliverOne(l);
   return fn;
  },
  off(event, fn){ for(let i = listeners.length - 1; i >= 0; i--) if(listeners[i].target === target && (!fn || listeners[i].fn === fn)) listeners.splice(i, 1); },
  once(){ return untilOnline().then(() => window.__backendRead(target, user && user.uid)).then(r => { if(r.denied) throw { code: "PERMISSION_DENIED" }; return snap(r.value); }); },
  update: obj => write("update", target, obj),
  set: v => write("set", target, v),
  async transaction(update, onComplete){
   let result = null, error = null;
   try {
    await untilOnline();
    for(let i = 0; i < 40 && !result; i++){
     const cur = await window.__backendRead(target, user && user.uid);
     if(cur.denied) throw { code: "PERMISSION_DENIED", message: "permission_denied" };
     const next = update(cur.value == null ? null : structuredClone(cur.value));
     if(next === undefined){ result = { committed: false, snapshot: snap(cur.value) }; break; }
     const r = await window.__backendCommit(target, cur.version, structuredClone(next), user && user.uid);
     if(r.denied) throw { code: "PERMISSION_DENIED", message: "permission_denied" };
     if(r.committed) result = { committed: true, snapshot: snap(r.value) };
    }
    if(!result) throw Error("Too many retries");
   } catch(e){ error = e; }
   if(onComplete) onComplete(error, !!(result && result.committed), result && result.snapshot);
   if(error) throw error;
   return result;
  } }; }
 window.__fake = {
  setUser(next){ user = auth.currentUser = next; authListeners.forEach(fn => fn(next)); },
  async setOnline(v){
   online = v;
   listeners.filter(l => l.target === ".info/connected").forEach(l => l.fn(snap(v)));
   if(!v) return;
   while(queue.length){ const w = queue.shift(); await window.__backendWrite(w.kind, w.target, w.value, user && user.uid); w.res(); }
   waiters.splice(0).forEach(res => res());
   listeners.filter(l => l.target !== ".info/connected").forEach(deliverOne);
  },
  deliver(changed){ if(online) listeners.filter(l => l.target !== ".info/connected" && related(l.target, changed)).forEach(deliverOne); },
  queued: () => queue.length,
  isOnline: () => online };
 function authFactory(){ return auth; }
 authFactory.GoogleAuthProvider = function(){};
 authFactory.Auth = { Persistence: { LOCAL: "local" } };
 window.firebase = { apps: [], initializeApp(config){ this.apps.push({ config }); return this.apps[this.apps.length - 1]; }, auth: authFactory, database: () => ({ ref }) };
})();`;

function createBackend({ owner = "test-owner" } = {}) {
  let tree = {}, version = 0;
  const pages = new Set(), log = [];
  const parts = p => String(p || "").split("/").filter(Boolean);
  const allowed = uid => uid === owner;
  function read(p) { let cur = tree; for (const k of parts(p)) { if (cur == null || typeof cur !== "object") return null; cur = cur[k]; } return cur === undefined ? null : structuredClone(cur); }
  function setAt(p, value) {
    const ks = parts(p);
    if (!ks.length) { tree = value == null ? {} : structuredClone(value); return; }
    let cur = tree;
    for (const k of ks.slice(0, -1)) { if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {}; cur = cur[k]; }
    if (value == null) delete cur[ks[ks.length - 1]]; else cur[ks[ks.length - 1]] = structuredClone(value);
  }
  function notify(target) {
    for (const page of pages) if (!page.isClosed()) page.evaluate(t => window.__fake && window.__fake.deliver(t), target).catch(() => {});
  }
  function write(kind, target, value, uid) {
    if (!allowed(uid)) return { denied: true };
    if (kind === "set") setAt(target, value);
    else for (const [k, v] of Object.entries(value || {})) setAt(target + "/" + k, v);
    version++; log.push({ kind, target, keys: kind === "update" ? Object.keys(value || {}) : null });
    setTimeout(() => notify(target), 0);
    return { ok: true };
  }
  async function install(context, { user = { uid: owner, email: "owner@example.test" }, offline = false } = {}) {
    await context.addInitScript(({ user, offline }) => { window.__initialUser = user; window.__startOffline = offline; }, { user, offline });
    await context.route("**/*", route => {
      const url = route.request().url();
      if (url.includes("firebase-app-compat.js")) return route.fulfill({ contentType: "application/javascript", body: fakeSDK });
      if (url.startsWith("https://www.gstatic.com/firebasejs/")) return route.fulfill({ contentType: "application/javascript", body: "" });
      if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url)) return route.continue();
      return route.fulfill({ status: 503, body: "" });   // weather, gist and anything else external
    });
    await context.exposeBinding("__backendRead", (_, target, uid) => allowed(uid) ? { version, value: read(target) } : { denied: true });
    await context.exposeBinding("__backendWrite", (_, kind, target, value, uid) => write(kind, target, value, uid));
    await context.exposeBinding("__backendCommit", (_, target, ver, value, uid) => {
      if (!allowed(uid)) return { denied: true };
      if (ver !== version) return { committed: false };
      write("set", target, value, uid);
      return { committed: true, value: read(target) };
    });
    context.on("page", p => pages.add(p));
  }
  return { install, read, set: (p, v) => { setAt(p, v); version++; }, write: (kind, target, value) => write(kind, target, value, owner), log, track: p => pages.add(p) };
}

/* Serves the repository over http on a free port, so tests run without a separate server. */
function serveRepo(root = path.resolve(__dirname, "../..")) {
  const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml" };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(r)) })));
}

const browserPath = () => process.env.BROWSER_EXECUTABLE || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const waitFor = async (fn, ms = 5000, what = "condition") => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw Error("Timed out waiting for " + what); await new Promise(r => setTimeout(r, 50)); }
};

module.exports = { fakeSDK, createBackend, serveRepo, browserPath, waitFor };
