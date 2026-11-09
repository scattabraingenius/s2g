/* Hourly weather for the dashboard: the four daily check-in slots and a 24-hour strip.

   Open-Meteo returns hourly times as local wall-clock strings for the place ("2026-11-09T07:00",
   timezone=auto) plus utc_offset_seconds. "Now" is turned into the same kind of string, so slot and
   strip choice follow the weather place's clock, not this computer's, and never depend on parsing.

   Slot rule: today's slots show until the last one has ended; a slot whose hour has ended is dimmed.
   Once the last slot's hour is over, the row switches to tomorrow's slots. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrindHourly = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const DEFAULT_SLOTS = [7, 12, 16, 20];
  const pad = n => String(n).padStart(2, "0");

  function normSlots(raw) {
    if (!Array.isArray(raw)) return DEFAULT_SLOTS.slice();
    const s = [...new Set(raw.map(Number).filter(h => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b);
    return s.length ? s.slice(0, 6) : DEFAULT_SLOTS.slice();
  }
  /* "YYYY-MM-DDTHH" for the place's local time at nowMs. */
  function localKey(offsetSec, nowMs) {
    return new Date(nowMs + (Number(offsetSec) || 0) * 1000).toISOString().slice(0, 13);
  }
  function hourLabel(h, long) {
    const ap = h < 12 ? (long ? " AM" : "a") : (long ? " PM" : "p"), hh = h % 12 || 12;
    return hh + ap;
  }
  function valid(hourly) {
    return hourly && Array.isArray(hourly.time) && hourly.time.length > 0;
  }
  function entry(hourly, i) {
    return {time: hourly.time[i], hour: Number(hourly.time[i].slice(11, 13)),
      temp: hourly.temperature_2m?.[i], feels: hourly.apparent_temperature?.[i],
      rain: hourly.precipitation_probability?.[i], code: hourly.weather_code?.[i]};
  }

  function pickSlots(hourly, offsetSec, nowMs, slotsRaw) {
    if (!valid(hourly)) return null;
    const slots = normSlots(slotsRaw), key = localKey(offsetSec, nowMs);
    const today = key.slice(0, 10), hour = Number(key.slice(11, 13));
    const tomorrow = hour > slots[slots.length - 1];
    const date = tomorrow ? hourly.time.map(t => t.slice(0, 10)).find(d => d > today) : today;
    if (!date) return null;
    return {tomorrow, date, slots: slots.map(h => {
      const i = hourly.time.findIndex(t => t.slice(0, 13) === `${date}T${pad(h)}`);
      const base = {hour: h, passed: !tomorrow && hour > h, current: !tomorrow && hour === h};
      return i < 0 ? {...base, missing: true} : {...base, ...entry(hourly, i)};
    })};
  }

  function stripWindow(hourly, offsetSec, nowMs, n = 24) {
    if (!valid(hourly)) return [];
    const key = localKey(offsetSec, nowMs);
    let i = hourly.time.findIndex(t => t.slice(0, 13) >= key);
    if (i < 0) return [];
    const out = [];
    for (; i < hourly.time.length && out.length < n; i++) out.push(entry(hourly, i));
    return out;
  }

  /* Inline SVG: temperature line on top, chance-of-rain bars along the bottom, dashed marks at the
     slot hours. Width is the host's width in CSS pixels; it is redrawn when the card resizes. */
  function stripSvg(points, width, slotsRaw) {
    if (points.length < 2) return "";
    const slots = normSlots(slotsRaw), W = Math.max(200, Math.round(width)), H = 92;
    const pl = 6, pr = 6, top = 16, tempH = 30, rainTop = 54, rainH = 22, labelY = H - 2;
    const step = (W - pl - pr) / points.length, x = i => pl + step * (i + 0.5);
    const temps = points.map(p => p.temp).filter(Number.isFinite);
    const lo = Math.min(...temps), hi = Math.max(...temps), span = hi - lo || 1;
    const y = t => top + tempH - (t - lo) / span * tempH;
    const r = Math.round;
    let bars = "", marks = "", labels = "", path = "";
    points.forEach((p, i) => {
      // Under 5% reads as "no rain"; drawing it only adds specks along the baseline.
      if (Number.isFinite(p.rain) && p.rain >= 5) {
        const h = Math.max(1, p.rain / 100 * rainH);
        bars += `<rect class="r-bar" x="${(x(i) - step * 0.36).toFixed(1)}" y="${(rainTop + rainH - h).toFixed(1)}" width="${(step * 0.72).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${hourLabel(p.hour, true)}: ${r(p.rain)}% rain</title></rect>`;
      }
      if (Number.isFinite(p.temp)) path += `${path ? "L" : "M"}${x(i).toFixed(1)},${y(p.temp).toFixed(1)}`;
      if (slots.includes(p.hour)) {
        marks += `<line class="slot-tick" x1="${x(i).toFixed(1)}" x2="${x(i).toFixed(1)}" y1="${top - 6}" y2="${rainTop + rainH}"/>`;
        if (x(i) - pl > 28) labels += `<text class="lbl slot" x="${x(i).toFixed(1)}" y="${labelY}" text-anchor="middle">${hourLabel(p.hour)}</text>`;
      }
    });
    const iHi = points.findIndex(p => p.temp === hi), iLo = points.findIndex(p => p.temp === lo);
    const anchor = i => i < points.length * 0.15 ? "start" : i > points.length * 0.85 ? "end" : "middle";
    const tl = (i, dy) => `<text class="lbl t" x="${x(i).toFixed(1)}" y="${(y(points[i].temp) + dy).toFixed(1)}" text-anchor="${anchor(i)}">${r(points[i].temp)}°</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Next 24 hours: temperature ${r(lo)}° to ${r(hi)}°, chance of rain up to ${r(Math.max(0, ...points.map(p => p.rain).filter(Number.isFinite)))}%">
      <text class="lbl" x="${pl}" y="${labelY}">Now</text>${marks}${bars}
      <path class="t-line" d="${path}"/>${tl(iHi, -5)}${iLo !== iHi ? tl(iLo, 13) : ""}${labels}</svg>`;
  }

  return {DEFAULT_SLOTS, normSlots, localKey, hourLabel, pickSlots, stripWindow, stripSvg};
});
