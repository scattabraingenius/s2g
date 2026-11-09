/* The Grind must never lose a task. Browser tests against the real main app with a fake Firebase
   (tests/helpers/fake-firebase.cjs): no real account, no network. Same harness as
   tests/vault-sync-browser.test.cjs.

   Needs the `playwright` package (NODE_PATH or a local install) and a Chromium browser: Edge by
   default, or BROWSER_EXECUTABLE. Serves the repository itself unless APP_BASE_URL is set.
     node tests/tasks-sync-browser.test.cjs                   all scenarios
     node tests/tasks-sync-browser.test.cjs --only=offline    scenarios whose name contains "offline" */
"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createBackend, serveRepo, browserPath, waitFor } = require("./helpers/fake-firebase.cjs");

const NODE = "planners/the-grind-scattabrain-2026";
const OWNER = { uid: "test-owner", email: "owner@example.test" };
const task = (id, name, extra = {}) => ({ id, task: name, people: [], time: "", due: "", dueTime: "", priority: 5, status: "todo", showOn: "", notes: "", created: 1000, ...extra });
const seedPlanner = () => ({ payloadV: 2, updated: 1, people: [{ id: "p1", name: "Scatta", color: "#A855F7" }],
  tasks: [task("t-old", "old task"), task("t-two", "second task", { created: 1001 })], vault: [] });

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

/* ---------- helpers ---------- */
async function open(ctx, base, file = "index.html") {
  const page = await ctx.newPage();
  page.on("pageerror", e => { page.__errors = (page.__errors || []).concat(String(e)); });
  page.on("dialog", d => d.accept().catch(() => {}));
  await page.goto(base + file);
  return page;
}
async function device(browser, fb, user = OWNER) {
  const ctx = await browser.newContext({ serviceWorkers: "block" });
  await fb.install(ctx, { user });
  return ctx;
}
const names = page => page.evaluate(() => tasks.map(t => t.task).sort());
const taskOn = (page, id) => page.evaluate(id => { const t = tasks.find(x => x.id === id); return t ? { task: t.task, status: t.status, showOn: t.showOn, due: t.due } : null; }, id);
/* Live tasks in the cloud: the per-task records when they exist, and the old-format mirror that the
   dashboard countdown, older tabs and exports read. */
function cloud(fb) {
  const mirror = (fb.read(NODE + "/tasks") || []).filter(Boolean);
  const acct = fb.read(NODE + "/tasksSync/accounts/" + OWNER.uid);
  const records = acct && acct.records ? Object.values(acct.records) : [];
  const live = [];
  for (const r of records) {
    const f = r.fields || {};
    if (f.deleted && JSON.parse(f.deleted.v) === true) continue;
    live.push({ id: r.id, task: f.task ? JSON.parse(f.task.v) : "", status: f.status ? JSON.parse(f.status.v) : "" });
  }
  return { mirror: mirror.map(t => t.task).sort(), mirrorById: Object.fromEntries(mirror.map(t => [t.id, t])),
    records: live.map(t => t.task).sort(), recordById: Object.fromEntries(live.map(t => [t.id, t])),
    /* What the cloud holds as the truth: the records once they exist, else the old array. */
    live: (records.length ? live : mirror).map(t => t.task).sort() };
}
const cloudHas = (fb, name) => cloud(fb).records.includes(name) || cloud(fb).mirror.includes(name);
async function quickAdd(page, text) {
  await page.evaluate(text => {
    const el = document.getElementById("quickInput");
    el.value = text;
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }, text);
}
/* The same steps the row handlers run (inline title commit, checkbox, ✕ button). */
const rename = (page, id, name) => page.evaluate(({ id, name }) => { const t = tasks.find(x => x.id === id); t.task = name; saveTasks(); render(); }, { id, name });
const markDone = (page, id) => page.evaluate(id => { const t = tasks.find(x => x.id === id); t.status = "done"; t.showOn = ""; saveTasks(); render(); }, id);
const removeTask = (page, id) => page.evaluate(id => { tasks = tasks.filter(x => x.id !== id); saveTasks(); render(); }, id);
const signedInAndLoaded = page => waitFor(() => page.evaluate(() => typeof authUser !== "undefined" && !!authUser && typeof cloudConnected !== "undefined" && cloudConnected), 5000, "sign-in");
const firstSnapshot = page => waitFor(async () => (await names(page)).includes("old task"), 5000, "first snapshot");
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));

/* ---------- scenarios ---------- */
scenario("offline add, close, reopen: the task survives and reaches the cloud", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await device(browser, fb);
  let page = await open(ctx, base); await signedInAndLoaded(page); await firstSnapshot(page);
  await page.evaluate(() => window.__fake.setOnline(false));
  await quickAdd(page, "OFFLINE TASK");
  assert.ok((await names(page)).includes("OFFLINE TASK"), "shown right after adding");
  await page.close();                                  // closed before it ever reconnected
  page = await open(ctx, base); await signedInAndLoaded(page); await settle(800);
  assert.deepEqual(await names(page), ["OFFLINE TASK", "old task", "second task"], "after reopening online");
  await waitFor(() => cloud(fb).records.includes("OFFLINE TASK"), 4000, "task in the cloud records");
  await waitFor(() => cloud(fb).mirror.includes("OFFLINE TASK"), 4000, "task in the mirror the dashboard reads");
  assert.deepEqual(page.__errors || [], []);
  await ctx.close();
});

scenario("offline edit, close, reopen: the change survives", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await device(browser, fb);
  let page = await open(ctx, base); await signedInAndLoaded(page); await firstSnapshot(page);
  await page.evaluate(() => window.__fake.setOnline(false));
  await markDone(page, "t-old");
  await page.close();
  page = await open(ctx, base); await signedInAndLoaded(page); await settle(800);
  assert.equal((await taskOn(page, "t-old")).status, "done");
  await waitFor(() => (cloud(fb).recordById["t-old"] || {}).status === "done", 4000, "done in the cloud");
  await ctx.close();
});

scenario("signed-out add, then sign in: the task survives the first cloud snapshot", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await device(browser, fb, null);
  const page = await open(ctx, base); await settle(400);
  await quickAdd(page, "SIGNED OUT TASK");
  await page.evaluate(user => window.__fake.setUser(user), OWNER);
  await signedInAndLoaded(page); await settle(800);
  assert.deepEqual(await names(page), ["SIGNED OUT TASK", "old task", "second task"]);
  await waitFor(() => cloudHas(fb, "SIGNED OUT TASK"), 4000, "task in the cloud");
  await ctx.close();
});

scenario("a stale old tab pushing its whole tasks array cannot erase new tasks or bring back deleted ones", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await device(browser, fb);
  const page = await open(ctx, base); await signedInAndLoaded(page); await firstSnapshot(page);
  const staleCopy = fb.read(NODE + "/tasks");                       // what an old tab still holds
  await quickAdd(page, "NEW TASK");
  await removeTask(page, "t-old");
  await waitFor(() => cloud(fb).live.includes("NEW TASK") && !cloud(fb).live.includes("old task"), 4000, "changes synced").catch(e => { throw Error(e.message + " " + JSON.stringify(cloud(fb).live)); });
  fb.write("update", NODE, { tasks: staleCopy, payloadV: 2, updated: Date.now() });   // the old tab's pushCloud()
  await settle(800);
  assert.deepEqual(await names(page), ["NEW TASK", "second task"], "new task kept, deleted task not resurrected");
  assert.deepEqual(cloud(fb).live, ["NEW TASK", "second task"]);
  await waitFor(() => JSON.stringify(cloud(fb).mirror) === JSON.stringify(["NEW TASK", "second task"]), 4000, "mirror repaired for old tabs and the dashboard");
  await ctx.close();
});

scenario("two tabs adding at the same moment, then reopening: both tasks, no duplicates", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await device(browser, fb);
  const a = await open(ctx, base), b = await open(ctx, base);
  await signedInAndLoaded(a); await signedInAndLoaded(b); await firstSnapshot(a); await firstSnapshot(b);
  await Promise.all([quickAdd(a, "TAB A"), quickAdd(b, "TAB B")]);
  const want = ["TAB A", "TAB B", "old task", "second task"];
  await waitFor(() => JSON.stringify(cloud(fb).live) === JSON.stringify(want), 5000, "both in the cloud").catch(e => { throw Error(e.message + " " + JSON.stringify(cloud(fb).live)); });
  await waitFor(async () => JSON.stringify(await names(a)) === JSON.stringify(want) && JSON.stringify(await names(b)) === JSON.stringify(want), 5000, "both tabs see both");
  const c = await open(ctx, base); await signedInAndLoaded(c); await settle(600);
  assert.deepEqual(await names(c), want);
  await ctx.close();
});

scenario("two devices change different parts of one task: the phone's offline done and the laptop's rename are both kept", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const phoneCtx = await device(browser, fb), laptopCtx = await device(browser, fb);
  const phone = await open(phoneCtx, base); await signedInAndLoaded(phone); await firstSnapshot(phone);
  const laptop = await open(laptopCtx, base); await signedInAndLoaded(laptop); await firstSnapshot(laptop);
  await phone.evaluate(() => window.__fake.setOnline(false));
  await markDone(phone, "t-old");                                   // phone, no signal
  await settle(50);
  await rename(laptop, "t-old", "renamed on laptop");               // laptop, a moment later
  await waitFor(async () => cloudHas(fb, "renamed on laptop"), 4000, "rename synced");
  await phone.evaluate(() => window.__fake.setOnline(true));        // phone gets signal back
  await settle(1000);
  for (const [who, page] of [["phone", phone], ["laptop", laptop]]) {
    assert.deepEqual(await taskOn(page, "t-old"), { task: "renamed on laptop", status: "done", showOn: "", due: "" }, who);
  }
  await phoneCtx.close(); await laptopCtx.close();
});

scenario("importing a backup file merges tasks and never deletes newer ones", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await device(browser, fb);
  const page = await open(ctx, base); await signedInAndLoaded(page); await firstSnapshot(page);
  await quickAdd(page, "ADDED AFTER THE BACKUP");
  const backup = { version: "test", tasks: [task("t-old", "old task"), task("t-file", "FROM THE FILE", { created: 5000 })] };
  await page.setInputFiles("#importFile", { name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await settle(800);
  assert.deepEqual(await names(page), ["ADDED AFTER THE BACKUP", "FROM THE FILE", "old task", "second task"]);
  await waitFor(() => cloud(fb).live.includes("FROM THE FILE"), 4000, "imported task in the cloud");
  assert.ok(cloud(fb).live.includes("ADDED AFTER THE BACKUP"));
  await ctx.close();
});

scenario("a task being drafted with + survives a change synced from another tab, and is not sent until saved", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await device(browser, fb);
  const a = await open(ctx, base), b = await open(ctx, base);
  await signedInAndLoaded(a); await signedInAndLoaded(b); await firstSnapshot(a); await firstSnapshot(b);
  await a.evaluate(() => document.getElementById("addBtn").click());
  const draftId = await a.evaluate(() => editingId);
  assert.ok(draftId, "editor open on a new draft");
  await quickAdd(b, "FROM THE OTHER TAB");
  await waitFor(async () => (await names(a)).includes("FROM THE OTHER TAB"), 5000, "other tab's task arrives");
  assert.ok(await a.evaluate(id => tasks.some(t => t.id === id), draftId), "draft still there");
  const acct = fb.read(NODE + "/tasksSync/accounts/" + OWNER.uid);
  assert.ok(!Object.values(acct.records).some(r => r.id === draftId), "an unsaved draft is not in the cloud");
  await a.evaluate(() => { document.querySelector(".editor input[type=text]").value = "DRAFT SAVED"; document.querySelector(".editor .save-e").click(); });
  await waitFor(() => cloud(fb).records.includes("DRAFT SAVED"), 4000, "saved draft synced");
  await ctx.close();
});

scenario("Delete completed: the done tasks stay deleted after reloading and in the dashboard's copy", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, { ...seedPlanner(), tasks: [task("t-old", "old task"), task("t-d1", "done one", { status: "done" }), task("t-d2", "done two", { status: "done" })] });
  const ctx = await device(browser, fb);
  let page = await open(ctx, base); await signedInAndLoaded(page); await firstSnapshot(page);
  await page.evaluate(() => document.getElementById("deleteCompletedBtn").click());
  await waitFor(() => JSON.stringify(cloud(fb).records) === JSON.stringify(["old task"]), 4000, "deletes synced");
  await waitFor(() => JSON.stringify(cloud(fb).mirror) === JSON.stringify(["old task"]), 4000, "mirror updated");
  await page.close();
  page = await open(ctx, base); await signedInAndLoaded(page); await settle(600);
  assert.deepEqual(await names(page), ["old task"]);
  await ctx.close();
});

scenario("main app opened offline from the cache still saves tasks through the task store", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "allow" }); await fb.install(ctx, { user: OWNER });
  const page = await open(ctx, base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await waitFor(() => page.evaluate(async () => !!(await caches.match(new URL("sync/list-store.js?v=20261109-tasks2", location.href).href))), 8000, "offline cache filled");
  await page.reload(); await waitFor(() => page.evaluate(() => !!navigator.serviceWorker.controller), 5000, "controlled");
  await ctx.route("https://www.gstatic.com/**", r => r.abort());
  await ctx.setOffline(true);
  await page.reload();
  assert.equal(await page.evaluate(() => typeof taskStore !== "undefined" && !!taskStore), true, "task store loaded from the cache");
  await quickAdd(page, "NO SIGNAL TASK");
  assert.ok(await page.evaluate(() => Object.keys(localStorage).some(k => k.startsWith("grind.tasks.pending."))), "written as a pending change");
  await ctx.close();
});

/* Upgrade rule (decided 2026-11-09): data from before Tasks Sync v2 follows the old rule once, the
   cloud copy wins, so a device that was not opened for a while cannot bring back tasks deleted
   elsewhere. A device that never signs in keeps its own list. */
scenario("upgrade: an old device's stale list does not bring back tasks deleted elsewhere", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await device(browser, fb);
  await ctx.addInitScript(() => { if (!localStorage.getItem("grind.plan.v1")) localStorage.setItem("grind.plan.v1", JSON.stringify([
    { id: "t-old", task: "old task", people: [], status: "todo", created: 1000 },
    { id: "t-gone", task: "deleted on another device", people: [], status: "done", created: 900 }])); });
  const page = await open(ctx, base); await signedInAndLoaded(page); await settle(1000);
  assert.deepEqual(await names(page), ["old task", "second task"]);
  assert.deepEqual(cloud(fb).mirror, ["old task", "second task"]);
  assert.ok(!cloud(fb).records.includes("deleted on another device"));
  await ctx.close();
});

scenario("upgrade: a device that is never signed in keeps its own tasks", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await device(browser, fb, null);
  await ctx.addInitScript(() => { if (!localStorage.getItem("grind.plan.v1")) localStorage.setItem("grind.plan.v1", JSON.stringify([{ id: "t-local", task: "local only", people: [], status: "todo", created: 1000 }])); });
  let page = await open(ctx, base); await settle(400);
  assert.deepEqual(await names(page), ["local only"]);
  await quickAdd(page, "ANOTHER LOCAL");
  await page.close();
  page = await open(ctx, base); await settle(400);
  assert.deepEqual(await names(page), ["ANOTHER LOCAL", "local only"]);
  await ctx.close();
});

/* ---------- runner ---------- */
(async () => {
  const only = (process.argv.find(a => a.startsWith("--only=")) || "").slice(7);
  const server = process.env.APP_BASE_URL ? null : await serveRepo();
  const base = process.env.APP_BASE_URL || server.url;
  const browser = await chromium.launch({ headless: true, executablePath: browserPath() });
  let failed = 0;
  for (const s of scenarios.filter(s => !only || s.name.includes(only))) {
    try { await s.fn({ browser, base }); console.log("PASS " + s.name); }
    catch (e) { failed++; console.log("FAIL " + s.name + "\n     " + String(e && e.message || e).split("\n").slice(0, 6).join("\n     ")); }
  }
  await browser.close(); if (server) await server.close();
  console.log(failed ? `${failed} failed` : "all passed");
  process.exit(failed ? 1 : 0);
})();
