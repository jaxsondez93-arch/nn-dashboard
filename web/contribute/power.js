/* How hard to work. The slider is a share of ALL the processor cores the browser reports (100% = every core fully busy). This file turns that into a number of parallel
   workers and how busy each should be, applying the safety protections. Pure functions, so they can be tested without a page.
     heat        never more than 50%, and ease off when shots start taking clearly longer (browsers cannot read a temperature; slowing down is the sign we can see)
     stability   always leave one core free, and use at most 4 workers on phones and 8 elsewhere (each worker needs memory) */
(function (root) {
  "use strict";
  const HEAT_MAX = 50, PHONE_MAX = 4, DESK_MAX = 8, MIN_EASE = 0.25;
  function plan(percent, cores, opts) {
    const o = Object.assign({ heat: true, stability: true, phone: false, ease: 1 }, opts), n = Math.max(1, Math.floor(cores) || 2), asked = Math.min(100, Math.max(1, Math.round(percent) || 1)), why = [];
    let eff = asked;
    if (o.heat) { if (eff > HEAT_MAX) { eff = HEAT_MAX; why.push(`heat protection limits it to ${HEAT_MAX}%`); } if (o.ease < 1) { eff *= Math.max(MIN_EASE, o.ease); why.push("easing off because the device slowed down"); } }
    let busy = eff / 100 * n;                                                            // how many cores' worth of work
    const most = o.stability ? Math.max(1, Math.min(n - 1, o.phone ? PHONE_MAX : DESK_MAX)) : n;
    if (busy > most) { busy = most; why.push(o.stability ? "stability protection keeps the device usable" : ""); }
    const workers = Math.max(1, Math.ceil(busy - 1e-9)), duty = Math.min(1, Math.max(0.01, busy / workers));
    return { asked, percent: busy / n * 100, cores: n, workers, duty, why: why.filter(Boolean) };
  }
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  /* The heat signal: compare how long shots take now with how long they took at the start (this does not depend on the slider). Returns the new easing factor (1 = none). */
  function easing(baseMs, recentMs, ease) {
    if (baseMs.length < 100 || recentMs.length < 100) return ease; const ratio = median(recentMs) / median(baseMs);
    if (ratio > 1.35) return Math.max(MIN_EASE, ease * 0.75); if (ratio < 1.15) return Math.min(1, ease * 1.15); return ease;
  }
  const api = { HEAT_MAX, plan, easing };
  root.NNPower = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
