/* Dashboard layout: which cards show, in what order, and how wide, per named layout.

   Saved in grind.dashboard.v1 under `layouts[name]`, on this browser only (never synced). The name
   comes from ?layout=<name>, so two dashboard windows in one browser profile can each keep their own
   arrangement. Widths are stored as a fraction of the row, not a column count, so one layout reads
   the same on a phone, a 1920 monitor and a 4K wall screen: "half the row" stays half the row.

   The pure functions are exported for tests. mount() wires the DOM: column count from the grid's
   own width, card order and spans, and an Edit layout mode with move, resize, hide and drag. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrindLayout = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const MIN_COL = 280, GAP = 14, MAX_COLS = 8;

  function colsFor(width, min = MIN_COL, gap = GAP, max = MAX_COLS) {
    if (!Number.isFinite(width) || width <= 0) return 1;
    return Math.max(1, Math.min(max, Math.floor((width + gap) / (min + gap))));
  }
  function layoutName(search) {
    let raw = "";
    try { raw = new URLSearchParams(search || "").get("layout") || ""; } catch (e) {}
    const name = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 32);
    return name || "default";
  }
  const clampFrac = f => Number.isFinite(f) ? Math.min(1, Math.max(0.01, f)) : null;

  /* Saved layout + card registry -> a complete layout. Unknown ids are dropped, cards added to the
     registry later are appended at the end with their default width, and bad widths fall back. */
  function resolve(saved, registry) {
    const ids = registry.map(c => c.id);
    const s = saved && typeof saved === "object" ? saved : {};
    const order = (Array.isArray(s.order) ? s.order : []).filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i);
    for (const id of ids) if (!order.includes(id)) order.push(id);
    const frac = {};
    for (const c of registry) frac[c.id] = clampFrac(s.frac && s.frac[c.id]) ?? c.frac;
    const hidden = (Array.isArray(s.hidden) ? s.hidden : []).filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i);
    return {order, frac, hidden};
  }
  /* Halves round down (1.5 columns -> 1), so a row of shares that adds up to 1 (a quarter, a quarter,
     a half) still fits on one row at 6 columns instead of spilling over. */
  function spanFor(frac, cols) { return Math.max(1, Math.min(cols, Math.ceil(frac * cols - 0.5))); }
  /* Spans for the visible cards in order. When the next card does not fit on a row, the row's last
     card stretches to the end, so no screen width leaves a hole beside a card. The very last card
     keeps its own width, so "Narrower" on it always does something visible. Order never changes. */
  function packSpans(layout, cols) {
    const ids = layout.order.filter(id => !layout.hidden.includes(id)), out = {};
    let used = 0, last = null;
    for (const id of ids) {
      const s = spanFor(layout.frac[id], cols);
      if (used + s > cols) { if (last) out[last] += cols - used; used = 0; }
      out[id] = s; used += s; last = id;
    }
    return out;
  }

  /* Move a card one place earlier (-1) or later (+1) among the visible cards. */
  function move(layout, id, delta) {
    const visible = layout.order.filter(x => !layout.hidden.includes(x));
    const i = visible.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= visible.length) return layout;
    const other = visible[j], order = layout.order.slice();
    const a = order.indexOf(id), b = order.indexOf(other);
    order[a] = other; order[b] = id;
    return {...layout, order};
  }
  /* Place `id` directly before `beforeId` (or at the end when beforeId is null). */
  function place(layout, id, beforeId) {
    if (id === beforeId) return layout;
    const order = layout.order.filter(x => x !== id);
    const at = beforeId == null ? order.length : order.indexOf(beforeId);
    order.splice(at < 0 ? order.length : at, 0, id);
    return {...layout, order};
  }
  /* Wider or narrower by one of the current columns. */
  function resize(layout, id, delta, cols) {
    const span = Math.max(1, Math.min(cols, spanFor(layout.frac[id], cols) + delta));
    return {...layout, frac: {...layout.frac, [id]: span / cols}};
  }
  function setHidden(layout, id, hide) {
    const hidden = layout.hidden.filter(x => x !== id);
    if (hide) hidden.push(id);
    return {...layout, hidden};
  }

  /* ---------------- DOM ---------------- */
  function mount(opts) {
    const {grid, registry, prefs, save, search, onResize, bar, toggle} = opts;
    const name = layoutName(search);
    const store = () => { prefs.layouts = prefs.layouts && typeof prefs.layouts === "object" ? prefs.layouts : {}; return prefs.layouts; };
    let layout = resolve(store()[name], registry), cols = 4, editing = false;
    const cards = new Map(registry.map(c => [c.id, grid.querySelector(`[data-card="${c.id}"]`)]).filter(([, el]) => el));
    const title = id => (registry.find(c => c.id === id) || {}).title || id;

    function persist() { store()[name] = {order: layout.order, frac: layout.frac, hidden: layout.hidden}; save(); }
    function apply() {
      grid.style.setProperty("--cols", cols);
      const want = layout.order.map(id => cards.get(id)).filter(Boolean);
      if (want.some((el, i) => grid.children[i] !== el)) for (const el of want) grid.appendChild(el);
      const spans = packSpans(layout, cols);
      for (const id of layout.order) {
        const el = cards.get(id); if (!el) continue;
        el.hidden = layout.hidden.includes(id);
        el.style.gridColumn = el.hidden ? "" : `span ${spans[id]}`;
      }
      if (editing) paintBar();
    }
    function measure() {
      const next = colsFor(grid.clientWidth);
      if (next !== cols) { cols = next; apply(); }
    }

    /* Edit mode: a toolbar on each card, plus a bar listing hidden cards with Reset and Done. */
    function tools(id) {
      const t = document.createElement("div");
      t.className = "card-tools";
      t.innerHTML = `<button type="button" class="ct-drag" data-act="drag" aria-label="Drag ${title(id)}" title="Drag to move">⠿</button>
        <button type="button" data-act="prev" aria-label="Move ${title(id)} earlier" title="Move earlier">◀</button>
        <button type="button" data-act="next" aria-label="Move ${title(id)} later" title="Move later">▶</button>
        <button type="button" data-act="narrow" aria-label="Make ${title(id)} narrower" title="Narrower">−</button>
        <button type="button" data-act="wide" aria-label="Make ${title(id)} wider" title="Wider">+</button>
        <button type="button" data-act="hide" aria-label="Hide ${title(id)}" title="Hide">Hide</button>`;
      t.addEventListener("click", e => {
        const act = e.target.closest("button")?.dataset.act; if (!act || act === "drag") return;
        if (act === "prev" || act === "next") layout = move(layout, id, act === "prev" ? -1 : 1);
        if (act === "narrow" || act === "wide") layout = resize(layout, id, act === "wide" ? 1 : -1, cols);
        if (act === "hide") layout = setHidden(layout, id, true);
        persist(); apply();
        const again = act === "hide" ? bar.querySelector("button") : cards.get(id).querySelector(`[data-act="${act}"]`);
        again?.focus();
      });
      t.querySelector(".ct-drag").addEventListener("pointerdown", e => startDrag(e, id));
      return t;
    }
    function paintBar() {
      const hidden = layout.hidden.filter(id => cards.has(id));
      bar.innerHTML = `<span class="lb-name">Editing layout <b>${name}</b></span>
        ${hidden.length ? `<span class="lb-hidden">Hidden: ${hidden.map(id => `<button type="button" class="chip" data-show-card="${id}">+ ${title(id)}</button>`).join(" ")}</span>` : ""}
        <span class="lb-actions"><button type="button" class="chip" data-lb="reset">Reset</button><button type="button" class="chip on" data-lb="done">Done</button></span>`;
    }
    bar.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.showCard) { layout = setHidden(layout, b.dataset.showCard, false); persist(); apply(); }
      else if (b.dataset.lb === "reset") { delete store()[name]; save(); layout = resolve(null, registry); apply(); }
      else if (b.dataset.lb === "done") setEditing(false);
    });
    function setEditing(on) {
      editing = on;
      document.body.classList.toggle("editing", on);
      bar.hidden = !on;
      toggle.setAttribute("aria-pressed", String(on));
      for (const [id, el] of cards) {
        el.querySelector(":scope > .card-tools")?.remove();
        if (on) el.prepend(tools(id));
      }
      if (on) paintBar(); else toggle.focus();
    }
    toggle.addEventListener("click", () => setEditing(!editing));

    /* Drag: hovering another card moves this one before or after it, depending on which half of that
       card the pointer is over. Saved on release. Listens on the window rather than capturing the
       pointer, because moving the card in the DOM would drop a capture mid-drag. */
    function startDrag(e, id) {
      e.preventDefault();
      const el = cards.get(id), handle = globalThis;
      el.classList.add("dragging");
      const moveTo = ev => {
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-card]");
        if (!target || target === el || target.hidden) return;
        const box = target.getBoundingClientRect(), after = ev.clientX > box.left + box.width / 2;
        const tid = target.dataset.card, order = layout.order.filter(x => x !== id);
        const next = after ? order[order.indexOf(tid) + 1] ?? null : tid;
        layout = place(layout, id, next); apply();
      };
      const end = () => {
        el.classList.remove("dragging");
        handle.removeEventListener("pointermove", moveTo);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        persist();
      };
      handle.addEventListener("pointermove", moveTo);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    }

    /* Column count follows the grid's own width; each card also reports its own size changes so its
       charts redraw when only the card changes (a wider span, edit mode), not just the window. */
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(measure).observe(grid);
      const seen = new Map();
      const ro = new ResizeObserver(entries => {
        for (const en of entries) {
          const id = en.target.dataset.card, w = Math.round(en.contentRect.width);
          if (seen.get(id) === w) continue;
          seen.set(id, w);
          onResize?.(id);
        }
      });
      for (const el of cards.values()) ro.observe(el);
    } else {
      globalThis.addEventListener?.("resize", measure);
    }
    measure(); apply();
    return {name, get layout() { return layout; }, get cols() { return cols; }, setEditing};
  }

  return {colsFor, layoutName, resolve, spanFor, packSpans, move, place, resize, setHidden, mount, MIN_COL, MAX_COLS};
});
