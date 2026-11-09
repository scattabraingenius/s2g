/* The capture box, shared by /capture/ and the dashboard's Capture card.

   Enter saves, Shift+Enter adds a line. The text being typed is kept as a draft on every keystroke,
   so a crash or an accidental close never loses it. The box is cleared only after the store has
   written the entry to this device. The status line separates "saved on this device" from
   "synced" (confirmed by the server).

   mount(el, {store, cloud, recent, autofocus, title}) -> {refresh(), focus()} */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrindCapture = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const DRAFT = "grind.capture.draft", PREFS = "grind.capture.v1";
  const TYPES = [["idea", "Idea"], ["bar", "Bar"], ["quote", "Quote"]];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const write = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const time = ms => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function mount(el, opts) {
    const { store, cloud } = opts;
    const prefs = read(PREFS) || {};
    let type = TYPES.some(t => t[0] === prefs.type) ? prefs.type : "idea";
    let last = null;          // {id, durable}
    el.innerHTML = `
      <form class="cap" autocomplete="off">
        <label class="cap-label sr" for="${el.id || "cap"}-text">${esc(opts.title || "Capture an idea")}</label>
        <textarea class="cap-text" id="${el.id || "cap"}-text" rows="${opts.rows || 3}" placeholder="Idea, bar or quote… Enter saves, Shift+Enter for a new line" enterkeyhint="done"></textarea>
        <div class="cap-row">
          <div class="cap-types" role="group" aria-label="Type">${TYPES.map(([v, l]) => `<button type="button" class="cap-type" data-type="${v}" aria-pressed="${v === type}">${l}</button>`).join("")}</div>
          <button type="submit" class="cap-save">Save</button>
        </div>
        <details class="cap-more"><summary>Source</summary><input class="cap-source" type="text" maxlength="500" placeholder="Where it came from (optional)" aria-label="Source"></details>
        <div class="cap-foot"><p class="cap-status" role="status" aria-live="polite"></p><span class="cap-auth"></span></div>
        ${opts.recent ? `<h2 class="cap-recent-title">Recent</h2><ol class="cap-recent" aria-label="Recent entries"></ol>` : ""}
      </form>`;
    const $ = s => el.querySelector(s);
    const text = $(".cap-text"), source = $(".cap-source"), status = $(".cap-status"), auth = $(".cap-auth"), recent = $(".cap-recent");

    const draftKey = DRAFT + (opts.draftKey ? "." + opts.draftKey : "");   // one draft per box, so two open boxes never overwrite each other
    const draft = read(draftKey);
    if (draft && typeof draft.text === "string") { text.value = draft.text; if (draft.source) { source.value = draft.source; $(".cap-more").open = true; } }
    const saveDraft = () => write(draftKey, text.value || source.value ? { text: text.value, source: source.value, at: Date.now() } : null);
    text.addEventListener("input", saveDraft);
    source.addEventListener("input", saveDraft);

    for (const b of el.querySelectorAll(".cap-type")) b.addEventListener("click", () => {
      type = b.dataset.type; write(PREFS, { ...prefs, type });
      for (const x of el.querySelectorAll(".cap-type")) x.setAttribute("aria-pressed", String(x === b));
      text.focus();
    });

    function save() {
      const value = text.value.trim();
      if (!value) { text.focus(); return; }
      const res = store.add({ text: value, type, source: source.value.trim() });
      if (!res.ok) return;
      last = { id: res.id, durable: res.durable };
      if (res.durable) { text.value = ""; source.value = ""; write(draftKey, null); }
      refresh(); text.focus();
    }
    $(".cap").addEventListener("submit", e => { e.preventDefault(); save(); });
    text.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
    });

    function statusLine() {
      const st = store.status(), n = st.pending;
      const signedIn = !!(cloud && cloud.user);
      if (last && !last.durable && store.isPending(last.id)) return ["Not saved on this device (storage is full or blocked). Copy your text before closing.", "bad"];
      if (last && store.isPending(last.id)) {
        const why = !cloud || cloud.state === "unavailable" ? " · offline, will sync later" : !signedIn ? " · sign in to sync" : st.cloud === "error" ? " · sync problem, will retry" : st.cloud === "offline" ? " · offline, will sync later" : " · syncing…";
        return ["Saved on this device" + why, "warn"];
      }
      if (last) return ["Synced" + (st.lastSynced ? " · " + time(st.lastSynced) : ""), "good"];
      if (n) return [`${n} not yet synced` + (signedIn ? "" : " · sign in to sync"), "warn"];
      if (!signedIn) return [cloud && cloud.state === "unavailable" ? "Offline: entries are saved on this device." : "Signed out: entries are saved on this device.", ""];
      if (st.cloud === "error") return [`Sync problem (${st.error}). Entries are safe on this device.`, "warn"];
      return [st.cloud === "synced" ? "All synced" : "Connecting…", ""];
    }
    function refresh() {
      const [msg, cls] = statusLine();
      status.textContent = msg; status.className = "cap-status" + (cls ? " " + cls : "");
      const signedIn = !!(cloud && cloud.user);
      const canSignIn = cloud && cloud.state === "ready" && cloud.authReady && !signedIn;
      auth.innerHTML = canSignIn ? `<button type="button" class="cap-signin">${cloud.busy ? "Signing in…" : "Sign in to sync"}</button>${cloud.error ? ` <span class="cap-err">${esc(cloud.error)}</span>` : ""}` : "";
      const btn = auth.querySelector(".cap-signin"); if (btn) btn.onclick = () => { cloud.signIn(); refresh(); };
      if (recent) {
        const list = store.entries().slice(0, opts.recent);
        recent.innerHTML = list.length ? list.map(e => `<li class="cap-entry">
            <span class="cap-badge type-${esc(e.type)}">${esc(e.type)}</span>
            <span class="cap-entry-text">${esc(e.text)}</span>
            <span class="cap-entry-meta">${store.isPending(e.id) ? `<span class="cap-dot" title="Saved on this device, not yet synced">●</span> ` : ""}${esc(ago(e.created || e.updated))}</span></li>`).join("")
          : `<li class="cap-empty">Nothing yet. Your entries appear here and in the Vault.</li>`;
      }
      opts.onRefresh && opts.onRefresh();
    }
    store.subscribe(refresh);
    if (opts.autofocus) { try { text.focus({ preventScroll: true }); } catch (e) {} }
    refresh();
    return { refresh, focus: () => text.focus() };
  }
  return { mount, DRAFT };
});
