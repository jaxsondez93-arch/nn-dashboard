/* The work: simulate shots of recorded training boards that have not been labelled yet, exactly the way the training data was made. Shared by the worker and the checking tool.
   A unit is one board and up to 40 of its unlabelled aims. For each aim the result is the damage done and the "margin to losing" in rows (x100, whole number; null if the shot clears the board). */
(function (root) {
  "use strict";
  const CHUNK = 40, N_AIMS = 781, RISE = 126.0, Y_LOSS = 119.0;
  function listUnits(boards) {                                                          // a fixed, ordered list: [boardIndex, firstPositionInThatBoard'sUnlabelledList]
    const units = []; boards.forEach((b, k) => { const n = N_AIMS - new Set(b.done).size; for (let s = 0; s < n; s += CHUNK) units.push([k, s]); }); return units;
  }
  function aimsOf(board, start) { const done = new Set(board.done), left = []; for (let i = 0; i < N_AIMS; i++) if (!done.has(i)) left.push(i); return left.slice(start, start + CHUNK); }
  function simulateAim(sim, board, pixel) {                                            // one shot: [damage, margin_x100 or null]
    const blocks = board.b.map((x, i) => [i + 1, x[1], x[2], x[3]]), r = sim.simulate(blocks, pixel, board.p, board.p.length > 0, board.n);
    let damage = 0, minY = Infinity; for (const [u, x, y, hp] of blocks) { const h = r.hits[u] || 0; damage += Math.min(hp, h); if (h < hp && y < minY) minY = y; }
    return [damage, minY === Infinity ? null : Math.round((minY - RISE - Y_LOSS) / RISE * 100)];
  }
  const api = { CHUNK, listUnits, aimsOf, simulateAim };
  root.NNTasks = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
