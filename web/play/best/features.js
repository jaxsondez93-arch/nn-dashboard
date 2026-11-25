/* The learned scorer: 40 numbers describing "this board and this aim", weighted by the ridge model in model.json. Ported from the Python featurizer.
   Order: 11 board values, 17 aim-angle values (sines, cosines, angle/pi), 12 geometric ray values (what a straight line along the aim would hit first, with one wall bounce). */
(function (root) {
  "use strict";
  function createScorer(model, pixels) {
    const F = model.features, [x0, x1] = F.x_range, [y0, y1] = F.y_range, L = F.launch, W = F.field_w;
    const ang = pixels.map(([px, py]) => Math.atan2(py * F.action_scale - L[1], px * F.action_scale - L[0]));
    function boardValues(b) {
      const bl = b.blocks; let v = [0, 0, 0, 0, 0, 0, 0, 0];
      if (bl.length) { const hp = bl.map((k) => k[3]), ys = bl.map((k) => k[2]), sum = hp.reduce((a, h) => a + h, 0), ymin = Math.min(...ys), ymax = Math.max(...ys);
        const lo = bl.filter((k) => k[2] <= ymin + 130).reduce((a, k) => a + k[3], 0), hi = bl.filter((k) => k[2] >= ymax - 130).reduce((a, k) => a + k[3], 0);
        v = [bl.length / 30, Math.log1p(sum), Math.log1p(Math.max(...hp)), sum / bl.length / 10, (ymin - y0) / (y1 - y0), (ymax - y0) / (y1 - y0), Math.log1p(lo), Math.log1p(hi)]; }
      return v.concat([Math.log1p(b.balls), (b.pickups || []).length / 3.0, (b.turn || 0) / 100.0]);
    }
    function firstHit(ox, oy, dx, dy, centres, R) {                                    // nearest circle hit by the ray: {hit, t, idx}
      let best = Infinity, idx = 0; for (let i = 0; i < centres.length; i++) { const ex = ox - centres[i][0], ey = oy - centres[i][1], b = ex * dx + ey * dy, c = ex * ex + ey * ey - R * R, disc = b * b - c; if (disc > 0) { const t = -b - Math.sqrt(disc); if (t > 0 && t < best) { best = t; idx = i; } } }
      return best === Infinity ? { hit: false, t: 0, idx: 0 } : { hit: true, t: best, idx };
    }
    function rayValues(b, a) {
      const out = new Array(12).fill(0), bl = b.blocks; if (!bl.length) return out;
      const dx = Math.cos(a), dy = Math.sin(a), C = bl.map((k) => [k[1], k[2]]), R = F.block_r + F.ball_r, h = firstHit(L[0], L[1], dx, dy, C, R);
      const hpmax = Math.max(1, ...bl.map((k) => k[3])), ymin = Math.min(...bl.map((k) => k[2])), ymax = Math.max(...bl.map((k) => k[2])), k = bl[h.idx];
      out[0] = h.hit ? 1 : 0; out[1] = h.hit ? Math.min(h.t, 2000) / 2000 : 1; out[2] = h.hit ? Math.log1p(k[3]) : 0; out[3] = h.hit ? (k[2] - y0) / (y1 - y0) : 0; out[4] = h.hit ? (k[1] - x0) / (x1 - x0) : 0;
      out[5] = h.hit && k[2] <= ymin + 60 ? 1 : 0; out[6] = h.hit && k[2] >= ymax - 60 ? 1 : 0; out[11] = h.hit ? k[3] / hpmax : 0;
      if (b.pickups && b.pickups.length) { const p = firstHit(L[0], L[1], dx, dy, b.pickups, F.pickup_r + F.ball_r); out[7] = p.hit && (!h.hit || p.t < h.t) ? 1 : 0; }
      if (W !== null && W !== undefined) { const tw = dx < 0 ? (0 - L[0]) / dx : (dx > 0 ? (W - L[0]) / dx : Infinity), ok = Number.isFinite(tw) && tw > 0 && (!h.hit || tw < h.t);
        const g = firstHit(L[0] + (ok ? tw : 0) * dx, L[1] + (ok ? tw : 0) * dy, -dx, dy, C, R), h2 = g.hit && ok; out[8] = h2 ? 1 : 0; out[9] = h2 ? Math.log1p(bl[g.idx][3]) : 0; out[10] = h2 ? (bl[g.idx][2] - y0) / (y1 - y0) : 0; }
      return out;
    }
    function features(b, i, bv) {
      const a = ang[i], four = []; for (let k = 1; k <= F.fourier_k; k++) four.push(Math.sin(a * k)); for (let k = 1; k <= F.fourier_k; k++) four.push(Math.cos(a * k)); four.push(a / Math.PI);
      return (bv || boardValues(b)).concat(four, rayValues(b, a)).map(Math.fround);
    }
    function scoreAll(b) { const bv = boardValues(b), w = model.weights, mu = model.mean, sd = model.std; return ang.map((_, i) => { const x = features(b, i, bv); let s = w[x.length]; for (let j = 0; j < x.length; j++) s += w[j] * (x[j] - mu[j]) / sd[j]; return s; }); }
    return { features, scoreAll, angles: ang };
  }
  const api = { createScorer };
  root.NNFeatures = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
