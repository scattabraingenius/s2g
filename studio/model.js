/* Studio Board data model: joins Lyric Board versions, Audio Board takes and the Studio catalog into one song list.
   Pure functions over the published data files; no storage, no DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioModel = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  // Suno labels some instrumentals "Vocal". A take with no sung words is an instrumental (same rule as the planner).
  const hasWords = text => /[\p{L}\p{N}]/u.test(String(text || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " "));
  const WRITER_ORDER = ["Scatta", "Cue", "Misc", "Unknown"];

  function create({lyricSongs = [], takeSongs = [], studio = {songs:[], takeSong:{}, clips:[]}}) {
    const lyricBySlug = Object.fromEntries(lyricSongs.map(s => [s.slug, s]));
    const versionByStem = {};
    for (const s of lyricSongs) for (const v of s.versions) versionByStem[v.stem] = {...v, slug:s.slug};

    const takes = {};
    for (const s of takeSongs) {
      const v = s.versions[0], lyrics = v.suno?.lyrics ?? v.lyrics;
      takes[s.slug] = {...v, type:(v.type || "Vocal") === "Vocal" && typeof lyrics === "string" && !hasWords(lyrics) ? "Instrumental" : (v.type || "Vocal"), stem:s.slug, title:s.title, baseTitle:s.baseTitle || s.title};
    }

    const songs = studio.songs.map(s => ({...s, takeIds:[], clips:[]}));
    const bySong = Object.fromEntries(songs.map(s => [s.key, s]));
    const songOfTake = {};
    for (const [id, key] of Object.entries(studio.takeSong || {})) {
      if (!takes[id] || !bySong[key]) continue;
      bySong[key].takeIds.push(id); songOfTake[id] = key;
    }
    for (const c of studio.clips || []) if (bySong[c.song]) bySong[c.song].clips.push(c);
    const songOfSlug = {};
    for (const s of songs) for (const slug of s.lyrics || []) songOfSlug[slug] = s.key;
    for (const s of songs) {
      s.takeIds.sort((a, b) => (takes[b].createdAt || "").localeCompare(takes[a].createdAt || "") || takes[a].title.localeCompare(takes[b].title));
      s.writers = writersOf(s);
      s.latest = [...s.takeIds.map(id => takes[id].createdAt || ""), ...s.clips.map(c => c.created || ""), s.cat?.updated || ""].sort().pop() || "";
    }

    function writersOf(s) {
      const set = new Set();
      for (const slug of s.lyrics || []) for (const v of lyricBySlug[slug]?.versions || []) if (v.writer) set.add(v.writer);
      for (const id of s.takeIds) if (takes[id].writer && takes[id].writer !== "Unknown") set.add(takes[id].writer);
      for (const w of s.cat?.writers || []) if (w && w !== "UNK") set.add(w);
      return [...set].sort((a, b) => (WRITER_ORDER.indexOf(a) + 1 || 9) - (WRITER_ORDER.indexOf(b) + 1 || 9) || a.localeCompare(b));
    }
    // Every lyric version of a song, oldest session first, plus the user's own copies from the Lyric Board store.
    function versionsOf(s, custom = {}) {
      const out = [];
      for (const slug of s.lyrics || []) {
        for (const v of lyricBySlug[slug]?.versions || []) out.push({...v, slug});
        for (const v of custom[slug] || []) out.push({...v, slug, custom:true});
      }
      return out;
    }
    function takesForVersion(s, stem) { return s.takeIds.filter(id => takes[id].lyricStem === stem); }
    function unlinkedTakes(s, versions) {
      const stems = new Set(versions.map(v => v.stem));
      return s.takeIds.filter(id => !stems.has(takes[id].lyricStem));
    }
    function newClips(s) { return s.clips.filter(c => !c.onBoard && !c.trashed); }
    function versionLabel(v) {
      if (v.custom) return v.label || "My copy";
      if (v.versionLabel) return v.versionLabel;
      return `v${String(v.version).padStart(2, "0")} ${v.writer} · ${v.session}`;
    }
    // Compact chip label: "v05 Cue", "v00 full Scatta", "Anchor Cue", "Unthings Lyric Book Misc".
    function shortVersionLabel(v, songTitle = "") {
      if (v.custom) return v.label || "My copy";
      if (!v.versionLabel) return `v${String(v.version).padStart(2, "0")} ${v.writer}`;
      const m = /\bv(\d+[a-z]?(?:\.\d+)?(?:\s(?:full|short|alt|edit))?)\b/i.exec(v.versionLabel);
      if (m) return `v${m[1]} ${v.writer}`;
      if (/Scatta Anchors/i.test(v.stem)) return `Anchor ${v.writer}`;
      const words = new Set(String(songTitle).toLowerCase().split(/\W+/).concat(String(v.writer).toLowerCase(), "lyrics"));
      const rest = v.versionLabel.replace(/^\d+-/, "").split(/[\s\-_]+/).filter(w => w && !words.has(w.toLowerCase())).join(" ");
      return `${rest || "Library"} ${v.writer}`.slice(0, 40);
    }
    // Other names this song goes by (lyric titles and Suno base titles that differ from the display title).
    function akaOf(s) {
      const seen = new Set([s.title.toLowerCase()]), out = [];
      const clean = t => String(t || "").replace(/\s+v\d+\S*$/i, "").trim();
      for (const t of [...(s.lyrics || []).map(slug => lyricBySlug[slug]?.title), ...(s.bases || [])].map(clean)) {
        if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t); }
      }
      return out.slice(0, 3);
    }
    function searchText(s) {
      if (s._search) return s._search;
      const parts = [s.title, ...(s.bases || []), ...(s.writers || [])];
      for (const slug of s.lyrics || []) for (const v of lyricBySlug[slug]?.versions || []) parts.push(v.title, v.lyrics);
      for (const id of s.takeIds) parts.push(takes[id].title, takes[id].oldTitle);
      for (const c of s.clips) parts.push(c.title);
      return (s._search = parts.filter(Boolean).join("\n").toLowerCase());
    }
    const writers = [...new Set(songs.flatMap(s => s.writers))].sort((a, b) => (WRITER_ORDER.indexOf(a) + 1 || 9) - (WRITER_ORDER.indexOf(b) + 1 || 9));
    return {songs, bySong, takes, lyricBySlug, versionByStem, songOfTake, songOfSlug, writers,
      versionsOf, takesForVersion, unlinkedTakes, newClips, versionLabel, shortVersionLabel, akaOf, searchText};
  }
  return {create, hasWords};
});
