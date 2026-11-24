/* Playground: three small interactive explainers. Plain JavaScript, no libraries, made-up numbers only.
   Layout: helpers (random numbers, drawing, maths) -> 1 correlation -> 2 bands -> 3 search game. */
"use strict";
const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- helpers ---------- */
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function normal(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
function bindSlider(id, fmt, onChange) { const el = $(id), out = $(id + "-o"); const f = () => { out.textContent = fmt(+el.value); onChange(); }; el.addEventListener("input", f); out.textContent = fmt(+el.value); return el; }
/* two-sided 95% Student t quantile (Cornish-Fisher approximation: fine for a teaching toy) */
function t975(df) { const z = 1.959964; return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df * df); }
function ols(x, y) { const mx = mean(x), my = mean(y); let sxx = 0, sxy = 0; for (let i = 0; i < x.length; i++) { sxx += (x[i] - mx) ** 2; sxy += (x[i] - mx) * (y[i] - my); } const b = sxy / sxx, a = my - b * mx; let ss = 0; for (let i = 0; i < x.length; i++) ss += (y[i] - a - b * x[i]) ** 2; return { a, b, mx, sxx, s: Math.sqrt(ss / (x.length - 2)), n: x.length }; }
function frame(cv) { const g = cv.getContext("2d"); g.clearRect(0, 0, cv.width, cv.height); g.font = "13px system-ui, sans-serif"; return g; }

/* ---------- 1. correlation ---------- */
let corrSeed = 1;
function drawCorr() {
  const r = +$("c-r").value, n = +$("c-n").value, rng = mulberry32(corrSeed), xs = [], ys = [];
  for (let i = 0; i < n; i++) { const x = normal(rng); xs.push(x); ys.push(r * x + Math.sqrt(1 - r * r) * normal(rng)); }
  const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const rs = sxy / Math.sqrt(sxx * syy), cv = $("c-cv"), g = frame(cv), W = cv.width, H = cv.height, X = (v) => W / 2 + v * (W / 8), Y = (v) => H / 2 - v * (H / 7);
  g.strokeStyle = css("--line"); g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
  g.fillStyle = r >= 0 ? css("--accent") : css("--accent2"); g.globalAlpha = 0.7; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(X(xs[i]), Y(ys[i]), 3.4, 0, 6.2832); g.fill(); } g.globalAlpha = 1;
  const b = sxy / sxx; g.strokeStyle = css("--ink"); g.lineWidth = 2; g.beginPath(); g.moveTo(X(-3.2), Y(my + b * (-3.2 - mx))); g.lineTo(X(3.2), Y(my + b * (3.2 - mx))); g.stroke(); g.lineWidth = 1;
  const z = Math.atanh(Math.max(-0.999999, Math.min(0.999999, rs))), se = n > 3 ? 1 / Math.sqrt(n - 3) : NaN;
  $("c-out").innerHTML = `<span>measured r = <b>${rs.toFixed(2)}</b></span><span>R&sup2; = <b>${(rs * rs).toFixed(2)}</b> (${Math.round(rs * rs * 100)}% explained)</span><span>95% interval for r: <b>[${Math.tanh(z - 1.96 * se).toFixed(2)}, ${Math.tanh(z + 1.96 * se).toFixed(2)}]</b></span>`;
}
bindSlider("c-r", (v) => v.toFixed(2), drawCorr); bindSlider("c-n", (v) => String(v), drawCorr); $("c-new").onclick = () => { corrSeed++; drawCorr(); };

/* ---------- 2. confidence vs prediction band ---------- */
let bandSeed = 1;
function drawBand() {
  const sd = +$("b-s").value, n = +$("b-n").value, rng = mulberry32(bandSeed + 1000), xs = [], ys = [];
  for (let i = 0; i < n; i++) { const x = rng() * 10; xs.push(x); ys.push(1 + 0.5 * x + sd * normal(rng)); }
  const f = ols(xs, ys), t = t975(n - 2), cv = $("b-cv"), g = frame(cv), W = cv.width, H = cv.height, X = (v) => 30 + v * ((W - 50) / 10), Y = (v) => H - 20 - (v + 5) * ((H - 40) / 20);
  const band = (kind, color) => { g.fillStyle = color; g.beginPath(); for (let k = 0; k <= 50; k++) { const x = k / 5, h = t * f.s * Math.sqrt((kind === "pb" ? 1 : 0) + 1 / n + (x - f.mx) ** 2 / f.sxx); g[k ? "lineTo" : "moveTo"](X(x), Y(f.a + f.b * x + h)); } for (let k = 50; k >= 0; k--) { const x = k / 5, h = t * f.s * Math.sqrt((kind === "pb" ? 1 : 0) + 1 / n + (x - f.mx) ** 2 / f.sxx); g.lineTo(X(x), Y(f.a + f.b * x - h)); } g.closePath(); g.fill(); };
  if ($("b-pb").checked) band("pb", "rgba(150,160,175,.25)"); if ($("b-cb").checked) band("cb", "rgba(192,57,43,.35)");
  g.fillStyle = css("--accent"); g.globalAlpha = 0.75; for (let i = 0; i < n; i++) { g.beginPath(); g.arc(X(xs[i]), Y(ys[i]), 3.2, 0, 6.2832); g.fill(); } g.globalAlpha = 1;
  g.strokeStyle = css("--accent2"); g.lineWidth = 2; g.beginPath(); g.moveTo(X(0), Y(f.a)); g.lineTo(X(10), Y(f.a + 10 * f.b)); g.stroke(); g.lineWidth = 1;
  g.strokeStyle = css("--muted"); g.setLineDash([5, 4]); g.beginPath(); g.moveTo(X(0), Y(1)); g.lineTo(X(10), Y(6)); g.stroke(); g.setLineDash([]); g.fillStyle = css("--muted"); g.fillText("dashed = the true line (0.5 per step)", 40, 18);
  const sl = t * f.s / Math.sqrt(f.sxx);
  $("b-out").innerHTML = `<span>fitted slope = <b>${f.b.toFixed(2)}</b></span><span>95% interval for the slope: <b>[${(f.b - sl).toFixed(2)}, ${(f.b + sl).toFixed(2)}]</b> (width ${(2 * sl).toFixed(2)})</span><span>contains the true 0.50? <b>${Math.abs(f.b - 0.5) <= sl ? "yes" : "no"}</b></span>`;
}
bindSlider("b-s", (v) => v.toFixed(1), drawBand); bindSlider("b-n", (v) => String(v), drawBand); $("b-cb").onchange = $("b-pb").onchange = drawBand; $("b-new").onclick = () => { bandSeed++; drawBand(); };

/* ---------- 3. the search game ---------- */
const N_AIMS = 781, STRATS = [["random", "random tests", "#9aa0a6"], ["even", "evenly spaced", "#c4a000"], ["c2f", "spaced, then zoom in", "#2f6fdb"], ["hunch", "hunch + zoom in", "#c0392b"]];
let boardSeed = 7, board = null;
function makeBoard(seed) {                                              // a bumpy landscape of damage over the 781 aims
  const rng = mulberry32(seed), y = new Array(N_AIMS).fill(0), bumps = 4 + Math.floor(rng() * 4);
  for (let k = 0; k < bumps; k++) { const c = rng() * N_AIMS, w = 10 + rng() * 38, h = 3 + rng() * 12; for (let j = 0; j < N_AIMS; j++) y[j] += h * Math.exp(-(((j - c) / w) ** 2)); }
  return y.map((v) => Math.round(v + rng() * 0.8));
}
function smooth(y, w) { return y.map((_, j) => { let s = 0, c = 0; for (let d = -w; d <= w; d++) if (y[j + d] !== undefined) { s += y[j + d]; c++; } return s / c; }); }
function refine(y, chosen, K, centres) { const have = new Set(chosen); for (let d = 1; d < N_AIMS && chosen.length < K; d++) for (const c of centres) for (const j of [c - d, c + d]) if (j >= 0 && j < N_AIMS && !have.has(j) && chosen.length < K) { chosen.push(j); have.add(j); } return chosen; }
function top2(y, idx) { return idx.slice().sort((a, b) => y[b] - y[a]).slice(0, 2); }
function choose(kind, y, K, q, rng) {
  if (kind === "random") { const s = new Set(); while (s.size < K) s.add(Math.floor(rng() * N_AIMS)); return [...s]; }
  if (kind === "even") return Array.from({ length: K }, (_, i) => Math.min(N_AIMS - 1, Math.floor((i + 0.5) * N_AIMS / K)));
  if (kind === "c2f") { const m = Math.max(2, Math.ceil(K * 0.6)), g = Array.from({ length: m }, (_, i) => Math.min(N_AIMS - 1, Math.floor((i + 0.5) * N_AIMS / m))); return refine(y, g.slice(), K, top2(y, g)); }
  const sm = smooth(y, 6), sd = Math.sqrt(mean(y.map((v) => (v - mean(y)) ** 2))) || 1, score = sm.map((v) => q * v + (1 - q) * sd * normal(rng));     // the hunch: smoothed truth blended with noise
  const order = score.map((_, j) => j).sort((a, b) => score[b] - score[a]), n1 = Math.max(2, Math.ceil(K * 0.4)), rho = Math.max(3, Math.floor(N_AIMS / (n1 * 3))), seeds = [];
  for (const j of order) { if (seeds.every((s) => Math.abs(s - j) >= rho)) seeds.push(j); if (seeds.length === n1) break; }
  const chosen = seeds.slice(); refine(y, chosen, K, top2(y, seeds)); for (const j of order) { if (chosen.length >= K) break; if (!chosen.includes(j)) chosen.push(j); } return chosen;
}
const regret = (y, set) => Math.max(...y) - Math.max(...set.map((j) => y[j]));
function drawSearch() {
  const K = +$("s-k").value, q = +$("s-q").value, y = board, rng = mulberry32(boardSeed * 31 + K), cv = $("s-cv"), g = frame(cv), W = cv.width, H = cv.height, top = 14, base = H - 74, hmax = Math.max(...y, 1), L = 150, PX = (j) => L + (j / N_AIMS) * (W - L);   // L = left gutter for the strategy names
  g.fillStyle = css("--line"); for (let j = 0; j < N_AIMS; j++) { const h = (y[j] / hmax) * (base - top); g.fillRect(PX(j), base - h, Math.max(1, (W - L) / N_AIMS), h); }
  const best = y.indexOf(Math.max(...y)); g.strokeStyle = css("--ink"); g.beginPath(); g.moveTo(PX(best), top); g.lineTo(PX(best), base); g.stroke(); g.fillStyle = css("--ink"); g.fillText("best aim: damage " + Math.max(...y), Math.min(W - 150, PX(best) + 6), top + 8);
  const rows = STRATS.map(([k, label, color], i) => { const set = choose(k, y, K, q, rng); g.fillStyle = color; for (const j of set) g.fillRect(PX(j), base + 6 + i * 16, 2.5, 12); g.fillText(label, 6, base + 17 + i * 16); return { k, label, color, set, r: regret(y, set), found: Math.max(...set.map((j) => y[j])) }; });
  $("s-out").innerHTML = rows.map((o) => `<span style="color:${o.color}">&#9632;</span> ${o.label}: found <b>${o.found}</b>, regret <b>${o.r}</b>`).join(" &nbsp; ");
}
function runMany() {
  const K = +$("s-k").value, q = +$("s-q").value, tot = Object.fromEntries(STRATS.map(([k]) => [k, 0])), runs = 300;
  for (let b = 0; b < runs; b++) { const y = makeBoard(5000 + b), rng = mulberry32(b + 99); for (const [k] of STRATS) tot[k] += regret(y, choose(k, y, K, q, rng)); }
  const cv = $("s-bar"), g = frame(cv), W = cv.width, H = cv.height, avg = STRATS.map(([k, label, color]) => ({ label, color, v: tot[k] / runs })), mx = Math.max(...avg.map((a) => a.v), 1);
  avg.forEach((a, i) => { const w = (a.v / mx) * (W - 260); g.fillStyle = a.color; g.fillRect(200, 14 + i * 32, w, 22); g.fillStyle = css("--ink"); g.fillText(a.label, 6, 30 + i * 32); g.fillText(a.v.toFixed(2), 206 + w, 30 + i * 32); });
  $("s-avg").innerHTML = `<span>average regret over ${runs} random boards at ${K} tests (lower is better):</span> ` + avg.map((a) => `<span><span style="color:${a.color}">&#9632;</span> ${a.label} <b>${a.v.toFixed(2)}</b></span>`).join(" &nbsp; ");
}
bindSlider("s-k", (v) => String(v), drawSearch); bindSlider("s-q", (v) => v.toFixed(2), drawSearch); $("s-new").onclick = () => { boardSeed++; board = makeBoard(boardSeed); drawSearch(); }; $("s-run").onclick = runMany;
board = makeBoard(boardSeed); drawCorr(); drawBand(); drawSearch(); runMany();
