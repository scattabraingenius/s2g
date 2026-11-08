// Album Planner checks. Run with a static server at the repo root:
//   python3 -m http.server 8765 --bind 127.0.0.1
//   APP_BASE_URL=http://127.0.0.1:8765 node tests/album-planner.test.cjs
// Synthetic local data; Firebase is blocked, so no real account is touched.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const Sync = require('../audio/album/planner-sync.js');
const BASE = process.env.APP_BASE_URL;
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.ARTIFACT_DIR || path.resolve(ROOT, '../album-planner-verification');
const ctx = {window:{}}; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'audio/tracks.js'), 'utf8'), ctx);
const vocals = ctx.window.ALBUM_SONGS.filter(s => s.session === 'Vocals');
const pick = vocals.slice(0, 110).map(s => s.slug);
const ratings = Object.fromEntries(pick.slice(0, 40).map((s, i) => [s, {score:40 + (i * 7) % 60, at:1}]));
const audioSeed = {v:2, ratings, tracklist:pick.slice(0, 5), custom:{}, pick:{}, collections:{cand:{name:'Album candidates', created:1, members:pick}}};
const pass = m => console.log('PASS ' + m);

{ // Pure sync: tombstones beat stale adds.
  const a = Sync.prepare(Sync.empty());
  const next = JSON.parse(JSON.stringify(a)); next.considered.x = {added:1, del:true}; next.sessions.s1 = {name:'S', created:1, members:['x']};
  const b = Sync.capture(a, next, 'dev1', 10), p = Sync.project(b._sync.records, 'o');
  const del = JSON.parse(JSON.stringify(p)); delete del.considered.x; del.sessions.s1.members = [];
  const merged = Sync.merge(b._sync.records, Sync.capture(p, del, 'dev2', 20)._sync.records), q = Sync.project(merged, 'o');
  assert(!q.considered.x); assert.deepEqual(q.sessions.s1.members, []);
  pass('Planner records merge with tombstones');
}

(async () => {
  fs.mkdirSync(OUT, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.BROWSER_EXECUTABLE || undefined});
  const errors = [];
  try {
    const context = await browser.newContext({viewport:{width:1440, height:1000}});
    await context.route(/gstatic\.com|firebaseio\.com|googleapis\.com/, r => r.abort());
    await context.addInitScript(seed => { if (!localStorage.getItem('seeded')) { localStorage.setItem('grind.audio.v1', seed); localStorage.setItem('seeded', '1'); } }, JSON.stringify(audioSeed));
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    let promptAnswer = 'Theme Album';
    page.on('dialog', d => d.type() === 'prompt' ? d.accept(promptAnswer) : d.accept());

    // Audio Board sort direction.
    await page.goto(BASE + '/audio/classic.html');
    await page.selectOption('#sort', 'title');
    const firstAsc = await page.locator('#list .row b').first().textContent();
    await page.click('#sortDir');
    assert.notEqual(firstAsc, await page.locator('#list .row b').first().textContent());
    await page.reload(); assert.equal((await page.textContent('#sortDir')).trim(), '↓ Desc');
    pass('Audio Board ascending/descending toggle persists');

    // Import 110.
    await page.goto(BASE + '/audio/album/');
    await page.click('#importOpen'); await page.click('[data-import="c:cand"]'); await page.click('#importClose');
    await page.selectOption('#typeFilter', 'all');
    assert.equal(await page.locator('#considerList .card').count(), 110);
    pass('110 takes imported and all visible at once');

    // Inline score: type, Enter jumps to next box; score lands in Audio Board's records.
    await page.selectOption('#groupBy', 'none');
    await page.click('[data-bucket-tab="alive"]');
    const boxes = page.locator('#considerList .score-in');
    await boxes.nth(0).fill('87'); await boxes.nth(0).press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.closest('[data-stem]')?.dataset.stem), await boxes.nth(1).evaluate(e => e.closest('[data-stem]').dataset.stem), 'focus moved to next take');
    await page.keyboard.type('150'); await page.keyboard.press('Enter');
    assert.equal(await boxes.nth(1).inputValue(), '100', 'clamped to 100');
    const stem0 = await page.locator('#considerList .card').nth(0).getAttribute('data-stem');
    const stored = await page.evaluate(s => JSON.parse(localStorage.getItem('grind.audio.v1')).ratings[s].score, stem0);
    assert.equal(stored, 87);
    pass('Score box saves 0-100, clamps, and Enter jumps to the next take');

    // Score and notes are shared with Audio Board; Shortlist/Maybe/Cut are per album and stay in the planner.
    const c0 = page.locator(`.card[data-stem="${stem0}"]`);
    await c0.locator('[data-status="short"]').click();
    assert.equal(await page.locator(`.card[data-stem="${stem0}"] [data-status="short"]`).getAttribute('aria-pressed'), 'true');
    await c0.locator('textarea.note').fill('Hook needs a harder landing');
    await c0.locator('textarea.note').blur();
    await page.goto(BASE + '/audio/classic.html?take=' + stem0);
    const detail = await page.textContent('#detail');
    assert.equal(await page.inputValue('#scoreNum'), '87'); assert.equal(await page.inputValue('#note'), 'Hook needs a harder landing');
    pass('Score and notes from the planner show in Audio Board');

    // Add to current album, Add to another album, new album from the dropdown.
    await page.goto(BASE + '/audio/album/');
    await page.selectOption('#groupBy', 'none'); await page.click('[data-bucket-tab="alive"]');
    const cards = page.locator('#considerList .card');
    const s1 = await cards.nth(1).getAttribute('data-stem'), s2 = await cards.nth(2).getAttribute('data-stem'), s3 = await cards.nth(3).getAttribute('data-stem');
    await page.locator(`.card[data-stem="${s1}"] [data-status="on"]`).click();
    assert.match(await page.locator(`.card[data-stem="${s1}"] [data-status="on"]`).textContent(), /✓ On Album 1/);
    await page.locator(`.card[data-stem="${s2}"] [data-act="menu"]`).click();
    await page.locator(`.card[data-stem="${s2}"] [data-menu="addto"][data-album="second"]`).click();
    promptAnswer = 'Theme Album';
    await page.locator(`.card[data-stem="${s3}"] [data-act="menu"]`).click();
    await page.locator(`.card[data-stem="${s3}"] [data-menu="addto"][data-album="__new"]`).click();
    assert.equal(await page.locator('#targetAlbum option', {hasText:'Theme Album'}).count(), 1);
    assert.match(await page.locator(`.card[data-stem="${s3}"] .badges`).textContent(), /Theme Album #1/);
    pass('Add to album uses the Adding-to album; the ⋯ menu places on others and creates a new album');

    // Cut: per album only.
    await page.locator(`.card[data-stem="${s2}"] [data-status="cut"]`).click(); await page.waitForTimeout(450);
    assert.equal(await page.locator(`.card[data-stem="${s2}"]`).count(), 0, 'cut hidden from All alive');
    await page.click('[data-bucket-tab="cut"]'); assert.equal(await page.locator(`.card[data-stem="${s2}"]`).count(), 1);
    await page.selectOption('#targetAlbum', 'second');
    await page.click('[data-bucket-tab="alive"]'); assert.equal(await page.locator(`.card[data-stem="${s2}"]`).count(), 1, 'still alive for Album 2');
    await page.selectOption('#targetAlbum', 'debut');
    pass('Cut removes a take from the current album only; it stays in the planner');

    // Rename keeps the old Suno name in brackets.
    const s4 = await page.locator('#considerList .card').nth(4).getAttribute('data-stem');
    const oldTitle = vocals.find(v => v.slug === s4).title;
    promptAnswer = 'Kitchen Light';
    await page.locator(`.card[data-stem="${s4}"] [data-act="rename"]`).click();
    assert.equal((await page.locator(`.card[data-stem="${s4}"] .t b`).textContent()).trim(), `Kitchen Light [${oldTitle}]`);
    pass('Rename shows the new name with the Suno name in brackets');

    // Delete tag -> cleanup list -> done removes it from the planner.
    const s5 = await page.locator('#considerList .card').nth(5).getAttribute('data-stem');
    await page.locator(`.card[data-stem="${s5}"] [data-act="menu"]`).click();
    await page.locator(`.card[data-stem="${s5}"] [data-act="delete"]`).click(); await page.waitForTimeout(450);
    assert.equal(await page.locator(`.card[data-stem="${s5}"]`).count(), 0, 'tagged take leaves the buckets');
    await page.click('#tabCleanup');
    assert.equal(await page.locator('.clean-row').count(), 2, 'one delete + one rename');
    await page.locator(`.clean-row[data-stem="${s5}"] [data-del-done]`).check();
    await page.screenshot({path:path.join(OUT, 'cleanup.png')});
    await page.click('#tabConsider'); await page.click('[data-bucket-tab="alive"]');
    assert.equal(await page.locator(`.card[data-stem="${s5}"]`).count(), 0, 'deleted-on-Suno take leaves the planner');
    pass('Delete tags for the Suno cleanup list; ticking it done removes the take');

    // Sessions: same controls, cut sinks and dims.
    await page.click('[data-bucket-tab="alive"]');
    await page.click('#autoGroup');
    // Pick an untouched multi-take song from the current catalogue. Specific
    // recordings such as Dead Souls may legitimately have moved to Suno Trash.
    const affected = new Set([stem0, s1, s2, s3, s4, s5]);
    const groups = new Map();
    for (const take of vocals.filter(v => pick.includes(v.slug))) {
      if (!groups.has(take.baseTitle)) groups.set(take.baseTitle, []);
      groups.get(take.baseTitle).push(take.slug);
    }
    const compareSong = [...groups].find(([, ids]) => ids.length >= 4 && ids.every(id => !affected.has(id)))?.[0];
    assert(compareSong, 'Need an untouched group of at least four takes for session controls');
    await page.locator('#sessionList .session-row', {hasText:compareSong}).click();
    const sc = page.locator('#sessionDetail .card');
    assert(await sc.count() >= 2);
    const firstStem = await sc.first().getAttribute('data-stem');
    await sc.first().locator('[data-status="cut"]').click();
    await page.check('#showExcluded');   // cut takes are hidden unless asked for
    assert.equal(await page.locator('#sessionDetail .card').last().getAttribute('data-stem'), firstStem, 'cut take sinks to the bottom');
    assert.equal(await page.locator('#sessionDetail .card.is-cut').count(), 1);
    await page.locator('#sessionDetail .card:not(.on-album):not(.is-cut)').first().locator('.score-in').fill('77');
    await page.locator('#sessionDetail .card:not(.on-album):not(.is-cut)').first().locator('.score-in').press('Enter');
    await page.locator('#sessionDetail .card:not(.on-album):not(.is-cut)').first().locator('[data-status="on"]').click();
    if (await page.locator('#replaceDialog[open]').count()) await page.click('#replaceBoth');   // the song already has a take on the album
    await page.screenshot({path:path.join(OUT, 'session.png')});
    assert.equal(await page.locator('[data-act="win"], [data-win]').count(), 0, 'no pick-winner');
    pass('Sessions use the same card: score, add, cut (dimmed, sunk), no winner or link-out');

    // Session sort: every option, both directions, cut stays at the bottom.
    await page.locator('#sessionList .session-row', {hasText:compareSong}).click();
    const names = async () => page.locator('#sessionDetail .card:not(.is-cut):not(.is-del) .t b').allTextContents();
    await page.selectOption('#sessionSort', 'title');
    const asc = await names(); assert.deepEqual(asc, [...asc].sort((x, y) => x.localeCompare(y, undefined, {numeric:true})));
    await page.click('#sessionSortDir'); assert.deepEqual(await names(), [...asc].reverse());
    for (const opt of ['score', 'newest', 'status', 'length', 'writer']) { await page.selectOption('#sessionSort', opt); await page.click('#sessionSortDir'); }
    await page.selectOption('#sessionSort', 'newest');
    const sc2 = page.locator('#sessionDetail .card').first(), cutStem = await sc2.getAttribute('data-stem');
    await sc2.locator('[data-status="cut"]').click();
    assert((await page.locator('#sessionDetail .card.is-cut').evaluateAll(els => els.map(e => e.dataset.stem))).includes(cutStem));
    assert.equal(await page.locator('#sessionDetail .card').nth(-2).getAttribute('class').then(c => /is-cut/.test(c)), true, 'cut takes sit at the bottom');
    await page.reload(); await page.click('#tabSessions');
    assert.equal(await page.inputValue('#sessionSort'), 'newest', 'session sort persists');
    pass('Session sort by title, rating, date, status, length and writer, both directions');

    // The one Lyrics control opens the text and a link to the exact lyric version (or a Lyric Board search).
    await page.click('#tabConsider'); await page.click('[data-bucket-tab="alive"]');
    const matched = vocals.find(v => pick.includes(v.slug) && v.versions[0].lyricStem);
    const mc = page.locator(`.card[data-stem="${matched.slug}"]`);
    await mc.locator('[data-act="lyrics"]').click();
    assert.match(await mc.locator('.lyrics-body a').getAttribute('href'), /album-board\/\?song=.*&version=.*returnTo=/);
    const unmatched = vocals.find(v => pick.includes(v.slug) && !v.versions[0].lyricStem);
    const uc = page.locator(`.card[data-stem="${unmatched.slug}"]`);
    await uc.locator('[data-act="lyrics"]').click();
    assert.match(await uc.locator('.lyrics-body a').textContent(), /Find lyrics/);
    assert.match(await uc.locator('.lyrics-body a').getAttribute('href'), /album-board\/\?q=/);
    assert.match(await mc.locator('a', {hasText:'Details'}).getAttribute('href'), /classic\.html\?take=/);
    pass('Each take links to its lyrics (or a Lyric Board search) and its Audio Board details');

    // An open dropdown is not rebuilt by background updates.
    await page.click('#tabConsider');
    await page.evaluate(() => { window.__rebuilds = 0; for (const id of ['sort', 'targetAlbum']) new MutationObserver(() => window.__rebuilds++).observe(document.getElementById(id), {childList:true}); });
    await page.focus('#sort');
    await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {key:'x'})));
    await page.locator('#considerList .score-in').first().fill('55'); await page.locator('#considerList .score-in').first().press('Enter');
    await page.click('[data-bucket-tab="short"]'); await page.click('[data-bucket-tab="alive"]');
    assert.equal(await page.evaluate(() => window.__rebuilds), 0, 'sort/album dropdown options untouched by re-renders');
    pass('Dropdown options are never replaced unless they change');

    // Album page.
    await page.click('#tabAlbums');
    assert.equal(await page.locator('#albumTracks .track').count(), await page.evaluate(() => JSON.parse(localStorage.getItem('grind.planner.v1')).albums.debut.order.length));   // cutting an on-album take in a session takes it off
    await page.screenshot({path:path.join(OUT, 'album.png')});
    await page.click('#tabConsider');
    await page.screenshot({path:path.join(OUT, 'considered.png')});

    await page.reload(); await page.click('#tabConsider');
    assert.equal(await page.locator(`.card[data-stem="${s4}"] .old`).count(), 1, 'rename persists');
    await page.setViewportSize({width:390, height:844});
    for (const tab of ['#tabConsider', '#tabSessions', '#tabAlbums', '#tabCleanup']) {
      await page.click(tab);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert(overflow <= 1, tab + ' overflows by ' + overflow);
    }
    await page.click('#tabConsider'); await page.screenshot({path:path.join(OUT, 'phone.png')});
    pass('Reload persistence and 390px layout without horizontal scroll');
    assert.deepEqual(errors, []);
    console.log('Album Planner checks passed');
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exit(1); });
