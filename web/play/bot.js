/* Aim selection for the real game, using only what a player can see on screen: the position and hp of each block. No simulator.
   A port of the geometry strategies of the earlier Playwright bot (play_bot_geometry_v4): the arms are
     top    aim at the topmost block            wall   aim at a block close to a side wall
     pair   aim at the block with the smallest gap to its nearest neighbour             random  any of the 781 aims
   Aim = the candidate pixel whose launch angle is closest to the line from the launcher to the target block's centre. */
(function (root) {
  "use strict";
  const SCALE = 1280 / 853, LX = 360, LY = 90, M_PER = 0.02;
  const OCT = [[0.84, 0.84], [0.0, 1.2], [-0.84, 0.84], [-1.2, 0.0], [-0.84, -0.84], [0.0, -1.2], [0.84, -0.84], [1.2, 0.0]];
  let PIX = [], ANG = [];
  function setPixels(p) { PIX = p; ANG = p.map(([px, py]) => Math.atan2(py * SCALE - LY, px * SCALE - LX)); }
  const bm = (b) => [(b.x - 9) * M_PER, b.y * M_PER];                                  // sprite position -> metres
  const poly = (b) => { const [cx, cy] = bm(b); return OCT.map(([x, y]) => [cx + x, cy + y]); };
  function segDist(p, a, b) { const ax = b[0] - a[0], ay = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ax + (p[1] - a[1]) * ay) / (ax * ax + ay * ay))); return Math.hypot(p[0] - a[0] - t * ax, p[1] - a[1] - t * ay); }
  function overlap(P, Q) {                                                             // separating-axis test between two convex polygons
    for (const poly_ of [P, Q]) for (let i = 0; i < poly_.length; i++) {
      const a = poly_[i], b = poly_[(i + 1) % poly_.length], nx = b[1] - a[1], ny = a[0] - b[0], pa = P.map(([x, y]) => x * nx + y * ny), qa = Q.map(([x, y]) => x * nx + y * ny);
      if (Math.max(...pa) < Math.min(...qa) || Math.max(...qa) < Math.min(...pa)) return false;
    } return true;
  }
  function edgeGap(b, c) {
    const P = poly(b), Q = poly(c); if (overlap(P, Q)) return 0; let best = Infinity;
    for (const p of P) for (let j = 0; j < Q.length; j++) best = Math.min(best, segDist(p, Q[j], Q[(j + 1) % Q.length]));
    for (const q of Q) for (let j = 0; j < P.length; j++) best = Math.min(best, segDist(q, P[j], P[(j + 1) % P.length])); return best;
  }
  function nnGap(b, blocks) { let g = null; for (const c of blocks) if (c.uid !== b.uid) { const e = edgeGap(b, c); if (g === null || e < g) g = e; } return g; }
  function targets(blocks) {
    const wall = blocks.filter((b) => (bm(b)[0] - 1.2) < 0.97 || (14.4 - (bm(b)[0] + 1.2)) < 0.97);
    const gaps = blocks.map((b) => [nnGap(b, blocks), b]).filter((x) => x[0] !== null), pair = gaps.length ? [gaps.reduce((m, x) => (x[0] < m[0] ? x : m))[1]] : [];
    const top = blocks.length ? [blocks.reduce((m, b) => (b.y < m.y ? b : m))] : [];
    return { wall, pair, top };
  }
  function aimAt(b) { const ta = Math.atan2(b.y - LY, b.x - LX); let bi = 0, bd = Infinity; for (let i = 0; i < ANG.length; i++) { const d = Math.abs(ANG[i] - ta); if (d < bd) { bd = d; bi = i; } } return bi; }
  /* strategy: "random" | "top" | "pair" | "wall" | "mix" (a random arm each turn, like the earlier bot). rng: function returning [0,1). Returns {index, pixel, arm, target}. */
  function pickAim(strategy, blocks, rng) {
    const T = targets(blocks); let arm = strategy;
    if (strategy === "mix") { const arms = ["wall", "pair", "top"].filter((k) => T[k].length).concat("random"); arm = arms[Math.floor(rng() * arms.length)]; }
    if (arm === "random" || !T[arm] || !T[arm].length) { const i = Math.floor(rng() * PIX.length); return { index: i, pixel: PIX[i], arm: "random", target: null }; }
    const tgt = T[arm][Math.floor(rng() * T[arm].length)], i = aimAt(tgt); return { index: i, pixel: PIX[i], arm, target: tgt.uid };
  }
  const api = { setPixels, pickAim, targets, edgeGap, aimAt, bm, poly };
  root.NNExactBot = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
