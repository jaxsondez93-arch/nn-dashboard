/* Background worker: computes one unit at a time with the game's physics, resting between shots so that it is busy only the share of the time the page asks for. Several may run at once. */
self.module = { exports: {} };
importScripts("../play/best/engine/box2d.js");
const BOX2D = self.module.exports; self.module = undefined;
importScripts("../play/best/sim.js", "tasks.js");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let duty = 0.25;                                                                        // share of the time spent computing; the page sets it and may change it at any moment
const ready = Promise.all([fetch("../play/best/engine/engine_constants.json").then((r) => r.json()), fetch("boards.json").then((r) => r.json()), fetch("../play/pixels781.json").then((r) => r.json())])
  .then(([E, data, px]) => ({ sim: NNSim.createSimulator(BOX2D, E), boards: data.boards, units: NNTasks.listUnits(data.boards), pixels: px.pixels }));
ready.then((R) => postMessage({ type: "ready", units: R.units.length }), (e) => postMessage({ type: "error", message: String(e) }));
onmessage = async (e) => {
  if (e.data.duty) duty = Math.min(1, Math.max(0.01, e.data.duty));
  if (e.data.cmd !== "unit") return;
  try {
    const R = await ready, u = e.data.unit, [k, start] = R.units[u], board = R.boards[k], aims = NNTasks.aimsOf(board, start), d = [], m = [], k2 = [];
    for (let i = 0; i < aims.length; i++) {
      const t0 = performance.now(), r = NNTasks.simulateAim(R.sim, board, R.pixels[aims[i]]), ms = performance.now() - t0; d.push(r[0]); m.push(r[1]); k2.push(r[2]);
      postMessage({ type: "shot", ms }); await sleep(ms * (1 / duty - 1));            // reads the latest setting each shot
    }
    postMessage({ type: "unit", result: { u, d, m, k: k2 } });
  } catch (err) { postMessage({ type: "error", message: String(err && err.stack || err) }); }
};
