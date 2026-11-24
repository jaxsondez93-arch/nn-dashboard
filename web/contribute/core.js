/* Shared, deterministic simulation core: used by the browser worker AND by the Node verifier.
   It uses arithmetic only (+ - * / and comparisons): no exp, log, sin, cos or sqrt, whose last digits can differ between devices.
   So the same work unit gives bit-identical results on every phone, laptop and server, and anyone can re-check any result.

   The experiment (synthetic, not the real game): a "board" is a bumpy landscape of damage over 781 aims. Four strategies each get K tests and try to find the best aim:
   random, evenly spaced, spaced-then-zoom-in, and "hunch" (a noisy guess of quality q picks what to test, then zoom in). Regret = best possible minus best found.
   A work unit runs `count` boards for one (K, q) cell and returns the summed regret of each strategy. */
(function (root) {
  "use strict";
  const N_AIMS = 781, KINDS = ["random", "even", "c2f", "hunch"];
  const KS = [10, 15, 20, 30, 45, 60, 90, 120], QS = [0, 0.2, 0.4, 0.6, 0.8, 1], BLOCKS = 500, COUNT = 100, SEED0 = 1000000;   // 8 x 6 = 48 cells, 500 units each, 100 boards per unit (24,000 units, about 50 minutes of single-core work in total)

  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const normal = (rng) => { let s = 0; for (let i = 0; i < 12; i++) s += rng(); return s - 6; };          // sum of 12 uniforms: approximately N(0,1), arithmetic only
  const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };

  function makeBoard(seed) {                                                                              // bumps with compact support: height * (1 - t^2)^2
    const rng = mulberry32(seed), y = new Array(N_AIMS).fill(0), bumps = 4 + Math.floor(rng() * 4);
    for (let k = 0; k < bumps; k++) {
      const c = rng() * N_AIMS, w = 10 + rng() * 38, h = 3 + rng() * 12, R = 2 * w, lo = Math.max(0, Math.ceil(c - R)), hi = Math.min(N_AIMS - 1, Math.floor(c + R));
      for (let j = lo; j <= hi; j++) { const t = (j - c) / R, u = 1 - t * t; y[j] += h * u * u; }
    }
    return y.map((v) => Math.round(v + rng() * 0.8));
  }
  function smooth(y, w) { return y.map((_, j) => { let s = 0, c = 0; for (let d = -w; d <= w; d++) if (y[j + d] !== undefined) { s += y[j + d]; c++; } return s / c; }); }
  function top2(y, idx) { return idx.slice().sort((a, b) => y[b] - y[a]).slice(0, 2); }
  function refine(chosen, K, centres) { const have = new Set(chosen); for (let d = 1; d < N_AIMS && chosen.length < K; d++) for (const c of centres) for (const j of [c - d, c + d]) if (j >= 0 && j < N_AIMS && !have.has(j) && chosen.length < K) { chosen.push(j); have.add(j); } return chosen; }
  function choose(kind, y, K, q, rng) {
    if (kind === "random") { const s = new Set(); while (s.size < K) s.add(Math.floor(rng() * N_AIMS)); return Array.from(s); }
    if (kind === "even") return Array.from({ length: K }, (_, i) => Math.min(N_AIMS - 1, Math.floor((i + 0.5) * N_AIMS / K)));
    if (kind === "c2f") { const m = Math.max(2, Math.ceil(K * 0.6)), g = Array.from({ length: m }, (_, i) => Math.min(N_AIMS - 1, Math.floor((i + 0.5) * N_AIMS / m))); return refine(g.slice(), K, top2(y, g)); }
    const sm = smooth(y, 6), my = mean(y), spread = mean(y.map((v) => Math.abs(v - my))) * 1.25 || 1;     // spread = mean absolute deviation x 1.25 (about one standard deviation, no square root)
    const score = sm.map((v) => q * v + (1 - q) * spread * normal(rng)), order = score.map((_, j) => j).sort((a, b) => score[b] - score[a]);
    const n1 = Math.max(2, Math.ceil(K * 0.4)), rho = Math.max(3, Math.floor(N_AIMS / (n1 * 3))), seeds = [];
    for (const j of order) { if (seeds.every((s) => Math.abs(s - j) >= rho)) seeds.push(j); if (seeds.length === n1) break; }
    const chosen = seeds.slice(); refine(chosen, K, top2(y, seeds)); for (const j of order) { if (chosen.length >= K) break; if (!chosen.includes(j)) chosen.push(j); } return chosen;
  }
  const regret = (y, set) => { let best = -1, found = -1; for (let i = 0; i < y.length; i++) if (y[i] > best) best = y[i]; for (const j of set) if (y[j] > found) found = y[j]; return best - found; };

  function unitFor(cell, block) { return { cell, block, K: KS[Math.floor(cell / QS.length)], q: QS[cell % QS.length], seedStart: SEED0 + (cell * BLOCKS + block) * COUNT, count: COUNT }; }
  function runBoard(u, b) {                                                                               // regrets of all four strategies on board number b of the unit
    const seed = u.seedStart + b, y = makeBoard(seed), rng = mulberry32((seed ^ 0x9e3779b9) >>> 0), out = {};
    for (const k of KINDS) out[k] = regret(y, choose(k, y, u.K, u.q, rng)); return out;
  }
  function runUnit(u) { const sums = { random: 0, even: 0, c2f: 0, hunch: 0 }; for (let b = 0; b < u.count; b++) { const r = runBoard(u, b); for (const k of KINDS) sums[k] += r[k]; } return sums; }
  function checksum(cell, block, sums) { const s = cell + "|" + block + "|" + KINDS.map((k) => sums[k]).join(","); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ("00000000" + h.toString(16)).slice(-8); }
  function makeResult(u, sums) { return { v: 1, cell: u.cell, block: u.block, boards: u.count, sums, check: checksum(u.cell, u.block, sums) }; }
  function validShape(r) { return r && r.v === 1 && Number.isInteger(r.cell) && r.cell >= 0 && r.cell < KS.length * QS.length && Number.isInteger(r.block) && r.block >= 0 && r.block < BLOCKS && r.boards === COUNT && r.sums && KINDS.every((k) => Number.isInteger(r.sums[k]) && r.sums[k] >= 0) && typeof r.check === "string"; }
  function verify(r) {                                                                                    // recompute the whole unit and compare exactly: returns {ok, reason}
    if (!validShape(r)) return { ok: false, reason: "malformed" };
    const u = unitFor(r.cell, r.block), sums = runUnit(u);
    if (KINDS.some((k) => sums[k] !== r.sums[k])) return { ok: false, reason: "sums differ from the recomputation" };
    if (checksum(r.cell, r.block, r.sums) !== r.check) return { ok: false, reason: "checksum" };
    return { ok: true, reason: "" };
  }
  const api = { N_AIMS, KINDS, KS, QS, BLOCKS, COUNT, SEED0, makeBoard, choose, regret, unitFor, runBoard, runUnit, checksum, makeResult, validShape, verify };
  root.NNCore = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
