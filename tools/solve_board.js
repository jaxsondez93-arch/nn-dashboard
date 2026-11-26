#!/usr/bin/env node
/* Solve one board for ONE shot: simulate every aim (the bot's 781) and report the best damage, whether any aim clears the board completely, and how the aims group into distinct outcomes.
   For a single shot this is exact brute force with the shot simulator (no learned model involved), so "is there an aim that clears this board?" can be answered by looking at all of them.

   Usage: NN_ENGINE_DIR=<folder with box2d.js and engine_constants.json> node tools/solve_board.js BOARD.json [--every K] [--all] [--out FILE]
     BOARD.json  a scene as the puzzle pages write it ({ "balls": 12, "blocks": [[x, y, health], ...], "pickups": [[x, y]] }), or a logged turn from a bot run (it has a "board" key)
     --every K   try only every Kth aim (a quick estimate; 1 = all 781)
     --all       also list every aim's damage in the output
     --out FILE  write the result there instead of printing it
   What it does not say: the simulator is exact for light blocks and drifts on repeated hits to tough blocks, so a claimed clear (or the claim that none exists) should be checked in the real game
   (NNScene.build and NNScene.fire, as the puzzle editor's test shot does) before it is believed. Aims are the bot's 781 pixels; a finer grid of directions could find narrower openings. */
"use strict";
const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..");
const S = require(path.join(root, "web/play/best/sim.js")), Scene = require(path.join(root, "web/play/scene.js"));

/* A board as the simulator wants it: [uid, x, y, hp] blocks (uids 1..n in the order of the input), the pickups, the ball count. */
function loadBoard(raw) {
  const b = raw.board || null;
  if (b) return { blocks: b.blocks.slice().sort((p, q) => p[0] - q[0]).map((k, i) => [i + 1, k[1], k[2], k[3]]), pickups: (b.pickups || []).map((p) => [p[0], p[1]]), balls: b.balls || 1 };
  const v = Scene.validate(raw); if (v.errors) throw new Error("not a valid scene: " + v.errors.join(" "));
  return { blocks: v.scene.blocks.map((k, i) => [i + 1, k[1], k[2], k[3]]), pickups: v.scene.pickups, balls: v.scene.balls };
}

/* Every aim on the board: { damage, left (the health each block has left), got (pickups collected), completed }. Same arguments as NNSearch.outcome gives the simulator. */
function solve(sim, board, pixels, every) {
  const rows = [];
  for (let i = 0; i < pixels.length; i += every) {
    const r = sim.simulate(board.blocks, pixels[i], board.pickups, board.pickups.length > 0, board.balls, 3000 + 14 * board.balls);
    let damage = 0; const left = board.blocks.map(([u, , , hp]) => { const h = Math.min(hp, r.hits[u] || 0); damage += h; return hp - h; });
    rows.push({ aim: i, pixel: pixels[i], damage, left, got: r.pickups_left ? board.pickups.length - r.pickups_left.length : 0, completed: r.completed });
  }
  return rows;
}

/* Group aims that leave the same blocks with the same health (and collect the same pickups): one group is one possible outcome of the shot. */
function summarise(board, rows) {
  const total = board.blocks.reduce((s, b) => s + b[3], 0), groups = new Map();
  for (const r of rows) { const key = JSON.stringify([r.left, r.got]), g = groups.get(key) || { damage: r.damage, left: r.left, got: r.got, aims: [] }; g.aims.push(r.aim); groups.set(key, g); }
  const list = Array.from(groups.values()).sort((a, b) => b.damage - a.damage || b.aims.length - a.aims.length), best = list[0], pixelOf = (i) => rows.find((r) => r.aim === i).pixel;
  const clears = list.filter((g) => g.damage === total);
  return {
    balls: board.balls, blocks: board.blocks.length, pickups: board.pickups.length, totalHealth: total, aimsTried: rows.length, simulationsThatHitTheStepLimit: rows.filter((r) => !r.completed).length,
    best: { damage: best.damage, cleared: best.damage === total, aims: best.aims.length, examples: best.aims.slice(0, 5).map(pixelOf) },
    clearingAims: clears.reduce((s, g) => s + g.aims.length, 0),
    distinctOutcomes: list.length, outcomes: list.slice(0, 12).map((g) => ({ damage: g.damage, left: g.left, got: g.got, aims: g.aims.length, example: pixelOf(g.aims[0]) })),
  };
}

function main() {
  const args = process.argv.slice(2), val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; }, file = args.find((a, i) => !a.startsWith("--") && !["--every", "--out"].includes(args[i - 1])), dir = process.env.NN_ENGINE_DIR;
  if (!file || !dir) { console.error("usage: NN_ENGINE_DIR=<dir> node tools/solve_board.js BOARD.json [--every K] [--all] [--out FILE]"); process.exit(2); }
  const sim = S.createSimulator(require(path.resolve(dir, "box2d.js")), require(path.resolve(dir, "engine_constants.json"))), pixels = JSON.parse(fs.readFileSync(path.join(root, "web/play/pixels781.json"), "utf8")).pixels;
  const board = loadBoard(JSON.parse(fs.readFileSync(file, "utf8"))), t0 = Date.now(), rows = solve(sim, board, pixels, Math.max(1, +val("--every", 1)));
  const out = Object.assign(summarise(board, rows), { seconds: +((Date.now() - t0) / 1000).toFixed(1) }); if (args.includes("--all")) out.all = rows.map((r) => [r.aim, r.damage, r.got]);
  const text = JSON.stringify(out, null, 1); if (val("--out")) fs.writeFileSync(val("--out"), text + "\n"); else console.log(text);
}
if (require.main === module) main();
module.exports = { loadBoard, solve, summarise };
