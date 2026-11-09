/* Next-deadline countdown for the dashboard. Pure functions over Grind tasks (grind.plan.v1 shape);
   nothing here ever writes a task back.

   Rules (settled 2026-11-09):
   - A task counts when it is active (todo or doing) and has a due date. A Later task whose day has
     arrived counts as todo here, decided at display time only, the same way the main app treats
     linked tasks; the dashboard never runs normalizeLater() or saves anything.
   - Excluded: done, Someday (Later with no date), Later with a future date, undated tasks.
   - The deadline is due + dueTime, or 23:59 for a date-only task (same as the main app's dueMoment).
     The scheduled `time` field (the retired Up Next) is ignored on purpose.
   - The countdown shows the soonest deadline that has not passed by more than 5 minutes ("Due now"
     during those 5 minutes). Anything older is overdue and is listed on its own line, oldest first.
   - Ties: higher priority first (1-10, 10 highest), then created earlier, then id.
   - Everyone's tasks are included. Linked Family Planner (Daddy) tasks are not in grind.plan.v1. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrindNextTask = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const GRACE_MS = 5 * 60 * 1000;
  const pad = n => String(n).padStart(2, "0");
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function effectiveStatus(t, today) {
    if (t.status === "later" && typeof t.showOn === "string" && /^\d{4}-\d{2}-\d{2}/.test(t.showOn) && t.showOn.slice(0, 10) <= today) return "todo";
    return typeof t.status === "string" ? t.status : "todo";
  }
  function dueMoment(t) {
    if (typeof t.due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.due)) return null;
    const timed = typeof t.dueTime === "string" && /^\d{2}:\d{2}$/.test(t.dueTime);
    const d = new Date(`${t.due}T${timed ? t.dueTime : "23:59"}`);
    return isNaN(d) ? null : { at: d.getTime(), dateOnly: !timed };
  }
  const tieBreak = (a, b) => a.at - b.at || (b.task.priority || 0) - (a.task.priority || 0) || (a.task.created || 0) - (b.task.created || 0) || (a.task.id < b.task.id ? -1 : a.task.id > b.task.id ? 1 : 0);

  /* -> {next: {task, at, dateOnly, dueNow} | null, overdue: [{task, at, dateOnly}] } */
  function select(tasks, nowMs) {
    const today = ymd(new Date(nowMs)), items = [];
    for (const t of Array.isArray(tasks) ? tasks : []) {
      if (!t || typeof t !== "object" || typeof t.id !== "string") continue;
      const s = effectiveStatus(t, today);
      if (s !== "todo" && s !== "doing") continue;
      const m = dueMoment(t); if (!m) continue;
      items.push({ task: t, at: m.at, dateOnly: m.dateOnly });
    }
    items.sort(tieBreak);
    const overdue = items.filter(i => i.at < nowMs - GRACE_MS);
    const rest = items.filter(i => i.at >= nowMs - GRACE_MS);
    const next = rest[0] ? { ...rest[0], dueNow: rest[0].at <= nowMs } : null;
    return { next, overdue };
  }

  /* Countdown text. Timed: "2d 4h", "5h 12m", then a ticking "42:07" under an hour.
     Date-only: no ticking seconds ("Due today · 6h left", "Due tomorrow", "Due Thu"). */
  function countdown(item, nowMs) {
    if (!item) return "";
    if (item.dueNow) return "Due now";
    const ms = item.at - nowMs;
    if (item.dateOnly) {
      const day = new Date(item.at), today = new Date(nowMs);
      const days = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
      if (days <= 0) { const h = Math.floor(ms / 3600e3); return h >= 1 ? `Due today · ${h}h left` : `Due today · ${Math.max(1, Math.ceil(ms / 60000))}m left`; }
      if (days === 1) return "Due tomorrow";
      return "Due " + day.toLocaleDateString([], days < 7 ? { weekday: "short" } : { month: "short", day: "numeric" });
    }
    const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    return `${m}:${pad(s % 60)}`;
  }
  /* "Today 3:00 PM", "Tomorrow", "Thu 9:00 AM", "Nov 20". */
  function whenLabel(item, nowMs) {
    const d = new Date(item.at), today = new Date(nowMs);
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 864e5);
    const day = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : d.toLocaleDateString([], Math.abs(days) < 7 ? { weekday: "short" } : { month: "short", day: "numeric" });
    return item.dateOnly ? day : `${day} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  }
  return { GRACE_MS, select, countdown, whenLabel, dueMoment, effectiveStatus };
});
