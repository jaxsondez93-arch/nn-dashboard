/* "Your device" panel: how this device is doing while it helps, drawn like the training dashboard. Everything here is measured and kept on the device; none of it is sent.
   It shows performance only (speed, time per shot, totals, battery), never the results themselves. The maths is exported so it can be tested without a page. */
(function (root) {
  "use strict";
  const BUCKET_S = 10, POOL = 612308;
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  /* Least-squares line with a 95% interval for the slope, widened when neighbouring points resemble each other (lag-1 autocorrelation), as on the dashboard. */
  function trend(xs, ys) {
    const n = xs.length; if (n < 4) return null; const mx = xs.reduce((a, v) => a + v, 0) / n, my = ys.reduce((a, v) => a + v, 0) / n; let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; } if (!sxx) return null;
    const slope = sxy / sxx, a = my - slope * mx, res = ys.map((y, i) => y - a - slope * xs[i]), sse = res.reduce((t, r) => t + r * r, 0), s = Math.sqrt(sse / (n - 2));
    let num = 0; for (let i = 1; i < n; i++) num += res[i] * res[i - 1]; const rho = sse ? Math.max(0, Math.min(0.9, num / sse)) : 0, widen = Math.sqrt((1 + rho) / (1 - rho));
    const half = (x) => 1.96 * widen * s * Math.sqrt(1 / n + (x - mx) ** 2 / sxx);
    return { slope, intercept: a, half, ci: 1.96 * widen * s / Math.sqrt(sxx), r2: syy ? 1 - sse / syy : 0, mean: my };
  }
  /* Is the device slowing down? xs in minutes, ys in shots per second. "Slowing" needs a slope clearly below zero AND a fall of at least 10% over the window. */
  function verdict(xs, ys) {
    const t = xs.length >= 6 ? trend(xs, ys) : null; if (!t) return { word: "measuring", text: "Measuring: a trend appears after about a minute." };
    const change = t.slope * (xs[xs.length - 1] - xs[0]) / (t.mean || 1);
    if (t.slope + t.ci < 0 && change < -0.1) return { word: "slowing", text: `Slowing down (about ${Math.round(-change * 100)}% over this visit). Devices often do this as they warm up.` };
    if (t.slope - t.ci > 0 && change > 0.1) return { word: "faster", text: `Speeding up (about ${Math.round(change * 100)}% over this visit).` };
    return { word: "steady", text: "Steady: no clear change in speed." };
  }
  const api = { BUCKET_S, POOL, median, trend, verdict };
  root.NNMonitor = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  /* ---------- live measurements ---------- */
  const $ = (id) => document.getElementById(id), buckets = [], batt = []; let since = 0; let activeS = 0, visitShots = 0, sentShots = 0, waiting = 0, running = false, lastSent = null, total = 0;
  const bucket = () => { const k = Math.floor(activeS / BUCKET_S); while (buckets.length <= k) buckets.push({ n: 0, s: 0, ms: [] }); return buckets[k]; };      // buckets count running time only, so pauses do not look like slowness
  api.shot = (ms) => { const b = bucket(); b.n++; if (Number.isFinite(ms)) b.ms.push(ms); visitShots++; };
  api.mark = () => { since = buckets.length; };                                   // the power setting changed: judge the trend only from here on
  api.sent = (n) => { sentShots += n; lastSent = new Date(); };
  api.state = (s) => { running = s.running; waiting = s.waiting; total = s.total; api.capLeft = s.capLeft; api.capAll = s.capAll; };
  api.battery = (level, charging) => { batt.push({ t: activeS / 60, v: Math.round(level * 100), charging }); if (batt.length > 600) batt.shift(); };

  /* ---------- drawing ---------- */
  const NS = "http://www.w3.org/2000/svg";
  const node = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; };
  function chart(id, xs, ys, { color, fit, unit, digits = 1, zero = true }) {
    const svg = $(id), W = 600, H = 190, L = 46, R = 8, T = 10, B = 24; svg.replaceChildren();
    if (xs.length < 2) { svg.append(node("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "axis" }, "collecting data...")); return; }
    const line = fit ? trend(xs, ys) : null; let lo = zero ? 0 : Math.min(...ys), hi = Math.max(...ys, 1e-9); if (line) for (const x of xs) { hi = Math.max(hi, line.intercept + line.slope * x + line.half(x)); } if (hi === lo) hi = lo + 1; hi *= 1.05;
    const x0 = xs[0], x1 = xs[xs.length - 1] || x0 + 1, X = (x) => L + (x - x0) / ((x1 - x0) || 1) * (W - L - R), Y = (y) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);
    for (let g = 0; g <= 3; g++) { const v = lo + (hi - lo) * g / 3; svg.append(node("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: "gridline" }), node("text", { x: L - 6, y: Y(v) + 4, "text-anchor": "end", class: "axis" }, v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(digits))); }
    svg.append(node("text", { x: L, y: H - 6, class: "axis" }, `${x0.toFixed(1)} min`), node("text", { x: W - R, y: H - 6, "text-anchor": "end", class: "axis" }, `${x1.toFixed(1)} min of work`));
    if (line) { const up = xs.map((x) => `${X(x)},${Y(line.intercept + line.slope * x + line.half(x))}`), down = xs.slice().reverse().map((x) => `${X(x)},${Y(Math.max(lo, line.intercept + line.slope * x - line.half(x)))}`);
      svg.append(node("polygon", { points: up.concat(down).join(" "), class: "band" }), node("line", { x1: X(x0), y1: Y(line.intercept + line.slope * x0), x2: X(x1), y2: Y(line.intercept + line.slope * x1), class: "fit" })); }
    svg.append(node("polyline", { points: xs.map((x, i) => `${X(x)},${Y(ys[i])}`).join(" "), fill: "none", stroke: color, "stroke-width": 2.2, "stroke-linejoin": "round" }));
    svg.setAttribute("aria-label", `${unit}: latest ${ys[ys.length - 1].toFixed(digits)}`);
  }
  const fmtT = (s) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
  function render() {
    if (running) { bucket().s += 1; activeS += 1; }
    const done = buckets.filter((b, i) => b.s >= BUCKET_S - 2 || (i === buckets.length - 1 && b.s >= 4)), at = done.map((b) => (buckets.indexOf(b) + 0.5) * BUCKET_S / 60);
    const rates = done.map((b) => b.n / Math.max(1, b.s)), times = done.map((b) => median(b.ms) || 0);
    const recent = buckets.slice(-3), rs = recent.reduce((a, b) => a + b.s, 0), now = rs ? recent.reduce((a, b) => a + b.n, 0) / rs : 0, perShot = median(recent.flatMap((b) => b.ms));
    $("m-speed").textContent = running ? now.toFixed(1) : "–"; $("m-ms").textContent = perShot === null ? "–" : `${Math.round(perShot)} ms`; $("count").textContent = total.toLocaleString(); $("m-visit").textContent = visitShots.toLocaleString();
    $("m-sent").textContent = sentShots.toLocaleString(); $("m-wait").textContent = waiting ? `${waiting} batch item${waiting > 1 ? "s" : ""} waiting` : "nothing waiting"; $("m-last").textContent = lastSent ? lastSent.toLocaleTimeString() : "not yet";
    $("m-time").textContent = fmtT(activeS); const unlimited = api.capLeft === null; $("m-left").textContent = unlimited ? "no limit" : fmtT(Math.max(0, (api.capLeft || 0) / 1000)); $("m-cap").hidden = unlimited; $("m-cap").value = api.capAll && !unlimited ? 100 * (1 - Math.max(0, api.capLeft) / api.capAll) : 0;
    $("m-share").textContent = `${(100 * total / POOL).toFixed(total / POOL < 0.001 ? 3 : 2)}%`; $("m-cores").textContent = navigator.hardwareConcurrency || "?";
    const fresh = at.map((x, i) => i).filter((i) => buckets.indexOf(done[i]) >= since), v = verdict(fresh.map((i) => at[i]), fresh.map((i) => rates[i])); $("m-verdict").textContent = v.text; $("m-verdict").className = "verdict " + v.word;
    chart("ch-speed", at, rates, { color: "var(--ok)", fit: rates.length >= 6, unit: "shots per second" });
    chart("ch-ms", at, times, { color: "var(--accent)", fit: false, unit: "milliseconds per shot", digits: 0 });
    let c = 0; const cum = buckets.map((b) => (c += b.n)); chart("ch-total", buckets.map((_, i) => (i + 1) * BUCKET_S / 60), cum, { color: "var(--accent2)", fit: false, unit: "shots this visit", digits: 0 });
    if (batt.length) { $("batt-card").hidden = false; $("m-batt").textContent = `${batt[batt.length - 1].v}% ${batt[batt.length - 1].charging ? "(charging)" : "(on battery)"}`; if (running) { const last = batt[batt.length - 1]; if (activeS / 60 - last.t >= 0.5) api.battery(last.v / 100, last.charging); } chart("ch-batt", batt.map((b) => b.t), batt.map((b) => b.v), { color: "var(--accent)", fit: false, unit: "battery percent", digits: 0 }); }
  }
  setInterval(() => { if (!document.hidden) render(); }, 1000); render();
})(typeof self !== "undefined" ? self : globalThis);
