/* The statistics behind the "How accurate are the predictions?" panel. Pure functions, so they can be tested without a page.
   A "row" is one turn with: balls, predicted (damage the simulator expected), damage (what the real game did). "Exact" means the two are equal. */
(function (root) {
  "use strict";
  const Z = 1.959964;                                                                  // 95% two-sided normal value
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const usable = (turns) => turns.filter((t) => t && Number.isFinite(t.predicted) && Number.isFinite(t.damage) && Number.isFinite(t.balls) && t.balls >= 1);
  const exact = (t) => (t.predicted === t.damage ? 1 : 0);
  /* Wilson score interval for k successes in n tries: stays inside 0..1 and behaves well for small n or rates near 0 or 1. */
  function wilson(k, n) {
    if (!n) return null; const p = k / n, z2 = Z * Z, d = 1 + z2 / n, c = (p + z2 / (2 * n)) / d, h = Z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
    return { k, n, p, lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
  }
  function meanCI(a) {
    const n = a.length; if (!n) return null; const m = mean(a); if (n < 2) return { n, mean: m, half: null };
    return { n, mean: m, half: Z * Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (n - 1) / n) };
  }
  function summary(rows) {
    const n = rows.length; if (!n) return null; const err = rows.map((t) => t.damage - t.predicted), expected = rows.reduce((s, t) => s + t.predicted, 0);
    return { n, exact: wilson(rows.reduce((s, t) => s + exact(t), 0), n), abs: meanCI(err.map(Math.abs)), bias: meanCI(err), relative: expected ? err.reduce((s, e) => s + Math.abs(e), 0) / expected : null,
      lower: err.filter((e) => e < 0).length, higher: err.filter((e) => e > 0).length };
  }
  const BINS = [[1, 2], [3, 4], [5, 6], [7, 9], [10, 14], [15, 19], [20, 29], [30, 49], [50, Infinity]];
  function byBalls(rows) {
    return BINS.map(([lo, hi]) => { const g = rows.filter((t) => t.balls >= lo && t.balls <= hi); return g.length ? Object.assign({ label: hi === Infinity ? `${lo}+` : `${lo}–${hi}`, balls: mean(g.map((t) => t.balls)) }, summary(g)) : null; }).filter(Boolean);
  }
  function rolling(rows, width) { const out = []; let k = 0; rows.forEach((t, i) => { k += exact(t); if (i >= width) k -= exact(rows[i - width]); if (i >= width - 1) out.push({ i: i + 1, p: k / width }); }); return out; }
  /* Model 1, logistic: P(exact) = 1 / (1 + exp(-(a + b·balls))). Fitted by maximum likelihood with Newton's method. */
  function logistic(rows) {
    const n = rows.length, k = rows.reduce((s, t) => s + exact(t), 0); if (n < 10 || k === 0 || k === n) return null;
    let a = 0, b = 0, H = null;
    for (let it = 0; it < 100; it++) {
      let ga = 0, gb = 0, haa = 1e-9, hab = 0, hbb = 1e-9;
      for (const t of rows) { const p = 1 / (1 + Math.exp(-(a + b * t.balls))), w = p * (1 - p), r = exact(t) - p; ga += r; gb += r * t.balls; haa += w; hab += w * t.balls; hbb += w * t.balls * t.balls; }
      const det = haa * hbb - hab * hab; if (!(det > 1e-12)) return null; H = { haa, hab, hbb, det };
      let da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det; const big = Math.max(Math.abs(da), Math.abs(db) * 10); if (big > 3) { da *= 3 / big; db *= 3 / big; }
      a += da; b += db; if (Math.abs(da) + Math.abs(db) < 1e-10) break; if (Math.abs(b) > 50) return null;                // perfectly separated data: no finite fit
    }
    const va = H.hbb / H.det, vb = H.haa / H.det, vab = -H.hab / H.det, lnL = rows.reduce((s, t) => { const z = a + b * t.balls; return s + (exact(t) ? -Math.log1p(Math.exp(-z)) : -Math.log1p(Math.exp(z))); }, 0);
    const out = { a, b, seA: Math.sqrt(va), seB: Math.sqrt(vb), lnL, aic: 4 - 2 * lnL, at: (x) => 1 / (1 + Math.exp(-(a + b * x))) };
    if (b < 0) { const h = -a / b, v = va / (b * b) + (a * a) * vb / b ** 4 - 2 * a * vab / b ** 3; out.half = { balls: h, se: Math.sqrt(Math.max(0, v)) }; }      // delta method
    return out;
  }
  /* Model 2, "each ball is its own chance": if every ball independently behaves as predicted with probability q, a turn with n balls is exact with probability q^n. */
  function perBall(rows) {
    const n = rows.length, k = rows.reduce((s, t) => s + exact(t), 0); if (n < 10 || k === 0 || k === n) return null;
    const L = (u) => rows.reduce((s, t) => s + (exact(t) ? t.balls * u : Math.log(-Math.expm1(t.balls * u))), 0);      // u = ln q < 0; L is concave in u
    let lo = -8, hi = -1e-9; const g = (Math.sqrt(5) - 1) / 2;
    for (let it = 0; it < 200; it++) { const x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo); if (L(x1) < L(x2)) lo = x1; else hi = x2; }
    const u = (lo + hi) / 2, d = Math.min(1e-4, -u / 2), curv = (L(u + d) - 2 * L(u) + L(u - d)) / (d * d), se = curv < 0 ? Math.sqrt(-1 / curv) : null, lnL = L(u);
    return { q: Math.exp(u), qLo: se === null ? null : Math.exp(u - Z * se), qHi: se === null ? null : Math.min(1, Math.exp(u + Z * se)), half: Math.log(0.5) / u, lnL, aic: 2 - 2 * lnL, at: (x) => Math.exp(u * x) };
  }
  /* Baseline for comparison: the same chance of being exact whatever the number of balls. */
  function constant(rows) { const n = rows.length, k = rows.reduce((s, t) => s + exact(t), 0); if (!n || !k || k === n) return null; const p = k / n, lnL = k * Math.log(p) + (n - k) * Math.log(1 - p); return { p, lnL, aic: 2 - 2 * lnL }; }
  function line(xs, ys) {
    const n = xs.length; if (n < 3) return null; const mx = mean(xs), my = mean(ys); let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); } if (!sxx) return null;
    const slope = sxy / sxx, intercept = my - slope * mx, sse = ys.reduce((s, y, i) => s + (y - intercept - slope * xs[i]) ** 2, 0); return { slope, intercept, half: Z * Math.sqrt(sse / (n - 2) / sxx) };
  }
  /* ---------- the exploring tools: correlation, trend with its uncertainty band, several causes at once, spread and memory ---------- */
  function pearson(xs, ys) { const n = xs.length; if (n < 3) return null; const mx = mean(xs), my = mean(ys); let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (xs[i] - mx) ** 2; b += (ys[i] - my) ** 2; c += (xs[i] - mx) * (ys[i] - my); } return a && b ? c / Math.sqrt(a * b) : null; }
  function autocorrelation(v, lags) { const n = v.length; if (n < 4) return []; const m = mean(v), den = v.reduce((s, x) => s + (x - m) ** 2, 0); if (!den) return []; return Array.from({ length: Math.min(lags, n - 2) }, (_, k) => { let s = 0; for (let i = k + 1; i < n; i++) s += (v[i] - m) * (v[i - k - 1] - m); return s / den; }); }
  /* Least-squares line with a 95% band for the line. When neighbouring leftovers resemble each other (as turns in one game do), the band is widened by sqrt((1+rho)/(1-rho)). */
  function trend(xs, ys, inOrder) {
    const n = xs.length; if (n < 4) return null; const mx = mean(xs), my = mean(ys); let sxx = 0, sxy = 0, syy = 0; for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; } if (!sxx) return null;
    const slope = sxy / sxx, intercept = my - slope * mx, res = ys.map((y, i) => y - intercept - slope * xs[i]), sse = res.reduce((s, r) => s + r * r, 0), s = Math.sqrt(sse / (n - 2));
    const rho = inOrder ? Math.max(0, Math.min(0.9, autocorrelation(res, 1)[0] || 0)) : 0, widen = Math.sqrt((1 + rho) / (1 - rho)), half = (x) => Z * widen * s * Math.sqrt(1 / n + (x - mx) ** 2 / sxx);
    return { n, slope, intercept, slopeHalf: Z * widen * s / Math.sqrt(sxx), r2: syy ? 1 - sse / syy : 0, rho, at: (x) => intercept + slope * x, half };
  }
  function invert(M) { const p = M.length, A = M.map((r, i) => r.concat(r.map((_, j) => (i === j ? 1 : 0)))); for (let c = 0; c < p; c++) { let best = c; for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[best][c])) best = r; if (Math.abs(A[best][c]) < 1e-10) return null; [A[c], A[best]] = [A[best], A[c]]; const d = A[c][c]; A[c] = A[c].map((v) => v / d); for (let r = 0; r < p; r++) if (r !== c) { const f = A[r][c]; A[r] = A[r].map((v, j) => v - f * A[c][j]); } } return A.map((r) => r.slice(p)); }
  /* Several causes at once: y = b0 + b1·x1 + ... Each x is standardised first, so the coefficients say "change in y for one typical step in x". */
  function multiple(y, columns) {
    const n = y.length, p = columns.length; if (n < p + 5) return null;
    const std = columns.map((c) => { const m = mean(c), s = Math.sqrt(c.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)); return { m, s, z: c.map((v) => (s ? (v - m) / s : 0)) }; }); if (std.some((c) => !c.s)) return null;
    const X = y.map((_, i) => [1].concat(std.map((c) => c.z[i]))), XtX = X[0].map((_, a) => X[0].map((__, b) => X.reduce((s, r) => s + r[a] * r[b], 0))), inv = invert(XtX); if (!inv) return null;
    const Xty = X[0].map((_, a) => X.reduce((s, r, i) => s + r[a] * y[i], 0)), beta = inv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0)), res = y.map((v, i) => v - X[i].reduce((s, x, j) => s + x * beta[j], 0));
    const sse = res.reduce((s, r) => s + r * r, 0), my = mean(y), syy = y.reduce((s, v) => s + (v - my) ** 2, 0), s2 = sse / (n - p - 1);
    return { n, r2: syy ? 1 - sse / syy : 0, intercept: beta[0], terms: std.map((c, j) => ({ coef: beta[j + 1], half: Z * Math.sqrt(Math.max(0, s2 * inv[j + 1][j + 1])), vif: inv[j + 1][j + 1] * (n - 1) })) };
  }
  function histogram(v, bins) { if (!v.length) return []; let lo = Math.min(...v), hi = Math.max(...v); if (lo === hi) { lo -= 0.5; hi += 0.5; } const w = (hi - lo) / bins, out = Array.from({ length: bins }, (_, i) => ({ lo: lo + i * w, hi: lo + (i + 1) * w, n: 0 })); v.forEach((x) => { out[Math.min(bins - 1, Math.floor((x - lo) / w))].n++; }); return out; }
  const api = { pearson, autocorrelation, trend, multiple, histogram, usable, exact, wilson, meanCI, summary, byBalls, rolling, logistic, perBall, constant, line };
  root.NNStats = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
