/* The best bot: the scorer ranks all 781 aims, the simulator tests the most promising spread-out ones, then zooms in around the two best (budget 30 simulations; settings frozen on validation games).
   Additions, not part of the measured damage search, decide which tested shot is played. In order of importance:
     1. survive: never choose a shot that lets a block reach the loss line while a tested shot that survives exists. If EVERY tested shot loses, the budget no longer applies:
        the rest of the 781 aims are tested, those pointing at the threatening blocks first, until one survives. So a losing shot is played only when all 781 lose in the simulator;
     2. look ahead (cfg.lookahead): leave as little health as possible on blocks that would be last-chance next turn, so they die while a miss can still be put right. If no tested
        surviving shot clears them all, up to cfg.urgent more are aimed at them;
     3. get the extra ball: it adds to every later turn. If none of the first shots collects it, up to cfg.extra more are aimed towards it; around a collecting shot, neighbours are tried;
     4. with look-ahead, leave less health two rows further out;
     5. damage.
   When nothing is within three rows of the line, only cfg.calm shots make up the first search.
   The search is written as a plan that asks for batches of shots to be simulated. One processor or several can answer, and the choice is identical either way. */
(function (root) {
  "use strict";
  const RISE = 126.0, Y_LOSS = 119.0;
  const rowsLeft = (y) => Math.ceil((y - Y_LOSS) / RISE - 1e-9) - 1;                  // after this shot: 0 or less = lost now, 1 = must die next turn, 2 = the turn after
  function outcome(sim, board, pixel) {                                                // simulate one aim on a board the way the training data was made
    const sorted = board.blocks.slice().sort((a, b) => a[0] - b[0]), blocks = sorted.map((b, i) => [i + 1, b[1], b[2], b[3]]), pickups = board.pickups || [];
    const balls = board.balls || 1, r = sim.simulate(blocks, pixel, pickups, pickups.length > 0, balls, 3000 + 14 * balls);      // one ball leaves every 14 steps, so many balls need a longer limit
    let damage = 0, urgent = 0, near = 0; const alive = [];
    for (const [u, x, y, hp] of blocks) { const h = r.hits[u] || 0; damage += Math.min(hp, h); if (h < hp) { alive.push(y); const left = rowsLeft(y); if (left === 1) urgent += hp - h; else if (left === 2) near += hp - h; } }
    const lost = alive.length > 0 && Math.min(...alive) - RISE <= Y_LOSS, got = r.pickups_left ? pickups.length - r.pickups_left.length : 0;
    return { damage, lost, got, urgent, near, completed: r.completed };
  }
  /* The plan: yields { aims, stage, of } and receives the outcomes of those aims, in the same order. width = how many shots may usefully be asked for at once. */
  function* plan(scorer, pixels, board, cfg, width, onProgress) {
    const { n1, rho, refine } = cfg, ahead = !!cfg.lookahead, sc = scorer.scoreAll(board);
    // fast when calm: with nothing within three rows of the line, fewer shots are tested (cfg.calm of them)
    const calm = !!cfg.calm && board.blocks.every((b) => rowsLeft(b[2]) > 3), budget = calm ? cfg.calm : cfg.budget;
    if (onProgress) onProgress(0, budget, { scores: Array.from(sc) });                  // progress reports are for display only: they never change the choice
    const order = Array.from({ length: 780 }, (_, i) => i).sort((a, b) => sc[b] - sc[a] || a - b), cache = new Map(), ev = [], have = new Set();
    const threatens = (b) => rowsLeft(b[2]) <= 1, extra = (board.pickups || []).length && scorer.pickupOrder ? cfg.extra || 0 : 0;
    let stage = "search", of = budget + extra;
    function* ensure(aims) { const missing = aims.filter((i) => !cache.has(i)); if (missing.length) { const results = yield { aims: missing, stage, of }; missing.forEach((i, k) => cache.set(i, results[k])); } }
    const add = (i) => { ev.push(i); have.add(i); };
    function* testAll(aims) { aims.forEach(add); yield* ensure(aims); }
    /* Try candidates in order until one passes `good`; several are simulated at once, but only those up to the first success count as tested. */
    function* seek(candidates, good) { for (let p = 0; p < candidates.length; p += width) { const chunk = candidates.slice(p, p + width); yield* ensure(chunk); for (const i of chunk) { add(i); if (good(i)) return i; } } return null; }
    const around = (centre, reach, limit) => { const out = []; for (let d = 1; d <= reach; d++) for (const j of [centre - d, centre + d]) if (j >= 0 && j <= 779 && !have.has(j) && out.length < limit) out.push(j); return out; };
    const spaced = (list, limit) => { const out = []; for (const i of list) { if (out.length >= limit) break; if (!have.has(i) && !out.some((t) => Math.abs(i - t) < 3)) out.push(i); } return out; };

    const seeds = []; for (const i of order) { if (seeds.every((s) => Math.abs(i - s) >= rho)) seeds.push(i); if (seeds.length === n1) break; }
    yield* testAll(seeds.concat(780));
    const top = seeds.slice().sort((a, b) => cache.get(b).damage - cache.get(a).damage).slice(0, 2), zoom = [];
    for (let d = 1; d <= refine; d++) for (const i of top) for (const j of [i - d, i + d]) if (j >= 0 && j <= 779 && !have.has(j) && ev.length < budget) { add(j); zoom.push(j); }
    for (const i of order) { if (ev.length >= budget) break; if (!have.has(i)) { add(i); zoom.push(i); } }
    yield* ensure(zoom);
    const survives = (i) => !cache.get(i).lost, collects = (i) => cache.get(i).got > 0 && survives(i), clears = (i) => survives(i) && !cache.get(i).urgent;
    const key = (o) => (ahead ? [o.lost ? 0 : 1, -(o.urgent || 0), o.got, -(o.near || 0), o.damage] : [o.lost ? 0 : 1, o.got, o.damage]);
    const better = (i, j) => { const a = key(cache.get(i)), b = key(cache.get(j)); for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k]; return false; };
    const pickBest = (list, wins) => list.reduce((best, i) => (best === null || wins(i, best) ? i : best), null);
    // The emergency and look-ahead searches come before the extra-ball search, so a bigger extra budget can only add tests on top of the same ones
    const baseSims = ev.length; let rescued = false;
    if (!ev.some(survives)) {                                                           // emergency: every shot so far ends the game
      const threats = board.blocks.filter((b) => b[2] - RISE <= Y_LOSS).map((b) => [b[1], b[2]]), first = scorer.aimsToward ? scorer.aimsToward(threats) : [];
      stage = "rescue"; of = pixels.length;
      const saved = yield* seek([...new Set(first.concat(order, 780))].filter((i) => !have.has(i)), survives);
      if (saved !== null) { rescued = true; yield* testAll(around(saved, 3, 6)); }
    }
    const targets = ahead && scorer.aimsToward ? board.blocks.filter(threatens).map((b) => [b[1], b[2]]) : [];
    if (targets.length && !ev.some(clears)) {                                           // no tested shot deals with the blocks about to become last-chance
      stage = "threat"; of = ev.length + (cfg.urgent || 0);
      const found = yield* seek(spaced(scorer.aimsToward(targets), cfg.urgent || 0), clears);
      const centre = found !== null ? found : pickBest(ev.filter(survives), better);
      if (centre !== null && centre < 780) yield* testAll(around(centre, 3, 6));
    }
    if (extra) {
      stage = "ball"; of = ev.length + extra; let left = extra;
      if (!ev.some(collects)) { const before = ev.length; yield* seek(spaced(scorer.pickupOrder(board), extra), collects); left -= ev.length - before; }
      const found = pickBest(ev.filter(collects), better);
      if (found !== null) yield* testAll(around(found, 3, left));
    }
    const plain = pickBest(ev, (i, j) => cache.get(i).damage > cache.get(j).damage), best = pickBest(ev, better), chosen = cache.get(best);
    return { index: best, pixel: pixels[best], predicted: chosen.damage, losing: chosen.lost, collects: chosen.got, urgent: chosen.urgent || 0, threats: targets.length, pickups: (board.pickups || []).length, sims: ev.length, computed: cache.size,
      searched_all: ev.length >= pixels.length, calm, rescued, first_pass_sims: baseSims, guard_changed: cache.get(plain).lost && !chosen.lost };
  }
  const reporter = (onProgress) => { let n = 0; return (req, i, o) => { if (onProgress) onProgress(++n, req.of, { i, damage: o.damage, lost: o.lost, got: o.got, stage: req.stage }); }; };
  /* One processor: simulate each requested shot in turn. */
  function chooseAim(sim, scorer, pixels, board, cfg, onProgress) {
    const steps = plan(scorer, pixels, board, cfg, 1, onProgress), tell = reporter(onProgress); let step = steps.next();
    while (!step.done) { const req = step.value; step = steps.next(req.aims.map((i) => { const o = outcome(sim, board, pixels[i]); tell(req, i, o); return o; })); }
    return step.value;
  }
  /* Several processors: compute(aims, onEach) returns a promise of the outcomes in the order asked. */
  async function chooseAimParallel(compute, width, scorer, pixels, board, cfg, onProgress) {
    const steps = plan(scorer, pixels, board, cfg, width, onProgress), tell = reporter(onProgress); let step = steps.next();
    while (!step.done) { const req = step.value; step = steps.next(await compute(req.aims, (i, o) => tell(req, i, o))); }
    return step.value;
  }
  const api = { outcome, chooseAim, chooseAimParallel, rowsLeft };
  root.NNSearch = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
