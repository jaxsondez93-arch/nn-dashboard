/* Shares the shots to be simulated among several helper workers. Each takes one shot at a time, so fast helpers do more. Results come back in the order asked, so which helper
   finishes first never affects the choice. */
(function (root) {
  "use strict";
  function createPool(helpers) {
    let job = 0, pending = null;
    const feed = (h) => { if (!pending || pending.next >= pending.aims.length) return; const k = pending.next++; h.postMessage({ job: pending.job, k, i: pending.aims[k] }); };
    helpers.forEach((h) => { h.onmessage = (e) => { const m = e.data; if (!pending || m.job !== pending.job) return; if (m.error) { const p = pending; pending = null; p.fail(new Error(m.error)); return; }
      pending.out[m.k] = m.o; pending.each(pending.aims[m.k], m.o); if (++pending.done === pending.aims.length) { const p = pending; pending = null; p.ok(p.out); } else feed(h); };
      h.onerror = (e) => { if (pending) { const p = pending; pending = null; p.fail(new Error(e.message || "a helper failed")); } }; });
    return { size: helpers.length, board(board) { helpers.forEach((h) => h.postMessage({ board })); },
      compute(aims, each) { return new Promise((ok, fail) => { pending = { job: ++job, aims, each, out: new Array(aims.length), next: 0, done: 0, ok, fail }; if (!aims.length) { pending = null; ok([]); return; } helpers.forEach(feed); }); } };
  }
  const api = { createPool };
  root.NNPool = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
