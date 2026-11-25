/* "The machine while it plays": live readings with trend lines, like the training dashboard. A web page can only measure some things about the device it runs on (speed, memory in some
   browsers, battery in some browsers). Temperature, processor load and free memory appear only when a helper on the same computer supplies them through addHostSample().
   Nothing here is sent anywhere. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id), S = window.NNStats, C = window.NNChart; if (!$("sys")) return;
  const KEEP = 3600, EVERY = 2000, t0 = performance.now(), samples = []; let sims = 0, frames = 0, host = null, hostAt = 0, battery = null, last = t0;
  const METRICS = [
    ["temp", "Processor temperature, hottest core (°C)", 0], ["load", "Processor use (%)", 0], ["memfree", "Free memory (GB)", 1], ["batt", "Battery (%)", 0],
    ["simrate", "Shots simulated per second", 1], ["speed", "Game speed reached while shots fly (×)", 1], ["fps", "Screen refreshes per second", 0], ["heap", "Memory used by this page (MB)", 0]];
  window.NNSystem = { sim() { sims++; } };
  window.addHostSample = (s) => { host = s; hostAt = performance.now(); };
  if (navigator.getBattery) navigator.getBattery().then((b) => { battery = b; }).catch(() => {});
  const count = () => { frames++; requestAnimationFrame(count); }; requestAnimationFrame(count);
  function take() {
    const now = performance.now(), secs = (now - last) / 1000; last = now; if (secs <= 0) return;
    const s = { t: (now - t0) / 60000, simrate: sims / secs, fps: frames / secs }; sims = 0; frames = 0;
    let clock = null; try { clock = $("game").contentWindow.NNClock; } catch (e) {} if (clock && clock.achieved) s.speed = clock.achieved;
    if (performance.memory) s.heap = performance.memory.usedJSHeapSize / 1048576;
    if (battery) s.batt = battery.level * 100;
    if (host && now - hostAt < 3 * EVERY) for (const k of ["temp", "load", "memfree", "batt"]) if (Number.isFinite(host[k])) s[k] = host[k];
    samples.push(s); if (samples.length > KEEP) samples.shift();
  }
  /* Long runs are averaged into at most `most` points so the chart stays readable. */
  function thin(xs, ys, most) { const k = Math.ceil(xs.length / most); if (k <= 1) return [xs, ys]; const a = [], b = []; for (let i = 0; i < xs.length; i += k) { const x = xs.slice(i, i + k), y = ys.slice(i, i + k); a.push(x.reduce((p, v) => p + v, 0) / x.length); b.push(y.reduce((p, v) => p + v, 0) / y.length); } return [a, b]; }
  function card(key, title) { let box = $(`sys-${key}`); if (box) return box; box = document.createElement("div"); box.className = "chart mini"; box.id = `sys-${key}`;
    const h = document.createElement("h3"); h.textContent = title; const p = document.createElement("p"); p.className = "note"; const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 600 250"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", title);
    const read = document.createElement("div"); read.className = "readline"; box.append(h, p, svg, read); $("sys-grid").append(box); return box; }
  function render() {
    for (const [key, title, digits] of METRICS) {
      const have = samples.filter((s) => Number.isFinite(s[key])); if (have.length < 2) continue; const box = card(key, title), raw = have.map((s) => s[key]), [xs, ys] = thin(have.map((s) => s.t), raw, 240);
      const t = S.trend(xs, ys, true), mean = raw.reduce((a, v) => a + v, 0) / raw.length, perMin = t ? t.slope : 0, clear = t && Math.abs(t.slope) > t.slopeHalf;
      box.querySelector("p").textContent = `now ${raw[raw.length - 1].toFixed(digits)} · average ${mean.toFixed(digits)} · range ${Math.min(...raw).toFixed(digits)}–${Math.max(...raw).toFixed(digits)}${t ? ` · ${clear ? (perMin > 0 ? "rising" : "falling") + ` ${C.num(Math.abs(perMin), 2)} per minute (± ${C.num(t.slopeHalf, 2)})` : "no clear trend"}` : ""}`;
      let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.1 || 1; lo = Math.max(0, lo - pad); hi += pad;
      const f = C.frame(box.id, { x0: xs[0], x1: xs[xs.length - 1], y0: lo, y1: hi, xlabel: "minutes since the page opened", yfmt: (v) => C.num(v, hi - lo < 0.5 ? 2 : hi - lo < 5 ? 1 : 0) }), clip = (y) => Math.min(hi, Math.max(lo, y));
      if (t) { f.svg.append(C.el("polygon", { class: "band", points: xs.map((x) => `${f.X(x)},${f.Y(clip(t.at(x) + t.half(x)))}`).concat(xs.slice().reverse().map((x) => `${f.X(x)},${f.Y(clip(t.at(x) - t.half(x)))}`)).join(" ") })); C.path(f, xs.map((x) => [x, clip(t.at(x))]), "fitline"); }
      C.path(f, xs.map((x, i) => [x, ys[i]]), "series"); xs.forEach((x, i) => f.hit(C.el("circle", { cx: f.X(x), cy: f.Y(ys[i]), r: 6, class: "ghost" }), `minute ${C.num(x, 1)}: ${ys[i].toFixed(digits)}`));
    }
    $("sys-host").textContent = host ? "Temperature, load and memory come from a helper on this computer." : "This browser cannot read temperature or processor load; those appear only when the page is run with the laptop's helper.";
  }
  setInterval(() => { if (!document.hidden) { take(); if ($("sys").open) render(); } }, EVERY);
  $("sys").addEventListener("toggle", () => { if ($("sys").open) render(); });
})();
