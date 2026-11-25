/* The best bot: the scorer ranks all 781 aims, the simulator tests the most promising spread-out ones, then zooms in around the two best (budget 30 simulations; settings frozen on validation games).
   Two additions, not part of the measured damage search, decide which tested shot is played. In order of importance:
     1. survive: never choose a shot that lets a block reach the loss line next turn while a tested shot that survives exists. If EVERY tested shot loses, the budget no longer applies:
        the rest of the 781 aims are tested, those pointing at the threatening blocks first, until one survives. So a losing shot is played only when all 781 lose in the simulator;
     2. get the extra ball: it adds to every later turn, so a surviving shot that collects it beats any that does not. If none of the first shots collects it, up to cfg.extra more are
        tested, aimed towards it; around a collecting shot, neighbours are tried for more damage;
     3. damage. */
(function (root) {
  "use strict";
  const RISE = 126.0, Y_LOSS = 119.0;
  function outcome(sim, board, pixel) {                                                // simulate one aim on a board the way the training data was made
    const sorted = board.blocks.slice().sort((a, b) => a[0] - b[0]), blocks = sorted.map((b, i) => [i + 1, b[1], b[2], b[3]]), pickups = board.pickups || [];
    const balls = board.balls || 1, r = sim.simulate(blocks, pixel, pickups, pickups.length > 0, balls, 3000 + 14 * balls);      // one ball leaves every 14 steps, so many balls need a longer limit
    let damage = 0; const alive = []; for (const [u, x, y, hp] of blocks) { const h = r.hits[u] || 0; damage += Math.min(hp, h); if (h < hp) alive.push(y); }
    const lost = alive.length > 0 && Math.min(...alive) - RISE <= Y_LOSS, got = r.pickups_left ? pickups.length - r.pickups_left.length : 0;
    return { damage, lost, got, completed: r.completed };
  }
  function chooseAim(sim, scorer, pixels, board, cfg, onProgress) {
    const { n1, rho, refine, budget } = cfg, sc = scorer.scoreAll(board);
    if (onProgress) onProgress(0, budget, { scores: Array.from(sc) });                  // progress reports are for display only: they never change the choice
    let stage = "search";
    const tell = (i, n, of) => { if (onProgress) { const o = cache.get(i); onProgress(n, of, { i, damage: o.damage, lost: o.lost, got: o.got, stage }); } };
    const order = Array.from({ length: 780 }, (_, i) => i).sort((a, b) => sc[b] - sc[a] || a - b), cache = new Map(), ev = [], have = new Set();
    const extra = (board.pickups || []).length && scorer.pickupOrder ? cfg.extra || 0 : 0;
    const test = (i) => { if (!cache.has(i)) { cache.set(i, outcome(sim, board, pixels[i])); tell(i, cache.size, budget + extra); } };
    const seeds = []; for (const i of order) { if (seeds.every((s) => Math.abs(i - s) >= rho)) seeds.push(i); if (seeds.length === n1) break; }
    for (const i of seeds.concat(780)) { ev.push(i); have.add(i); test(i); }
    const top = seeds.slice().sort((a, b) => cache.get(b).damage - cache.get(a).damage).slice(0, 2);
    for (let d = 1; d <= refine; d++) for (const i of top) for (const j of [i - d, i + d]) if (j >= 0 && j <= 779 && !have.has(j) && ev.length < budget) { ev.push(j); have.add(j); test(j); }
    for (const i of order) { if (ev.length >= budget) break; if (!have.has(i)) { ev.push(i); have.add(i); test(i); } }
    const collects = (i) => cache.get(i).got > 0 && !cache.get(i).lost;
    const better = (i, j) => { const a = cache.get(i), b = cache.get(j); return a.lost !== b.lost ? !a.lost : a.got !== b.got ? a.got > b.got : a.damage > b.damage; };      // survive, then the ball, then damage
    const pickBest = (list, wins) => list.reduce((best, i) => (best === null || wins(i, best) ? i : best), null);
    // The emergency search comes before the extra-ball search, so a bigger extra budget can only add tests on top of the same ones
    const baseSims = cache.size; let rescued = false;
    if (!ev.some((i) => !cache.get(i).lost)) {                                           // emergency: every shot so far ends the game
      const threats = board.blocks.filter((b) => b[2] - RISE <= Y_LOSS).map((b) => [b[1], b[2]]), first = scorer.aimsToward ? scorer.aimsToward(threats) : [], queue = [...new Set(first.concat(order, 780))];
      stage = "rescue";
      for (const i of queue) { if (have.has(i)) continue; ev.push(i); have.add(i); if (!cache.has(i)) { cache.set(i, outcome(sim, board, pixels[i])); tell(i, cache.size, pixels.length); }
        if (!cache.get(i).lost) { rescued = true; for (let d = 1; d <= 3; d++) for (const j of [i - d, i + d]) if (j >= 0 && j <= 779 && !have.has(j)) { ev.push(j); have.add(j); test(j); } break; } }
    }
    stage = "ball";
    if (extra) {
      let left = extra; const tried = [], add = (i) => { ev.push(i); have.add(i); test(i); left--; };
      if (!ev.some(collects)) for (const i of scorer.pickupOrder(board)) { if (left <= 0) break; if (have.has(i) || tried.some((t) => Math.abs(i - t) < 3)) continue; tried.push(i); add(i); if (collects(i)) break; }
      const found = pickBest(ev.filter(collects), better);
      if (found !== null) for (let d = 1; d <= 3; d++) for (const j of [found - d, found + d]) if (j >= 0 && j <= 779 && !have.has(j) && left > 0) add(j);
    }
    const plain = pickBest(ev, (i, j) => cache.get(i).damage > cache.get(j).damage), best = pickBest(ev, better), chosen = cache.get(best);
    return { index: best, pixel: pixels[best], predicted: chosen.damage, losing: chosen.lost, collects: chosen.got, pickups: (board.pickups || []).length, sims: cache.size, searched_all: cache.size >= pixels.length, rescued, first_pass_sims: baseSims, guard_changed: cache.get(plain).lost && !chosen.lost };
  }
  const api = { outcome, chooseAim };
  root.NNSearch = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
