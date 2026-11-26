// Offline Chromium: all app assets served from this checkout, no accounts, Suno, or other network.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), origin = 'http://127.0.0.1:8765';
const read = file => { const c = {window:{}}; vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), c); return c.window; };
const byId = xs => new Set(xs.map(x => x.id));
const audio = read('audio/tracks.js'), lyric = read('lyrics/songs.js'), studio = read('studio/catalog.js').STUDIO;
const active = new Set(audio.ALBUM_SONGS.map(t => t.slug));
assert.equal(active.size, 515);
assert.equal(audio.ALBUM_SONGS.length, active.size);
assert.deepEqual(new Set(Object.keys(studio.takeSong)), active);
assert.deepEqual(byId(studio.clips.filter(c => !c.trashed)), active);
assert.deepEqual(byId(studio.clips.filter(c => c.onBoard)), active);
assert.deepEqual(byId(lyric.ALBUM_CLIPS), active);
const counts = read('lyrics/audio-links.js').LYRIC_AUDIO_COUNTS;
const lyricVersions = lyric.ALBUM_SONGS.flatMap(s => s.versions);
assert.equal(lyricVersions.length, 298);
for (const v of lyricVersions) {
  const links = lyric.LYRIC_REVIEW_TAKES[v.stem] || [];
  assert(links.every(t => active.has(t.id) && audio.ALBUM_SONGS.find(x => x.slug === t.id).versions[0].lyricStem === v.stem));
  assert.equal(counts[v.stem] || 0, links.length);
  assert.deepEqual(byId(v.clips || []), byId(links));
}
const newest = audio.ALBUM_SONGS.filter(t => t.versions[0].createdAt.startsWith('2026-11-20'));
assert.equal(newest.length, 6);
const titles = new Map([['For What', 'forwhat'], ['Get Off Your High Horse', 'getoffyourhighhorse'], ['Love is Blind', 'loveisblind']]);
for (const [title, key] of titles) {
  const takes = newest.filter(t => studio.takeSong[t.slug] === key);
  assert.equal(takes.length, 2);
  assert(takes.every(t => t.title === `${title} v2_cue` && !t.versions[0].lyricStem && t.versions[0].suno.lyrics && t.versions[0].suno.style));
}

const A = '11111111-1111-4111-8111-111111111111', R = '99999999-9999-4999-8999-999999999999';
const fixture = {
  '/lyrics/songs.js': 'window.ALBUM_SONGS=[];',
  '/audio/tracks.js': 'window.ALBUM_SONGS=' + JSON.stringify([{slug:A,title:'Fixture v2_CUE  ',versions:[{stem:A, type:'Instrumental', suno:{lyrics:'[Instrumental]', style:'STYLE_TOKEN'}}]}]) + ';',
  '/studio/catalog.js': 'window.STUDIO=' + JSON.stringify({sources:{}, songs:[{key:'fixture',title:'Fixture',lyrics:[],bases:[],newTakes:0}], takeSong:{[A]:'fixture'}, clips:[{id:R,song:'fixture',title:'Retired',trashed:true,onBoard:false}]}) + ';',
};
async function open(browser, synthetic = false) {
  const context = await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const name = url.pathname.endsWith('/') ? url.pathname + 'index.html' : url.pathname;
    if (synthetic && fixture[name]) return route.fulfill({contentType:'application/javascript', body:fixture[name]});
    const file = path.join(root, name);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({status:404, body:''});
    return route.fulfill({path:file});
  });
  if (synthetic) await context.addInitScript(({A,R}) => {
    if (!localStorage.getItem('grind.audio.v1')) localStorage.setItem('grind.audio.v1', JSON.stringify({v:2, ratings:{[A]:{score:0, at:1}, [R]:{score:71, note:'Retain synthetic record', at:1}}}));
    if (!localStorage.getItem('grind.planner.v1')) localStorage.setItem('grind.planner.v1', JSON.stringify({v:1, considered:{[R]:{added:1,del:true}}, albums:{debut:{name:'Fixture',order:[R],cut:[],target:12,statusV:2}}}));
  }, {A,R});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', () => errors.push(1)); // Do not copy exceptions that might include data into logs.
  return {context,page,errors};
}
(async () => {
  const browser = await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE});
  try {
    const real = await open(browser), p = real.page;
    for (const [title, key] of titles) {
      await p.goto(origin + '/studio/');
      await p.getByRole('searchbox', {name:'Search songs', exact:true}).fill(title);
      await p.locator(`#songList [data-song="${key}"]`).click({timeout:3000});
      for (const t of newest.filter(t => studio.takeSong[t.slug] === key)) {
        const card = p.locator(`[data-wrap="${t.slug}"]`);
        assert(await card.isVisible(), 'A Nov 20 take must be visible from its Songs page');
        assert(await card.getByText('Draft not linked', {exact:true}).isVisible());
        assert(await card.getByText('Generation style', {exact:true}).isVisible());
        assert(await card.getByText('Suno lyrics', {exact:true}).isVisible());
        assert(await card.evaluate((el,id) => {
          const take = window.TAKE_SONGS.find(t => t.slug === id).versions[0];
          const val = field => el.querySelector(`[data-copy="take-${field}:${id}"]`)?.closest('.sfield')?.querySelector('pre')?.textContent;
          return val('style') === take.suno.style && val('lyrics') === take.suno.lyrics &&
            el.querySelector('[data-play]')?.getAttribute('href') === `https://suno.com/song/${id}`;
        }, t.slug), 'Rendered fields and URL are owned by the visible take');
        await p.goto(origin + '/studio/?t=' + t.slug);
        assert(await card.isVisible(), 'Direct take URL opens the same card');
      }
    }
    await p.goto(origin + '/audio/album/?view=sort&scope=all');
    assert(await p.evaluate(ids => Object.keys(TAKES).length === ids.length && ids.every(id => Object.hasOwn(TAKES, id)), [...active]), 'Planner catalogue must match the active ID set');
    await p.goto(origin + '/audio/classic.html');
    assert(await p.evaluate(ids => SONGS.length === ids.length && SONGS.every(s => ids.includes(s.slug)), [...active]), 'Classic catalogue must match the active ID set');
    assert.equal(real.errors.length, 0, 'Real-data offline pages had a JS error');
    await real.context.close();
    console.log('PASS: 515 active IDs and lyric links; six Nov 20 takes visible and individually linked from Songs');

    const fake = await open(browser, true), q = fake.page;
    await q.goto(origin + '/studio/?song=fixture');
    const card = q.locator(`[data-wrap="${A}"]`);
    assert(await card.getByText('Draft not linked', {exact:true}).isVisible());
    assert(await card.getByText('Check type', {exact:true}).isVisible());
    assert(await card.getByText('STYLE_TOKEN', {exact:true}).isVisible());
    const toggle = card.getByRole('button', {name:/Take details/});
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await card.locator('[data-choose]').click();
    const score = card.locator('.score-in');
    assert.equal(await score.inputValue(), '0');
    await score.fill('88'); await score.press('Tab');
    await q.reload();
    assert.equal(await score.inputValue(), '88');
    assert.equal(await card.locator('[data-choose]').getAttribute('aria-pressed'), 'true');
    assert(await q.evaluate(({A,R}) => {
      const ratings = JSON.parse(localStorage.getItem('grind.audio.v1')).ratings;
      const plan = window.PlannerApp.state;
      return ratings[A].score === 88 && ratings[R].score === 71 && ratings[R].note === 'Retain synthetic record' &&
        plan.albums.debut.order.includes(R) && plan.considered[R].del;
    }, {A,R}), 'Write/reload must preserve the unavailable take’s stored rating and planner references');
    assert.equal(await q.locator(`[data-wrap="${R}"]`).count(), 0);
    assert.equal(fake.errors.length, 0, 'Synthetic offline page had a JS error');
    console.log('PASS: synthetic type conflict, selection, details toggle, rating persistence and retained unavailable records');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
