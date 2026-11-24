/* Background worker: runs ONE work unit at a time, board by board, and sleeps between chunks so the processor is used only `duty` of the time.
   It has no access to the page, the network or anything on the device other than its own computation. Messages in: {cmd:"start", cell, block, duty} / {cmd:"stop"}. Out: progress and done. */
importScripts("core.js");
let stopFlag = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
onmessage = (e) => { const m = e.data; if (m.cmd === "stop") stopFlag = true; else if (m.cmd === "start") { stopFlag = false; run(m.cell, m.block, Math.min(1, Math.max(0.05, m.duty))); } };
async function run(cell, block, duty) {
  const u = NNCore.unitFor(cell, block), sums = { random: 0, even: 0, c2f: 0, hunch: 0 }; let t0 = performance.now(), chunk = 0;
  for (let b = 0; b < u.count; b++) {
    if (stopFlag) { postMessage({ type: "stopped", done: b }); return; }
    const r = NNCore.runBoard(u, b); for (const k of NNCore.KINDS) sums[k] += r[k]; chunk++;
    if (chunk === 5 || b === u.count - 1) {                                              // every 5 boards: report, then rest so that busy-time / total-time = duty
      const busy = performance.now() - t0; postMessage({ type: "progress", done: b + 1, total: u.count });
      if (duty < 1) await sleep(busy * (1 / duty - 1)); else await sleep(0);
      chunk = 0; t0 = performance.now();
    }
  }
  postMessage({ type: "done", result: NNCore.makeResult(u, sums) });
}
