/* Sending finished results: how a message is packed, when the next one may go, and when to pause the work so the backlog cannot grow without limit.
   The relay accepts messages up to 4 KB and only so many a day, so each message is compressed to carry as much as possible. Pure functions, so they can be tested without a page. */
(function (root) {
  "use strict";
  const MAX_BYTES = 3800, MAX_UNITS = 200;
  const GAP = 20000, WAIT = 45000, FULL = 80, BACKOFF = 300000;                      // at least GAP between tries; go sooner than WAIT only with about a full message (FULL tasks); BACKOFF after "slow down"
  const HOLD = 600, RESUME = 300;                                                     // stop taking new tasks at HOLD waiting, start again at RESUME
  const plain = (batch) => JSON.stringify({ v: 3, results: batch });
  async function squeeze(text) {                                                      // gzip, then base64
    const bytes = new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  /* The longest run from the front of the queue that fits in one message. Returns { count, body }. */
  async function pack(queue, compress) {
    const make = async (n) => (compress ? JSON.stringify({ v: 4, z: await squeeze(plain(queue.slice(0, n))) }) : plain(queue.slice(0, n)));
    let lo = 1, hi = Math.min(queue.length, MAX_UNITS), best = await make(1);
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2), body = await make(mid); if (body.length <= MAX_BYTES) { lo = mid; best = body; } else hi = mid - 1; }
    return { count: lo, body: best };
  }
  const due = (s) => s.queued > 0 && s.now >= s.blockedUntil && s.now - s.lastTry >= GAP && (s.queued >= FULL || s.now - s.lastSend >= WAIT);
  const hold = (holding, queued) => (holding ? queued > RESUME : queued >= HOLD);
  const api = { MAX_BYTES, GAP, WAIT, FULL, BACKOFF, HOLD, RESUME, pack, due, hold };
  root.NNOutbox = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
