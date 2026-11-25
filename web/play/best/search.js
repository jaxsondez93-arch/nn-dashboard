/* The best bot: the scorer ranks all 781 aims, the simulator tests the most promising spread-out ones, then zooms in around the two best (budget 30 simulations; settings frozen on validation games).
   Survival guard (an addition, not part of the measured search): if a tested shot would let a block reach the loss line next turn, never choose it while a tested shot that survives exists. */
(function (root) {
  "use strict";
  const RISE = 126.0, Y_LOSS = 119.0;
  function outcome(sim, board, pixel) {                                                // simulate one aim on a board the way the training data was made
    const sorted = board.blocks.slice().sort((a, b) => a[0] - b[0]), blocks = sorted.map((b, i) => [i + 1, b[1], b[2], b[3]]), pickups = board.pickups || [];
    const r = sim.simulate(blocks, pixel, pickups, pickups.length > 0, board.balls || 1);
    let damage = 0; const alive = []; for (const [u, x, y, hp] of blocks) { const h = r.hits[u] || 0; damage += Math.min(hp, h); if (h < hp) alive.push(y); }
    const lost = alive.length > 0 && Math.min(...alive) - RISE <= Y_LOSS; return { damage, lost, completed: r.completed };
  }
  function chooseAim(sim, scorer, pixels, board, cfg, onProgress) {
    const { n1, rho, refine, budget } = cfg, sc = scorer.scoreAll(board), order = Array.from({ length: 780 }, (_, i) => i).sort((a, b) => sc[b] - sc[a] || a - b), cache = new Map(), ev = [], have = new Set();
    const test = (i) => { if (!cache.has(i)) { cache.set(i, outcome(sim, board, pixels[i])); if (onProgress) onProgress(cache.size, budget); } };
    const seeds = []; for (const i of order) { if (seeds.every((s) => Math.abs(i - s) >= rho)) seeds.push(i); if (seeds.length === n1) break; }
    for (const i of seeds.concat(780)) { ev.push(i); have.add(i); test(i); }
    const top = seeds.slice().sort((a, b) => cache.get(b).damage - cache.get(a).damage).slice(0, 2);
    for (let d = 1; d <= refine; d++) for (const i of top) for (const j of [i - d, i + d]) if (j >= 0 && j <= 779 && !have.has(j) && ev.length < budget) { ev.push(j); have.add(j); test(j); }
    for (const i of order) { if (ev.length >= budget) break; if (!have.has(i)) { ev.push(i); have.add(i); test(i); } }
    const pickBest = (list) => list.reduce((best, i) => (best === null || cache.get(i).damage > cache.get(best).damage ? i : best), null);
    const plain = pickBest(ev), safe = ev.filter((i) => !cache.get(i).lost), best = safe.length ? pickBest(safe) : plain;
    return { index: best, pixel: pixels[best], predicted: cache.get(best).damage, losing: cache.get(best).lost, sims: cache.size, guard_changed: best !== plain };
  }
  const api = { outcome, chooseAim };
  root.NNSearch = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
