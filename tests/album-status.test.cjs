// Album picks: one status per take, buckets, keyboard triage, guardrails and the tracklist panel.
// Run with a static server at the repo root:
//   python -m http.server 8765 --bind 127.0.0.1
//   APP_BASE_URL=http://127.0.0.1:8765 node tests/album-status.test.cjs
// Synthetic data seeded in the old five-flag format, so the real migration runs in the page. Firebase is blocked.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const BASE = process.env.APP_BASE_URL;
const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.ARTIFACT_DIR || path.resolve(ROOT, '../album-status-verification');
const ctx = {window:{}}; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'audio/tracks.js'), 'utf8'), ctx);
// Keep the named migration/replace scenario synthetic: live catalogue refreshes may
// legitimately remove these takes after Jason moves them to Suno Trash.
const example = ctx.window.ALBUM_SONGS.find(s => s.baseTitle === 'Two People to Mourn' && s.session === 'Vocals');
assert(example, 'Need a source take for the synthetic migration scenario');
for (const [index, suffix] of ['C1.1', 'M1.2', 'M1.1'].entries()) {
  const title = 'Two People to Mourn.' + suffix;
  if (ctx.window.ALBUM_SONGS.some(s => s.title === title)) continue;
  const take = structuredClone(example);
  const id = '10000000-0000-4000-8000-' + String(index + 1).padStart(12, '0');
  take.slug = take.latest = take.versions[0].stem = id;
  take.title = take.versions[0].title = take.versions[0].suno.title = title;
  ctx.window.ALBUM_SONGS.push(take);
}
const vocals = ctx.window.ALBUM_SONGS.filter(s => s.session === 'Vocals');
const bySong = new Map(); for (const v of vocals) { if (!bySong.has(v.baseTitle)) bySong.set(v.baseTitle, []); bySong.get(v.baseTitle).push(v); }
const find = t => vocals.find(v => v.title === t).slug;
const C11 = find('Two People to Mourn.C1.1'), M12 = find('Two People to Mourn.M1.2'), M11 = find('Two People to Mourn.M1.1');
// 15 other songs, one take each, plus C1.1 (#3) and M1.2 (#6): 17 tracks on a 12-track album.
const singles = [...bySong.values()].filter(l => l.length >= 2 && l[0].baseTitle !== 'Two People to Mourn');
const others = singles.slice(0, 15).map(l => l[0].slug);
const order = others.slice(); order.splice(2, 0, C11); order.splice(5, 0, M12);
assert.equal(order.length, 17);
const pool = vocals.map(v => v.slug).filter(s => !order.includes(s) && s !== singles[0][1].slug).slice(0, 60);
const considered = Object.fromEntries([...order, ...pool, M11, singles[0][1].slug].map(s => [s, {added:1}]));
const cutStem = pool[0], shortStem = pool[1], maybeStem = pool[2];
const planSeed = {considered, sessions:{}, albums:{debut:{name:'Album 1 · Debut', created:1, order, cut:[cutStem], target:12}, second:{name:'Album 2', created:2, order:[], cut:[], target:12}}};
const ratings = {[M12]:{status:'maybe', score:70, at:1}, [shortStem]:{status:'short', at:1}, [maybeStem]:{status:'maybe', at:1}, [C11]:{score:90, at:1}};
const audioSeed = {v:2, ratings, tracklist:[], custom:{}, pick:{}, collections:{}};
const pass = m => console.log('PASS ' + m);

(async () => {
  fs.mkdirSync(OUT, {recursive:true});
  const browser = await chromium.launch({headless:true, executablePath:process.env.BROWSER_EXECUTABLE || undefined});
  const errors = [];
  try {
    const context = await browser.newContext({viewport:{width:1440, height:1000}});
    const blocked = [];
    await context.route('**/*', r => { if (new URL(r.request().url()).origin === new URL(BASE).origin) return r.continue(); blocked.push(r.request().url()); return r.abort(); });
    await context.route('**/audio/tracks.js', r => r.fulfill({contentType:'text/javascript', body:
      'window.BOARD_KIND="audio";window.ALBUM_SONGS='+JSON.stringify(ctx.window.ALBUM_SONGS)+';window.ALBUM_SESSIONS='+JSON.stringify(ctx.window.ALBUM_SESSIONS)+';'}));
    await context.addInitScript(([plan, audio]) => { if (!localStorage.getItem('seeded')) { localStorage.setItem('grind.planner.v1', plan); localStorage.setItem('grind.audio.v1', audio); localStorage.setItem('seeded', '1'); } }, [JSON.stringify(planSeed), JSON.stringify(audioSeed)]);
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', d => d.accept());
    const plan = () => page.evaluate(() => JSON.parse(localStorage.getItem('grind.planner.v1')));
    const counts = async () => {
      const tabs = await page.locator('#bucketTabs [data-bucket-tab]').evaluateAll(els => Object.fromEntries(els.map(e => [e.dataset.bucketTab, Number(e.querySelector('small').textContent)])));
      return {...tabs, total:Number((await page.textContent('.bucket-total')).replace(/\D/g, ''))};
    };
    const cards = () => page.locator('#considerList .card:not(.leaving)');
    const focusedStem = () => page.evaluate(() => document.activeElement?.closest?.('.card')?.dataset.stem);
    const toastText = () => page.textContent('#toastText');
    const settle = () => page.waitForTimeout(450);

    await page.goto(BASE + '/audio/album/?view=consider');
    await page.selectOption('#typeFilter', 'all');   // counts below cover every recording type
    await page.waitForSelector('#bucketTabs [data-bucket-tab]');

    // --- Migration ran on load: backup, log, and the owner's example ---
    const p0 = await plan();
    assert(p0.albums.debut.statusV >= 2 && p0.albums.second.statusV >= 2, 'albums converted');
    assert(await page.evaluate(() => !!localStorage.getItem('grind.planner.v1.premigration')), 'backup written first');
    const log = await page.evaluate(() => JSON.parse(localStorage.getItem('grind.planner.v1.migration')));
    const hit = log.runs[0].conflicts.find(c => c.stem === M12 && c.album === 'debut');
    assert(hit && hit.flags.join('+') === 'On album+Maybe' && hit.result === 'On album', 'conflict logged');
    assert.equal(p0.albums.debut.order.indexOf(M12), 5, 'position kept');
    assert.equal(p0.considered[M12].marks?.debut, undefined, 'no Maybe left on Album 1');
    assert(await page.locator('#migrationNotice').isVisible(), 'notice shown');
    await page.click('#noticeReview'); assert.match(await page.textContent('#logBody'), /Two People to Mourn\.M1\.2/); assert.match(await page.textContent('#logBody'), /On album \+ Maybe/);
    await page.click('#logClose'); await page.reload(); await page.waitForSelector('#bucketTabs [data-bucket-tab]');
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('grind.planner.v1.migration')))).runs.length, 1, 'does not run twice');
    assert.equal(await page.locator('#migrationNotice').isVisible(), false, 'notice stays dismissed');
    pass('Migration backs up, logs Two People to Mourn.M1.2 as On album with no Maybe, and does not run twice');

    // --- Names, tabs, counts ---
    assert.match(await page.textContent('#tabSort'), /^Triage/); assert.match(await page.textContent('#tabConsider'), /^Album picks/);
    for (const gone of ['#groupToggle', '#scopeChips', '#filterChips']) assert.equal(await page.locator(gone).count(), 0, gone + ' removed');
    assert.deepEqual(await page.locator('#bucketTabs [data-bucket-tab]').allTextContents().then(a => a.map(t => t.replace(/\s*\d+$/, ''))), ['Unreviewed', 'Maybe', 'Shortlist', 'On album', 'Cut', 'All alive']);
    assert.equal(await page.locator('#bucketTabs [aria-selected="true"]').getAttribute('data-bucket-tab'), 'unreviewed', 'defaults to Unreviewed');
    let c = await counts();
    assert.equal(c.unreviewed + c.maybe + c.short + c.on + c.cut, c.total, 'counts add up to the total');
    assert.equal(c.on, 17); assert.equal(c.cut, 1); assert.equal(c.short, 1);
    assert.equal(c.alive, c.total - c.cut);
    assert.equal(await cards().count(), c.unreviewed);
    pass('Triage / Album picks names, five buckets default to Unreviewed, counts add up to the total');

    // --- Card layout ---
    const first = cards().first(), s0 = await first.getAttribute('data-stem');
    assert.deepEqual(await first.locator('.status-seg .seg').allTextContents(), ['Maybe', 'Shortlist', '+ Album 1', 'Cut']);
    assert.equal(await first.locator('button').filter({hasText:/^Delete$/}).and(page.locator(':visible')).count(), 1, 'Delete is a visible button on the card, outside the menu');
    assert.equal(await first.locator('.lyrics-body').isHidden(), true);
    assert.equal(await first.locator('.score-box span').textContent(), 'Score');
    assert.equal(await first.locator('[data-act="lyrics"]').count(), 1, 'one Lyrics control');
    assert.equal(await first.locator('a, button').filter({hasText:/^Lyrics/}).count(), 1);
    await first.locator('[data-act="menu"]').click();
    assert.deepEqual((await first.locator('.menu button').allTextContents()).map(t => t.trim()), ['Add to Album 2', 'Add to new album…', 'Compare']);
    await page.keyboard.press('Escape'); assert.equal(await first.locator('.menu').isHidden(), true);
    await first.locator('[data-act="lyrics"]').click(); assert.equal(await first.locator('.lyrics-body').isVisible(), true);
    await first.locator('[data-act="lyrics"]').click();
    assert.equal(await first.locator('.decision').count(), 0, 'no In contention / Selected text line');
    pass('Card: one status control, three media buttons, ⋯ holds Add to / Compare / Delete, Lyrics once, labelled Score');

    // --- Tagging collapses the card, Undo restores it, focus moves on ---
    const cs = await cards().evaluateAll(els => els.map(e => e.dataset.stem));
    await first.locator('[data-status="short"]').click();
    await page.waitForSelector(`#considerList .card.leaving[data-stem="${s0}"]`, {timeout:1000});
    await settle();
    assert.equal(await page.locator(`#considerList .card[data-stem="${s0}"]`).count(), 0, 'card gone from Unreviewed');
    assert.equal(await focusedStem(), cs[1], 'focus moved to the next card');
    assert.match(await toastText(), /→ Shortlist/); assert(await page.locator('#toastUndo').isVisible());
    let c2 = await counts(); assert.equal(c2.unreviewed, c.unreviewed - 1); assert.equal(c2.short, c.short + 1); assert.equal(c2.total, c.total);
    await page.click('#toastUndo'); await page.waitForSelector(`#considerList .card[data-stem="${s0}"]`);
    assert.deepEqual(await counts(), c, 'Undo restores the counts'); assert.equal(await focusedStem(), s0, 'Undo puts focus on the restored take');
    pass('Tagging collapses the card, names the change with Undo, moves focus; Undo restores');

    // --- Keyboard ---
    await page.click('#q'); await page.keyboard.type('scm z?'); await page.fill('#q', ''); await page.evaluate(() => document.activeElement.blur());
    assert.deepEqual(await counts(), c, 'no shortcut fired while typing in search');
    await page.evaluate(() => document.activeElement?.blur()); await page.locator('body').click({position:{x:5, y:5}});
    await page.keyboard.press('j');
    const k0 = await focusedStem(); assert(k0);
    await page.keyboard.press('j'); const k1 = await focusedStem(); assert.notEqual(k1, k0);
    await page.keyboard.press('k'); assert.equal(await focusedStem(), k0);
    await first.locator('.score-in').first().click(); await page.keyboard.type('72s m c'); await page.locator('body').click({position:{x:5, y:5}});
    assert.equal(await page.evaluate(s => JSON.parse(localStorage.getItem('grind.audio.v1')).ratings[s].score, s0), 72, 'score box takes digits');
    assert.deepEqual(await counts(), c, 'no shortcut fired in the score box');
    await page.locator(`.card[data-stem="${s0}"] textarea.note`).click(); await page.keyboard.type('s m a c u z'); await page.locator('body').click({position:{x:5, y:5}});
    assert.deepEqual(await counts(), c, 'no shortcut fired in notes');
    await page.keyboard.press('j'); await page.keyboard.press('k'); assert.equal(await focusedStem(), s0, 'back on the first card');
    await page.keyboard.press('m'); await settle(); assert.equal((await counts()).maybe, c.maybe + 1);
    assert.match(await toastText(), /→ Maybe/);
    await page.keyboard.press('z'); await page.waitForSelector(`#considerList .card[data-stem="${s0}"]`); assert.deepEqual(await counts(), c, 'Z undoes');
    await page.keyboard.press('c'); await settle(); assert.equal((await counts()).cut, c.cut + 1);
    await page.keyboard.press('z'); await page.waitForSelector(`#considerList .card[data-stem="${s0}"]`);
    await page.keyboard.press('s'); await settle(); assert.equal((await counts()).short, c.short + 1);
    await page.click('[data-bucket-tab="short"]'); assert(await page.locator(`.card[data-stem="${s0}"]`).count());
    await page.locator(`.card[data-stem="${s0}"]`).focus(); await page.keyboard.press('u'); await settle();
    assert.deepEqual(await counts(), c, 'U goes back to Unreviewed');
    await page.click('[data-bucket-tab="unreviewed"]');
    await page.keyboard.press('?'); assert(await page.locator('#keysDialog').isVisible()); await page.click('#keysClose');
    assert.match(await page.textContent('#keyHint'), /S shortlist · M maybe · A album · C cut · Z undo · \? all keys/);
    await page.locator(`.card[data-stem="${s0}"]`).focus();
    assert(await page.locator(`.card[data-stem="${s0}"]`).evaluate(el => getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) >= 2), 'focused card has a visible ring');
    pass('Keyboard: S M C U Z J K ? work, nothing fires while typing, hint line replaced');

    // --- Space plays: opens the take on Suno ---
    await page.locator(`.card[data-stem="${s0}"]`).focus();
    const [popup] = await Promise.all([context.waitForEvent('page'), page.keyboard.press(' ')]);
    await popup.waitForLoadState().catch(() => {}); assert(blocked.some(u => u === 'https://suno.com/song/' + s0), 'opened the take on Suno'); await popup.close();
    pass('Space opens the focused take on Suno');

    // --- Desktop: every Play reuses one player tab, so the last take stops when the next one loads ---
    const playLinks = page.locator('#considerList .card:not(.leaving) a[data-play]');
    const idOf = async i => (await playLinks.nth(i).getAttribute('href')).split('/').pop();
    const pagesBefore = context.pages().length;
    const [player] = await Promise.all([context.waitForEvent('page'), playLinks.nth(0).click()]);
    await player.waitForLoadState().catch(() => {});
    assert.equal(context.pages().length, pagesBefore + 1, 'first Play opens the player tab');
    await playLinks.nth(1).click(); await page.waitForTimeout(400);
    await playLinks.nth(2).click(); await page.waitForTimeout(400);
    assert.equal(context.pages().length, pagesBefore + 1, 'later Plays reuse it instead of opening more tabs');
    for (const i of [0, 1, 2]) assert(blocked.includes('https://suno.com/song/' + await idOf(i)), 'take ' + i + ' was loaded into the player tab');
    await player.close();
    pass('Play reuses one desktop player tab');

    // --- Album guardrails ---
    assert.match(await page.textContent('#targetStats'), /17\/12 tracks · 5 over target/);
    assert.equal(await page.locator('#targetStats .tstat.bad').count(), 1, '5 over a 12-track target is red');
    await page.click('[data-bucket-tab="on"]');
    const head = await page.locator('.group', {has:page.locator('h3', {hasText:'Two People to Mourn'})}).locator('header h3').textContent();
    assert.match(head, /2 takes on album/); assert.match(head, /⚠/);
    assert.equal(await page.locator('.card .badge.warn').count() >= 2, true, 'warning on both tracks');
    assert.equal(await page.locator('#panelBody .ptrack.twin').count(), 2, 'warning on both tracks in the tracklist');
    await page.click('[data-bucket-tab="unreviewed"]');
    // Adding a third take of the song asks; Keep both leaves a warning on all three.
    await page.locator('#songFilter').selectOption('Two People to Mourn'); await page.click('[data-bucket-tab="alive"]');
    await page.locator(`.card[data-stem="${M11}"] [data-status="on"]`).click();
    assert.match(await page.textContent('#replaceTitle'), /^Replace C1\.1 and M1\.2 with M1\.1 on Album 1\?$/);
    await page.click('#replaceBoth'); await settle();
    assert.equal((await plan()).albums.debut.order.length, 18);
    assert.equal(await page.locator('#panelBody .ptrack.twin').count(), 3);
    // Replace swaps in place and sends the old take to Shortlist.
    await page.locator('#songFilter').selectOption('');
    const [a1, a2] = singles[0].length >= 2 ? [singles[0][1].slug, singles[0][0].slug] : [];
    await page.click('[data-bucket-tab="alive"]');
    await page.locator('#songFilter').selectOption(singles[0][0].baseTitle);
    const before = (await plan()).albums.debut.order, pos = before.indexOf(singles[0][0].slug);
    await page.locator(`.card[data-stem="${a1}"] [data-status="on"]`).click();
    assert.match(await page.textContent('#replaceTitle'), /^Replace .+ with .+ on Album 1\?$/);
    await page.click('#replaceYes'); await settle();
    const after = await plan();
    assert.equal(after.albums.debut.order.indexOf(a1), pos, 'new take takes the old position'); assert(!after.albums.debut.order.includes(a2));
    assert.equal(after.considered[a2].marks.debut, 'short');
    await page.locator('#songFilter').selectOption('');
    pass('Over-target warning, one-take-per-song prompt (Replace / Keep both), song status in group headers');

    // --- Sticky tracklist panel: order, lengths, total, drag to reorder ---
    await page.click('[data-bucket-tab="unreviewed"]');
    assert(await page.locator('#trackPanel').isVisible());
    const o = (await plan()).albums.debut.order;
    assert.equal(await page.locator('#panelBody .ptrack').count(), o.length);
    assert.match(await page.textContent('#panelBody .ptrack .pd'), /^\d+:\d\d$/);
    const total = o.reduce((n, s) => n + (vocals.find(v => v.slug === s)?.versions[0].duration || 0), 0);
    assert.match(await page.textContent('.ptotal-line'), new RegExp(`${Math.floor(total / 3600) ? Math.floor(total / 3600) + 'h ' : ''}${Math.floor(total % 3600 / 60)}m`));
    assert.match(await page.textContent('#panelBody .tstat-line'), /over target/);
    const items = page.locator('#panelBody .ptrack');
    await items.nth(0).dragTo(items.nth(3), {targetPosition:{x:20, y:20}});
    const o2 = (await plan()).albums.debut.order; assert.equal(o2[3], o[0]); assert.equal(o2.length, o.length);
    await page.locator('#panelBody .ptrack').nth(1).locator('[data-move="-1"]').click();
    assert.equal((await plan()).albums.debut.order[0], o2[1]);
    pass('Sticky tracklist panel lists tracks with lengths, running total, over-target warning, drag to reorder');

    // --- Triage keeps its buckets, Delete only in ⋯, tagging delete hides from Album picks ---
    await page.click('#tabSort');
    assert.equal(await page.locator('#sortList .card [data-bucket]').filter({hasText:/Delete/}).count(), 0);
    const t0 = await page.locator('#sortList .card').first().getAttribute('data-stem');
    await page.locator(`#sortList .card[data-stem="${t0}"] [data-act="menu"]`).click();
    await page.locator(`#sortList .card[data-stem="${t0}"] [data-act="delete"]`).click(); await settle();
    assert.equal((await plan()).considered[t0].del, true);
    await page.click('#tabConsider'); await page.click('[data-bucket-tab="alive"]');
    assert.equal(await page.locator(`.card[data-stem="${t0}"]`).count(), 0, 'tagged takes are hidden from the buckets');
    c = await counts(); assert.equal(c.unreviewed + c.maybe + c.short + c.on + c.cut, c.total);
    await page.click('#tabCleanup'); await page.locator(`.clean-row[data-stem="${t0}"] [data-untag]`).click();
    assert.equal((await plan()).considered[t0].del, undefined);
    await page.click('#tabConsider');
    pass('Delete lives in ⋯, tagged takes leave the buckets, Keep on the cleanup page brings one back');

    // --- Grouping: one dropdown ---
    await page.selectOption('#groupBy', 'none'); assert.equal(await page.locator('#considerList .group').count(), 0);
    await page.selectOption('#groupBy', 'song'); assert(await page.locator('#considerList .group').count() > 0);
    await page.screenshot({path:path.join(OUT, 'desktop.png')});
    pass('Group by song/none is one dropdown; the duplicate button is gone');

    // --- Phone ---
    await page.setViewportSize({width:390, height:844});
    for (const tab of ['#tabSort', '#tabConsider', '#tabSessions', '#tabAlbums', '#tabCleanup']) {
      await page.click(tab);
      assert((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, tab + ' overflows at 390px');
    }
    await page.click('#tabConsider');
    const box = await page.locator('#trackPanel').boundingBox(); assert(box.y > 700, 'panel is a bottom bar');
    assert.equal(await page.locator('#panelBody').isVisible(), false);
    await page.click('#panelBar'); assert.equal(await page.locator('#panelBody').isVisible(), true);
    await page.screenshot({path:path.join(OUT, 'phone-panel.png')});
    await page.click('#panelBar');
    await page.locator('#considerList .card').first().locator('[data-status="short"]').click(); await settle();
    assert((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
    await page.screenshot({path:path.join(OUT, 'phone.png')});
    pass('Everything works at phone width: no horizontal scroll, tracklist is a bottom bar that expands');

    assert.deepEqual(errors, []);
    console.log('Album status checks passed');
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exit(1); });
