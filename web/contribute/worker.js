/* Background worker: computes one unit at a time with the game's physics, resting between shots so the device stays usable (busy about a third of the time). */
self.module = { exports: {} };
importScripts("../play/best/engine/box2d.js");
const BOX2D = self.module.exports; self.module = undefined;
importScripts("../play/best/sim.js", "tasks.js");
const DUTY = 0.35, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let stop = false;
const ready = Promise.all([fetch("../play/best/engine/engine_constants.json").then((r) => r.json()), fetch("boards.json").then((r) => r.json()), fetch("../play/pixels781.json").then((r) => r.json())])
  .then(([E, data, px]) => ({ sim: NNSim.createSimulator(BOX2D, E), boards: data.boards, units: NNTasks.listUnits(data.boards), pixels: px.pixels }));
ready.then((R) => postMessage({ type: "ready", units: R.units.length }), (e) => postMessage({ type: "error", message: String(e) }));
onmessage = async (e) => {
  if (e.data.cmd === "stop") { stop = true; return; }
  if (e.data.cmd !== "unit") return; stop = false;
  try {
    const R = await ready, u = e.data.unit, [k, start] = R.units[u], board = R.boards[k], aims = NNTasks.aimsOf(board, start), d = [], m = [];
    for (let i = 0; i < aims.length; i++) {
      if (stop) return;
      const t0 = performance.now(), r = NNTasks.simulateAim(R.sim, board, R.pixels[aims[i]]); d.push(r[0]); m.push(r[1]);
      postMessage({ type: "shot" }); await sleep((performance.now() - t0) * (1 / DUTY - 1));
    }
    postMessage({ type: "unit", result: { u, d, m } });
  } catch (err) { postMessage({ type: "error", message: String(err && err.stack || err) }); }
};
