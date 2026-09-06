const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.APP_BASE_URL || "http://127.0.0.1:8765";
const BROWSER_EXECUTABLE = process.env.BROWSER_EXECUTABLE;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert(dimensions.content <= dimensions.viewport + 1,
    `${label} overflows horizontally (${dimensions.content}px > ${dimensions.viewport}px)`);
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(BROWSER_EXECUTABLE ? { executablePath: BROWSER_EXECUTABLE } : {}),
  });
  try {
    const artifacts = process.env.ARTIFACT_DIR || path.resolve(__dirname, "..", "test-artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    assert(await page.title() === "ScattaBrain to Genius", "Unexpected ScattaBrain page title");
    assert(await page.locator(".global-navbtn").count() === 2, "ScattaBrain app switcher should have two buttons");
    assert(await page.locator('.global-navbtn[aria-current="page"]').count() === 1, "ScattaBrain current-page state is missing");
    await assertNoHorizontalOverflow(page, "ScattaBrain phone view");

    const stickyPosition = await page.locator(".global-appbar").evaluate(el => getComputedStyle(el).position);
    assert(stickyPosition === "sticky", "ScattaBrain app switcher is not sticky");
    await page.screenshot({ path: path.join(artifacts, "unified-phone-scattabrain.png"), fullPage: false });

    await page.locator('.global-navbtn[href="./mm-home/"]').click();
    await page.waitForURL("**/mm-home/");
    assert(await page.title() === "MM..HOME", "Unexpected MM..HOME page title");
    assert(await page.locator('.app-switch-link[href="../"]').count() === 1, "MM..HOME return button is missing");
    assert(await page.locator("#appNav .navbtn").count() === 6, "MM..HOME should show one app switch plus five page buttons");
    await assertNoHorizontalOverflow(page, "MM..HOME phone view");
    await page.screenshot({ path: path.join(artifacts, "unified-phone-mm-home.png"), fullPage: false });

    await page.locator('button[data-page="calendar"]').click();
    assert((await page.url()).endsWith("/mm-home/#calendar"), "MM..HOME Calendar route did not activate");
    assert(await page.locator('button[data-page="calendar"][aria-current="page"]').count() === 1, "Calendar current-page state is missing");

    await page.locator('.app-switch-link[href="../"]').click();
    await page.waitForURL(url => url.pathname.endsWith("/"));
    assert(await page.title() === "ScattaBrain to Genius", "Return to ScattaBrain failed");

    const registration = await page.evaluate(async () => {
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error("service worker timeout")), 5000)),
      ]);
      return { scope: ready.scope, caches: await caches.keys() };
    });
    assert(registration.scope.endsWith("/"), "Unified service worker scope is incorrect");
    assert(registration.caches.includes("scattabrain-unified-shell-v2"), "Unified app shell cache was not created");

    await context.setOffline(true);
    await page.goto(`${BASE}/mm-home/`, { waitUntil: "domcontentloaded" });
    assert(await page.title() === "MM..HOME", "MM..HOME did not open from the offline cache");
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    assert(await page.title() === "ScattaBrain to Genius", "ScattaBrain did not open from the offline cache");
    await context.setOffline(false);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await assertNoHorizontalOverflow(page, "ScattaBrain desktop view");

    await page.goto(`${BASE}/tests/og-engine.test.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("#summary")?.classList.contains("pass"), null, { timeout: 10000 });
    const engineSummary = await page.locator("#summary").innerText();
    assert(/pass/i.test(engineSummary), `The Other Grind engine tests did not pass: ${engineSummary}`);
    assert(pageErrors.length === 0, `Browser page errors were reported: ${pageErrors.join(" | ")}`);

    console.log("Unified PWA checks passed: phone/desktop layout, navigation, service worker, and Other Grind engine.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
