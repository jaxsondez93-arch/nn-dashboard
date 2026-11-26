/* Background worker for the best bot: loads the game's Box2D, the engine constants and the model, then answers {cmd:"choose", board, cores} with an aim. With more than one core it hands
   the shots to helper workers; if the browser cannot do that, or a helper fails, it simulates them itself. */
self.module = { exports: {} };
importScripts("engine/box2d.js");
const BOX2D = self.module.exports; self.module = undefined;
importScripts("sim.js", "features.js", "search.js", "pool.js");
const ready = Promise.all([fetch("engine/engine_constants.json").then((r) => r.json()), fetch("model.json").then((r) => r.json()), fetch("../pixels781.json").then((r) => r.json())]).then(([E, model, px]) => {
  const sim = NNSim.createSimulator(BOX2D, E), scorer = NNFeatures.createScorer(model, px.pixels); return { sim, scorer, pixels: px.pixels, cfg: model.search };
});
ready.then(() => postMessage({ type: "ready", spare: Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1)) }), (e) => postMessage({ type: "error", message: String(e) }));
let helpers = [], pool = null;
function poolFor(cores) {
  if (cores <= 1 || typeof Worker === "undefined") return null;
  if (pool && pool.size === cores) return pool;
  helpers.forEach((h) => h.terminate()); helpers = []; pool = null;
  try { for (let i = 0; i < cores; i++) helpers.push(new Worker("simworker.js")); pool = NNPool.createPool(helpers); } catch (e) { pool = null; }
  return pool;
}
onmessage = async (e) => {
  if (e.data.cmd !== "choose") return;
  const { id, board } = e.data, report = (n, of, info) => postMessage({ type: "progress", id, n, of, info });
  try { const R = await ready, t0 = performance.now(), team = poolFor(e.data.cores || 1); let res = null;
    if (team) { try { team.board(board); res = await NNSearch.chooseAimParallel(team.compute, team.size, R.scorer, R.pixels, board, R.cfg, report); res.cores = team.size; } catch (err) { helpers.forEach((h) => h.terminate()); helpers = []; pool = null; } }
    if (!res) { res = NNSearch.chooseAim(R.sim, R.scorer, R.pixels, board, R.cfg, report); res.cores = 1; }
    res.think_ms = Math.round(performance.now() - t0); postMessage({ type: "choice", id, result: res }); }
  catch (err) { postMessage({ type: "error", id, message: String(err && err.stack || err) }); }
};
