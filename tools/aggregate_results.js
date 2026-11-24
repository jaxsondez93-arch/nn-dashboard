#!/usr/bin/env node
/* Turn volunteers' results into the community heat map. Every result is RE-COMPUTED before it is counted, so fake or damaged results change nothing.
   Usage: node tools/aggregate_results.js <folder-of-result-json-files | issues.json> [--out web/contribute/phase_diagram.json]
   An issues.json is the GitHub issues list (an array of objects with a "title" and "body"); issues whose title does not start with "Work unit result" are ignored, and the JSON result is read from the ```json block in the body.
   A unit confirmed by several volunteers counts once toward the averages and is reported as extra confirmations. */
const fs = require("fs"), path = require("path"), C = require(path.join(__dirname, "../web/contribute/core.js"));
const args = process.argv.slice(2), outIdx = args.indexOf("--out"), out = outIdx >= 0 ? args[outIdx + 1] : null, src = args.find((a, i) => a !== "--out" && i !== outIdx + 1);
function candidates(src) {
  if (!src) return [];
  const st = fs.statSync(src);
  if (st.isDirectory()) return fs.readdirSync(src).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(src, f), "utf8")); } catch (e) { return null; } });
  const data = JSON.parse(fs.readFileSync(src, "utf8")), items = Array.isArray(data) ? data : [data];
  return items.filter((it) => !(it && typeof it.title === "string" && !/^Work unit result/.test(it.title))).map((it) => { if (it && it.v === 1) return it; const m = it && typeof it.body === "string" && it.body.match(/```json\s*([\s\S]*?)```/); try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; } });
}
const seen = new Map(), cells = Array.from({ length: C.KS.length * C.QS.length }, (_, cell) => ({ cell, K: C.KS[Math.floor(cell / C.QS.length)], q: C.QS[cell % C.QS.length], units: 0, boards: 0, sums: { random: 0, even: 0, c2f: 0, hunch: 0 }, mean: { random: 0, even: 0, c2f: 0, hunch: 0 } }));
let rejected = 0, confirmations = 0, total = 0;
for (const r of candidates(src)) {
  total++; if (!r || !C.verify(r).ok) { rejected++; continue; }
  const key = r.cell + "-" + r.block; if (seen.has(key)) { confirmations++; continue; } seen.set(key, true);
  const c = cells[r.cell]; c.units++; c.boards += r.boards; for (const k of C.KINDS) c.sums[k] += r.sums[k];
}
for (const c of cells) for (const k of C.KINDS) c.mean[k] = c.boards ? c.sums[k] / c.boards : 0;
const result = { v: 1, generated: new Date().toISOString().slice(0, 10), grid: { K: C.KS, q: C.QS, units_per_cell: C.BLOCKS, boards_per_unit: C.COUNT }, total_units: seen.size, total_confirmations: confirmations, rejected, submitted: total, cells };
const text = JSON.stringify(result, null, 1); if (out) fs.writeFileSync(out, text + "\n"); else console.log(text);
console.error(`submitted ${total}: ${seen.size} distinct verified units, ${confirmations} confirmations, ${rejected} rejected`);
