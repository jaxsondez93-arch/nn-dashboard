#!/usr/bin/env node
/* Check volunteers' results by recomputing them, and keep only the good ones. Nothing a volunteer sends is trusted.
   Usage: NN_ENGINE_DIR=<folder with box2d.js and engine_constants.json> node tools/check_results.js results.csv|results.jsonl [--sample 8] [--out verified.jsonl]
   --sample N recomputes N random shots of each unit (0 = all). Browsers occasionally disagree about a shot: one-ball boards may differ on one shot per task, boards with several balls or pickups on a small share. Every recomputed value replaces the one received. */
const fs = require("fs"), path = require("path"), root = path.join(__dirname, "..");
const T = require(path.join(root, "web/contribute/tasks.js")), S = require(path.join(root, "web/play/best/sim.js"));
const args = process.argv.slice(2), opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const file = args[0], SAMPLE = +opt("--sample", 8), OUT = opt("--out", "verified.jsonl"), dir = process.env.NN_ENGINE_DIR;
if (!file || !dir) { console.error("usage: NN_ENGINE_DIR=<dir> node tools/check_results.js results.csv|results.jsonl [--sample 8] [--out verified.jsonl]"); process.exit(2); }
const data = JSON.parse(fs.readFileSync(process.env.NN_BOARDS || path.join(root, "web/contribute/boards.json"), "utf8")), px = JSON.parse(fs.readFileSync(path.join(root, "web/play/pixels781.json"), "utf8")).pixels;
const sim = S.createSimulator(require(path.resolve(dir, "box2d.js")), require(path.resolve(dir, "engine_constants.json"))), units = T.listUnits(data.boards);
function parse(line) { const i = line.indexOf("{"), j = line.lastIndexOf("}"); if (i < 0 || j < i) return null; let s = line.slice(i, j + 1); if (s.includes('""')) s = s.replace(/""/g, '"'); try { return JSON.parse(s); } catch (e) { return null; } }
const seen = new Map(); let total = 0, bad = 0, dup = 0, checked = 0, differ = 0;
for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  if (!line.includes("{")) continue; total++; const r = parse(line);
  if (!r || !Number.isInteger(r.u) || r.u < 0 || r.u >= units.length || !Array.isArray(r.d) || !Array.isArray(r.m)) { bad++; continue; }
  const [k, start] = units[r.u], board = data.boards[k], aims = T.aimsOf(board, start);
  if (r.d.length !== aims.length || r.m.length !== aims.length || !r.d.every((x) => Number.isInteger(x) && x >= 0)) { bad++; continue; }
  if (seen.has(r.u)) { dup++; continue; }
  const idx = aims.map((_, i) => i); if (SAMPLE > 0) { for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } idx.length = Math.min(SAMPLE, idx.length); }
  let wrong = 0; for (const i of idx) { const [d, m] = T.simulateAim(sim, board, px[aims[i]]); checked++; if (d !== r.d[i] || m !== r.m[i]) { wrong++; r.d[i] = d; r.m[i] = m; } }      // a recomputed value always replaces the one received
  differ += wrong; const easy = board.n === 1 && !board.p.length, ok = wrong <= (easy ? 1 : Math.max(1, Math.floor(idx.length * 0.15)));      // browsers occasionally disagree on a shot
  if (!ok) { bad++; continue; }
  seen.set(r.u, { u: r.u, board: k, aims, d: r.d, m: r.m });
}
fs.writeFileSync(OUT, Array.from(seen.values(), (v) => JSON.stringify(v)).join("\n") + (seen.size ? "\n" : ""));
console.log(`received ${total}: accepted ${seen.size} units (${Array.from(seen.values()).reduce((a, v) => a + v.d.length, 0)} shots), rejected ${bad}, repeats ${dup}; recomputed ${checked} shots, ${differ} differed -> ${OUT}`);
