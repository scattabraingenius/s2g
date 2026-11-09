/* Vault capture must never lose an idea. Browser tests against the real pages with a fake Firebase
   (tests/helpers/fake-firebase.cjs): no real account, no network.

   Needs the `playwright` package (NODE_PATH or a local install) and a Chromium browser: Edge by
   default, or BROWSER_EXECUTABLE. Serves the repository itself unless APP_BASE_URL is set.
     node tests/vault-sync-browser.test.cjs                   all scenarios
     node tests/vault-sync-browser.test.cjs --only=offline    scenarios whose name contains "offline" */
"use strict";
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createBackend, serveRepo, browserPath, waitFor } = require("./helpers/fake-firebase.cjs");

const NODE = "planners/the-grind-scattabrain-2026";
const OWNER = { uid: "test-owner", email: "owner@example.test" };
const seedPlanner = () => ({ payloadV: 2, updated: 1, people: [{ id: "p1", name: "Scatta", color: "#A855F7" }], tasks: [],
  vault: [{ id: "v-old", text: "old idea", type: "idea", source: "", favorite: false, created: 1000, updated: 1000 }] });

const scenarios = [];
const scenario = (name, fn) => scenarios.push({ name, fn });

/* ---------- helpers ---------- */
async function open(ctx, base, file = "index.html") {
  const page = await ctx.newPage();
  page.on("pageerror", e => { page.__errors = (page.__errors || []).concat(String(e)); });
  await page.goto(base + file);
  return page;
}
const vaultTexts = page => page.evaluate(() => (typeof vault !== "undefined" ? vault : []).map(v => v.text).sort());
const cloudTexts = fb => {
  const legacy = (fb.read(NODE + "/vault") || []).map(v => v.text);
  const accounts = fb.read(NODE + "/vaultSync/accounts/" + OWNER.uid);
  const live = accounts && accounts.records ? Object.values(accounts.records).filter(r => !r.deleted).map(r => JSON.parse(r.data).text) : [];
  return { legacy: legacy.sort(), records: live.sort() };
};
async function addInMainApp(page, text, type = "idea") {
  await page.evaluate(({ text, type }) => {
    document.getElementById("vaultInput").value = text;
    document.getElementById("vaultType").value = type;
    addVaultEntry();
  }, { text, type });
}
const signedInAndLoaded = page => waitFor(() => page.evaluate(() => typeof authUser !== "undefined" && !!authUser && typeof cloudConnected !== "undefined" && cloudConnected), 5000, "sign-in");
const settle = (ms = 600) => new Promise(r => setTimeout(r, ms));

/* ---------- scenarios ---------- */
scenario("offline capture, close, reopen: the idea survives and reaches the cloud", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "block" }); await fb.install(ctx, { user: OWNER });
  let page = await open(ctx, base); await signedInAndLoaded(page);
  await waitFor(async () => (await vaultTexts(page)).includes("old idea"), 5000, "first snapshot");
  await page.evaluate(() => window.__fake.setOnline(false));
  await addInMainApp(page, "OFFLINE IDEA");
  assert.ok((await vaultTexts(page)).includes("OFFLINE IDEA"), "shown right after saving");
  await page.close();                                  // closed before it ever reconnected
  page = await open(ctx, base); await signedInAndLoaded(page); await settle(800);
  assert.deepEqual(await vaultTexts(page), ["OFFLINE IDEA", "old idea"], "after reopening online");
  await waitFor(() => cloudTexts(fb).legacy.includes("OFFLINE IDEA") || cloudTexts(fb).records.includes("OFFLINE IDEA"), 4000, "idea in the cloud");
  await ctx.close();
});

scenario("signed-out capture, then sign in: the idea survives the first cloud snapshot", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "block" }); await fb.install(ctx, { user: null });
  const page = await open(ctx, base); await settle(400);
  await addInMainApp(page, "SIGNED OUT IDEA");
  await page.evaluate(user => window.__fake.setUser(user), OWNER);
  await signedInAndLoaded(page); await settle(800);
  assert.deepEqual(await vaultTexts(page), ["SIGNED OUT IDEA", "old idea"]);
  await ctx.close();
});

scenario("a stale old tab pushing its whole vault array cannot erase new ideas or bring back deleted ones", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "block" }); await fb.install(ctx, { user: OWNER });
  const page = await open(ctx, base); await signedInAndLoaded(page);
  await waitFor(async () => (await vaultTexts(page)).includes("old idea"), 5000, "first snapshot");
  const staleCopy = fb.read(NODE + "/vault");                       // what an old tab still holds
  await addInMainApp(page, "NEW IDEA");
  await page.evaluate(() => { const v = vault.find(x => x.text === "old idea"); window.confirm = () => true; vaultStore.remove(v.id); });
  await waitFor(() => cloudTexts(fb).records.includes("NEW IDEA"), 4000, "new idea synced");
  fb.write("update", NODE, { vault: staleCopy, payloadV: 2, updated: Date.now() });   // the old tab's pushCloud()
  await settle(800);
  assert.deepEqual(await vaultTexts(page), ["NEW IDEA"], "new idea kept, deleted idea not resurrected");
  assert.deepEqual(cloudTexts(fb).records, ["NEW IDEA"]);
  await waitFor(() => JSON.stringify(cloudTexts(fb).legacy) === JSON.stringify(["NEW IDEA"]), 4000, "mirror repaired for old tabs");
  await ctx.close();
});

scenario("two tabs saving at the same moment, then reopening: both ideas, no duplicates", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "block" }); await fb.install(ctx, { user: OWNER });
  const a = await open(ctx, base), b = await open(ctx, base);
  await signedInAndLoaded(a); await signedInAndLoaded(b);
  await Promise.all([addInMainApp(a, "TAB A"), addInMainApp(b, "TAB B")]);
  await waitFor(() => cloudTexts(fb).records.length === 3, 5000, "both in the cloud");
  await waitFor(async () => (await vaultTexts(a)).length === 3 && (await vaultTexts(b)).length === 3, 5000, "both tabs see both");
  const c = await open(ctx, base); await signedInAndLoaded(c); await settle(600);
  assert.deepEqual(await vaultTexts(c), ["TAB A", "TAB B", "old idea"]);
  assert.deepEqual(cloudTexts(fb).records, ["TAB A", "TAB B", "old idea"]);
  await ctx.close();
});

scenario("existing Vault entries migrate once, on every device, without duplicates", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const devices = [];
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext({ serviceWorkers: "block" }); await fb.install(ctx, { user: OWNER });
    await ctx.addInitScript(() => { if (!localStorage.getItem("grind.vault.v1")) localStorage.setItem("grind.vault.v1", JSON.stringify([{ id: "v-old", text: "old idea", type: "idea", created: 1000, updated: 1000 }, { id: "v-local", text: "only on this device", type: "bar", created: 2000, updated: 2000 }])); });
    const page = await open(ctx, base); await signedInAndLoaded(page); devices.push({ ctx, page });
  }
  await settle(1000);
  assert.deepEqual(cloudTexts(fb).records, ["old idea", "only on this device"]);
  for (const d of devices) { assert.deepEqual(await vaultTexts(d.page), ["old idea", "only on this device"]); await d.ctx.close(); }
});

async function captureOn(page, text, sel = "#capture") {
  await page.locator(sel + " .cap-text").fill(text);
  await page.locator(sel + " .cap-text").press("Enter");
}
const statusOf = (page, sel = "#capture") => page.locator(sel + " .cap-status").textContent();

scenario("capture page: Enter then close at once keeps the idea; reopening signed in syncs it", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "block" }); await fb.install(ctx, { user: OWNER });
  let page = await open(ctx, base, "capture/");
  await page.evaluate(() => window.__fake.setOnline(false));
  await captureOn(page, "SHOWER THOUGHT");
  assert.match(await statusOf(page), /Saved on this device/);
  assert.equal(await page.locator("#capture .cap-text").inputValue(), "", "box cleared only after the save");
  await page.close();
  page = await open(ctx, base, "capture/");
  await waitFor(() => cloudTexts(fb).records.includes("SHOWER THOUGHT"), 5000, "synced after reopening");
  await waitFor(async () => /Synced|All synced/.test(await statusOf(page)), 3000, "status shows synced");
  assert.match(await page.locator("#capture .cap-recent").textContent(), /SHOWER THOUGHT/);
  await ctx.close();
});

scenario("capture page: an unfinished draft survives a crash or accidental close", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "block" }); await fb.install(ctx, { user: OWNER });
  let page = await open(ctx, base, "capture/");
  await page.locator("#capture .cap-text").type("half a thought");
  await page.close();
  page = await open(ctx, base, "capture/");
  assert.equal(await page.locator("#capture .cap-text").inputValue(), "half a thought");
  assert.equal(cloudTexts(fb).records.length, 0, "a draft is not an entry");
  await ctx.close();
});

scenario("capture page with the main app open in another tab: the Vault tab shows it without reloading", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "block" }); await fb.install(ctx, { user: OWNER });
  const main = await open(ctx, base); await signedInAndLoaded(main);
  const cap = await open(ctx, base, "capture/");
  await captureOn(cap, "FROM THE CAPTURE PAGE");
  await waitFor(async () => (await vaultTexts(main)).includes("FROM THE CAPTURE PAGE"), 5000, "main app updated");
  await waitFor(() => cloudTexts(fb).records.includes("FROM THE CAPTURE PAGE"), 5000, "in the cloud");
  await ctx.close();
});

scenario("signed-out capture page: saved on this device, then synced after signing in there", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "block" }); await fb.install(ctx, { user: null });
  const page = await open(ctx, base, "capture/");
  await captureOn(page, "BEFORE SIGN IN");
  await waitFor(async () => /sign in to sync/i.test(await statusOf(page)), 3000, "signed-out status");
  await page.locator("#capture .cap-signin").click();
  await waitFor(() => cloudTexts(fb).records.includes("BEFORE SIGN IN"), 5000, "synced after sign-in");
  await ctx.close();
});

scenario("dashboard: countdown reads the cloud tasks, the capture card saves, and nothing else is written", async ({ browser, base }) => {
  const fb = createBackend();
  const soon = new Date(Date.now() + 2 * 3600e3), pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const yesterday = new Date(Date.now() - 864e5);
  fb.set(NODE, { ...seedPlanner(), tasks: [
    { id: "t1", task: "Send the mix", status: "todo", due: ymd(soon), dueTime: `${pad(soon.getHours())}:${pad(soon.getMinutes())}`, priority: 7, created: 1, people: [] },
    { id: "t2", task: "Missed thing", status: "todo", due: ymd(yesterday), dueTime: "", priority: 5, created: 1, people: [] },
    { id: "t3", task: "Parked", status: "later", showOn: "", due: ymd(soon), priority: 9, created: 1, people: [] }] });
  const before = JSON.stringify(fb.read(NODE + "/tasks"));
  const ctx = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1600, height: 1000 } }); await fb.install(ctx, { user: OWNER });
  const page = await open(ctx, base, "dash/");
  await waitFor(async () => /Send the mix/.test(await page.locator("#nextBody").textContent()), 6000, "countdown shows the task");
  const body = await page.locator("#nextBody").textContent();
  assert.match(body, /\b[12]h \d+m\b/); assert.match(body, /1 overdue · oldest: Missed thing/); assert.doesNotMatch(body, /Parked/);
  await captureOn(page, "WALL SCREEN IDEA", "#dashCapture");
  await waitFor(() => cloudTexts(fb).records.includes("WALL SCREEN IDEA"), 5000, "card capture synced");
  assert.doesNotMatch(await page.locator("[data-card=capture]").textContent(), /WALL SCREEN IDEA|old idea/, "no entry text on the dashboard");
  assert.equal(JSON.stringify(fb.read(NODE + "/tasks")), before, "tasks untouched");
  const foreign = fb.log.filter(w => !w.target.startsWith(NODE + "/vaultSync/accounts/" + OWNER.uid));
  assert.deepEqual(foreign, [], "the dashboard wrote only Vault records");
  assert.deepEqual(page.__errors || [], []);
  await ctx.close();
});

scenario("capture page opened with no connection at all (from the offline cache) still saves, then syncs when back online", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "allow" }); await fb.install(ctx, { user: OWNER });
  const page = await open(ctx, base, "capture/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await waitFor(() => page.evaluate(async () => !!(await caches.match(new URL("vault-store.js?v=20261109-vault2", location.href).href))), 8000, "offline cache filled");
  await page.reload(); await waitFor(() => page.evaluate(() => !!navigator.serviceWorker.controller), 5000, "page controlled by the service worker");
  await ctx.route("https://www.gstatic.com/**", r => r.abort());       // the Firebase SDK cannot load offline
  await ctx.setOffline(true);
  await page.reload();
  await captureOn(page, "NO SIGNAL IDEA");
  assert.match(await statusOf(page), /Saved on this device/);
  assert.equal(cloudTexts(fb).records.length, 0);
  await ctx.unroute("https://www.gstatic.com/**");
  await ctx.setOffline(false);
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await waitFor(() => cloudTexts(fb).records.includes("NO SIGNAL IDEA"), 8000, "synced once back online");
  await ctx.close();
});

scenario("main app opened offline from the cache still has a working Vault", async ({ browser, base }) => {
  const fb = createBackend(); fb.set(NODE, seedPlanner());
  const ctx = await browser.newContext({ serviceWorkers: "allow" }); await fb.install(ctx, { user: OWNER });
  const page = await open(ctx, base);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await waitFor(() => page.evaluate(async () => !!(await caches.match(new URL("capture/vault-store.js?v=20261109-vault2", location.href).href))), 8000, "offline cache filled");
  await page.reload(); await waitFor(() => page.evaluate(() => !!navigator.serviceWorker.controller), 5000, "controlled");
  await ctx.route("https://www.gstatic.com/**", r => r.abort());
  await ctx.setOffline(true);
  await page.reload();
  assert.equal(await page.evaluate(() => typeof vaultStore !== "undefined" && !!vaultStore), true, "Vault store loaded from the cache");
  await addInMainApp(page, "OFFLINE MAIN APP IDEA");
  assert.ok((await vaultTexts(page)).includes("OFFLINE MAIN APP IDEA"));
  assert.match(await page.locator("#vaultStatus").textContent(), /saved on this device/i);
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
