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

    /* The shared app bar (2026-09-11): the same component on both pages. */
    const checkSharedBar = async (label) => {
      assert(await page.locator('.appbar').evaluate(el => getComputedStyle(el).position) === "sticky", `${label}: app bar is not sticky`);
      assert(/^\d\d:\d\d/.test(await page.locator("#clock").innerText()), `${label}: live clock is missing`);
      assert((await page.locator("#datestrDay").innerText()).length > 0 && /\d{4}$/.test(await page.locator("#datestr").innerText()), `${label}: two-line date is missing`);
      assert(await page.locator(".ab-sb2g img").evaluate(image => image.complete && image.naturalWidth > 0), `${label}: SB2G icon did not load`);
      assert(await page.locator("#appNav > .navbtn").count() === 5, `${label}: expected Home, Calendar, Agenda, Time and Life Admin`);
      assert(await page.locator("#lifeAdminPanel .la-link").count() === 4, `${label}: Life Admin should hold EHAH, Clothing, Chores and Bank`);
      assert(await page.locator(".nav-ico").evaluateAll(images => images.length === 9 && images.every(image => image.complete && image.naturalWidth > 0)), `${label}: nav icons did not load`);
      assert(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(await page.locator("#appNav").innerText()), `${label}: emoji remain in the nav`);
    };

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    assert(await page.title() === "ScattaBrain to Genius", "Unexpected ScattaBrain page title");
    await checkSharedBar("ScattaBrain");
    assert(await page.locator('#sb2gLink[aria-current="page"]').count() === 1, "SB2G current-page state is missing");
    assert(await page.getByText("Personal command center").count() === 0, "Old SB2G subtitle is still rendered");
    assert(await page.locator("#timeView").isHidden() && await page.locator("#nextup").isHidden() && await page.locator("#datesSection").isHidden(), "Grind, Up Next or Important Dates still show on the dashboard");
    for (const id of ["soundToggle", "printBtn", "exportBtn", "importBtn"]) {
      assert(await page.locator(`.tools #${id}`).count() === 1, `SB2G footer is missing #${id}`);
    }
    await assertNoHorizontalOverflow(page, "ScattaBrain phone view");
    await page.screenshot({ path: path.join(artifacts, "unified-phone-scattabrain.png"), fullPage: false });

    await page.locator('#appNav a[data-page="time"]').click();
    assert((await page.url()).endsWith("/#time") && await page.locator("#timeView").isVisible(), "SB2G Time view did not open");
    assert(await page.locator(".og-eyebrow").textContent() === "The Grind", "The Grind label is wrong");

    /* Life Admin: click toggles, Escape closes and returns focus, keyboard opens and reaches links. */
    const trigger = page.locator("#lifeAdminTrigger");
    await trigger.click();
    assert(await trigger.getAttribute("aria-expanded") === "true" && await page.locator("#lifeAdminPanel").isVisible(), "Life Admin did not open on click");
    await assertNoHorizontalOverflow(page, "Life Admin open on a phone");
    await page.keyboard.press("Escape");
    assert(await trigger.getAttribute("aria-expanded") === "false", "Escape did not close Life Admin");
    assert(await trigger.evaluate(el => el === document.activeElement), "Escape did not return focus to Life Admin");
    await page.keyboard.press("Enter");
    assert(await trigger.getAttribute("aria-expanded") === "true", "Enter did not open Life Admin");
    await page.keyboard.press("Tab");
    assert(await page.evaluate(() => document.activeElement.dataset.page) === "ehah", "Tab did not move into the Life Admin links");
    await page.mouse.click(5, 700);
    assert(await trigger.getAttribute("aria-expanded") === "false", "Outside click did not close Life Admin");

    await page.locator('#appNav a[data-page="home"]').click();
    await page.waitForURL("**/mm-home/");
    assert(await page.title() === "MM..HOME", "Unexpected MM..HOME page title");
    await checkSharedBar("MM..HOME");
    assert(await page.locator('#sb2gLink[href="../"]').count() === 1, "MM..HOME return button is missing");
    await assertNoHorizontalOverflow(page, "MM..HOME phone view");
    await page.screenshot({ path: path.join(artifacts, "unified-phone-mm-home.png"), fullPage: false });

    await page.locator('#appNav a[data-page="calendar"]').click();
    assert((await page.url()).endsWith("/mm-home/#calendar"), "MM..HOME Calendar route did not activate");
    assert(await page.locator('#appNav a[data-page="calendar"][aria-current="page"]').count() === 1, "Calendar current-page state is missing");

    await page.locator("#lifeAdminTrigger").click();
    await page.locator('.la-link[data-page="bank"]').click();
    assert((await page.url()).endsWith("/mm-home/#bank") && await page.locator("#bankPage").isVisible(), "Bank did not open from Life Admin");
    assert(await page.locator("#lifeAdminTrigger.is-current").count() === 1, "Life Admin active state is missing on Bank");

    await page.locator('#sb2gLink[href="../"]').click();
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
    assert(registration.caches.some(key => key.startsWith("scattabrain-unified-shell-v5-")), "Unified app shell cache was not created");

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
    assert(/pass/i.test(engineSummary), `The Grind engine tests did not pass: ${engineSummary}`);
    assert(pageErrors.length === 0, `Browser page errors were reported: ${pageErrors.join(" | ")}`);

    console.log("Unified PWA checks passed: shared app bar, Life Admin, Time, Bank, phone/desktop layout, service worker, and Grind engine.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
