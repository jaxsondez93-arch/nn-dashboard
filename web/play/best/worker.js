/* Background worker for the best bot: loads the game's Box2D, the engine constants and the model, then answers {cmd:"choose", board} with an aim. */
self.module = { exports: {} };
importScripts("engine/box2d.js");
const BOX2D = self.module.exports; self.module = undefined;
importScripts("sim.js", "features.js", "search.js");
const ready = Promise.all([fetch("engine/engine_constants.json").then((r) => r.json()), fetch("model.json").then((r) => r.json()), fetch("../pixels781.json").then((r) => r.json())]).then(([E, model, px]) => {
  const sim = NNSim.createSimulator(BOX2D, E), scorer = NNFeatures.createScorer(model, px.pixels); return { sim, scorer, pixels: px.pixels, cfg: model.search };
});
ready.then(() => postMessage({ type: "ready" }), (e) => postMessage({ type: "error", message: String(e) }));
onmessage = async (e) => {
  if (e.data.cmd !== "choose") return;
  try { const R = await ready, t0 = performance.now(), res = NNSearch.chooseAim(R.sim, R.scorer, R.pixels, e.data.board, R.cfg, (n, of) => postMessage({ type: "progress", id: e.data.id, n, of }));
    res.think_ms = Math.round(performance.now() - t0); postMessage({ type: "choice", id: e.data.id, result: res }); }
  catch (err) { postMessage({ type: "error", id: e.data.id, message: String(err && err.stack || err) }); }
};
