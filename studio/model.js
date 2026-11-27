/* Studio Board data model: joins Lyric Board versions, Audio Board takes and the Studio catalog into one song list.
   Pure functions over the published data files; no storage, no DOM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioModel = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const hasWords = text => /[\p{L}\p{N}]/u.test(String(text || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " "));
  const SUFFIXES = Object.freeze({cue:{type:"Vocal", writer:"Cue"}, misc:{type:"Vocal", writer:"Misc"}, inst:{type:"Instrumental", writer:null}});
  function titleIntent(title) {
    const text = String(title ?? "").trimEnd(), end = /_([a-z]+)$/i.exec(text);
    const suffix = end?.[1].toLowerCase();
    if (!Object.hasOwn(SUFFIXES, suffix)) return null;
    const prefix = text.slice(0, end.index), version = /\s+v(\d+)$/i.exec(prefix);
    const base = (version ? prefix.slice(0, version.index) : prefix).trimEnd();
    return base ? {base, suffix, version:version?.[1] ?? null, ...SUFFIXES[suffix]} : null;
  }
  function takeEvidence(t) {
    const lyrics = t.suno?.lyrics ?? t.lyrics;
    if (t.reportedType === "Stem") return null;
    if (t.reportedType === "Instrumental" || (!hasWords(lyrics) && /[\[(]\s*instrumental\b/i.test(lyrics || ""))) return "Instrumental";
    // A generic Vocal label alone is not proof of recorded vocals; neither is empty metadata proof of an instrumental.
    return hasWords(lyrics) ? "Vocal" : null;
  }
  const WRITER_ORDER = ["Scatta", "Cue", "Misc", "Unknown"];

  function create({lyricSongs = [], takeSongs = [], studio = {songs:[], takeSong:{}, clips:[]}}) {
    const lyricBySlug = Object.fromEntries(lyricSongs.map(s => [s.slug, s]));
    const versionByStem = {};
    for (const s of lyricSongs) for (const v of s.versions) versionByStem[v.stem] = {...v, slug:s.slug};

    const takes = {};
    for (const s of takeSongs) {
      const v = s.versions[0], intent = titleIntent(s.title);
      const evidence = takeEvidence({...v, reportedType:v.type});
      takes[s.slug] = {...v, reportedType:v.type, intent, evidence, checkType:!!(intent && evidence && intent.type !== evidence),
        type:v.type === "Stem" ? "Stem" : evidence || v.type || "Vocal", stem:s.slug, title:s.title, baseTitle:s.baseTitle || intent?.base || s.title};
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
    function isInstrumental(s, custom = {}) {
      const versions = versionsOf(s, custom);
      const performances = s.takeIds.map(id => takes[id]).filter(t => t.type !== "Stem");
      if (versions.some(v => hasWords(v.custom ? v.suno?.lyrics ?? v.lyrics : v.lyrics ?? v.suno?.lyrics)) ||
          performances.some(t => t.intent?.type === "Vocal" || t.evidence === "Vocal")) return false;
      return s.prompt || performances.some(t => t.intent?.type === "Instrumental" || t.evidence === "Instrumental") ||
        versions.some(v => !!v.suno?.instrumental) || s.clips.some(c => !c.trashed && c.mode === "Instrumental requested");
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
      for (const id of s.takeIds) parts.push(takes[id].title, takes[id].intent?.base, takes[id].oldTitle);
      for (const c of s.clips) parts.push(c.title);
      return (s._search = parts.filter(Boolean).join("\n").toLowerCase());
    }
    const writers = [...new Set(songs.flatMap(s => s.writers))].sort((a, b) => (WRITER_ORDER.indexOf(a) + 1 || 9) - (WRITER_ORDER.indexOf(b) + 1 || 9));
    return {songs, bySong, takes, lyricBySlug, versionByStem, songOfTake, songOfSlug, writers,
      versionsOf, takesForVersion, unlinkedTakes, isInstrumental, newClips, versionLabel, shortVersionLabel, akaOf, searchText};
  }
  return {create, hasWords, titleIntent};
});
