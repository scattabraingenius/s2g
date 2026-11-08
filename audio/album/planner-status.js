/* Album Planner status model: every take has exactly one status per album.
   Unreviewed → Maybe → Shortlist → On album, and any of them can become Cut.
   Where each status lives (so it syncs inside records the planner already has):
     On album  — the album's `order` list (the position is the status)
     Cut       — the album's `cut` list
     Maybe / Shortlist — `considered[stem].marks[albumId]`
     Unreviewed — none of the above
   Score, notes and delete tags are separate and untouched here. An album with `statusV: 2` has been
   migrated; older albums are read through legacyStatus() until they are. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PlannerStatus = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const VERSION = 2;
  const STATUSES = ["unreviewed", "maybe", "short", "on", "cut"];
  const LABELS = {unreviewed:"Unreviewed", maybe:"Maybe", short:"Shortlist", on:"On album", cut:"Cut"};
  const isMigrated = album => (album?.statusV | 0) >= VERSION;

  // ---- the old five overlapping flags, still readable until an album is migrated ----
  function legacyFlags(plan, ratings, stem, id) {
    const album = plan.albums[id], rating = ratings?.[stem] || {}, flags = [];
    if (album.order.includes(stem)) flags.push("on");
    if (album.cut.includes(stem)) flags.push("cut");
    if (rating.status === "cut") flags.push("audio-cut");
    if (rating.status === "short") flags.push("short");
    if (rating.status === "maybe") flags.push("maybe");
    return flags;
  }
  // First matching rule wins: On album, Cut, Shortlist, Maybe, otherwise Unreviewed.
  function legacyStatus(plan, ratings, stem, id) {
    const flags = legacyFlags(plan, ratings, stem, id);
    if (flags.includes("on")) return "on";
    if (flags.includes("cut") || flags.includes("audio-cut")) return "cut";
    // A mark already written for this album (another device converted it first) beats the old global flag.
    const mark = plan.considered[stem]?.marks?.[id];
    if (mark === "short" || mark === "maybe") return mark;
    return flags.includes("short") ? "short" : flags.includes("maybe") ? "maybe" : "unreviewed";
  }
  function statusOf(plan, ratings, stem, id) {
    const album = plan.albums[id];
    if (!album) return "unreviewed";
    if (!isMigrated(album)) return legacyStatus(plan, ratings, stem, id);
    if (album.order.includes(stem)) return "on";
    if (album.cut.includes(stem)) return "cut";
    const mark = plan.considered[stem]?.marks?.[id];
    return mark === "short" || mark === "maybe" ? mark : "unreviewed";
  }

  // Set exactly one status for (take, album). `index` places an On album take at a track position.
  function set(plan, stem, id, status, index = -1, now = Date.now()) {
    const album = plan.albums[id], item = plan.considered[stem] ||= {added:now};
    album.order = album.order.filter(m => m !== stem);
    album.cut = album.cut.filter(m => m !== stem);
    if (item.marks) { delete item.marks[id]; if (!Object.keys(item.marks).length) delete item.marks; }
    if (status === "maybe" || status === "short") (item.marks ||= {})[id] = status;
    else if (status === "cut") album.cut.push(stem);
    else if (status === "on") {
      for (const other of Object.values(plan.albums)) other.order = other.order.filter(m => m !== stem);   // a take sits on one album
      album.order.splice(index < 0 || index > album.order.length ? album.order.length : index, 0, stem);
    }
  }

  // Convert every album that has not been migrated. Safe to call again: migrated albums are skipped.
  // `known(stem)` says whether a take with only Audio Board flags is a real catalogue take.
  function migrate(plan, ratings, known, titleOf = s => s, now = Date.now()) {
    const albums = Object.entries(plan.albums).filter(([, a]) => !isMigrated(a));
    const result = {albums:albums.map(([id]) => id), log:[], pulledIn:[]};
    if (!albums.length) return result;
    const stems = new Set(Object.keys(plan.considered).filter(s => !plan.considered[s].delDone));
    for (const [stem, r] of Object.entries(ratings || {})) if (["short", "maybe", "cut"].includes(r?.status) && !plan.considered[stem]?.delDone && known(stem)) stems.add(stem);
    for (const [id, album] of albums) {
      for (const stem of [...stems].sort()) {
        const flags = legacyFlags(plan, ratings, stem, id), status = legacyStatus(plan, ratings, stem, id);
        const kinds = new Set(flags.map(f => f === "audio-cut" ? "cut" : f));
        if (kinds.size > 1) result.log.push({stem, title:titleOf(stem), album:id, albumName:album.name, flags:flags.map(f => FLAG_TEXT[f]), result:LABELS[status]});
        if (status === "short" || status === "maybe") {
          if (!plan.considered[stem]) { plan.considered[stem] = {added:now}; result.pulledIn.push(stem); }
        }
        // Store the one winning status. On album keeps its track position, so it never goes through set().
        if (status === "on") album.cut = album.cut.filter(m => m !== stem);
        else if (status === "cut") { if (!album.cut.includes(stem)) album.cut.push(stem); }
        else if (status !== "unreviewed") (plan.considered[stem].marks ||= {})[id] = status;
      }
      album.statusV = VERSION;
    }
    result.pulledIn = [...new Set(result.pulledIn)];
    return result;
  }
  const FLAG_TEXT = {on:"On album", cut:"Cut from this album", "audio-cut":"Cut on Audio Board", short:"Shortlist", maybe:"Maybe"};

  return {VERSION, STATUSES, LABELS, isMigrated, legacyFlags, legacyStatus, statusOf, set, migrate};
});
