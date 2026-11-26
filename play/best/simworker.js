/* A helper worker: simulates one shot at a time on the board it was last given. */
self.module = { exports: {} };
importScripts("engine/box2d.js");
const BOX2D = self.module.exports; self.module = undefined;
importScripts("sim.js", "search.js");
const ready = Promise.all([fetch("engine/engine_constants.json").then((r) => r.json()), fetch("../pixels781.json").then((r) => r.json())]).then(([E, px]) => ({ sim: NNSim.createSimulator(BOX2D, E), pixels: px.pixels }));
let board = null;
onmessage = async (e) => {
  const m = e.data; if (m.board) { board = m.board; return; }
  try { const R = await ready; postMessage({ job: m.job, k: m.k, o: NNSearch.outcome(R.sim, board, NNSearch.pixelOf(R.pixels, m.i)) }); }
  catch (err) { postMessage({ job: m.job, k: m.k, error: String(err && err.message || err) }); }
};
