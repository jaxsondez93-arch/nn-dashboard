/* Game speed control, loaded inside the game only when the bot page asks for it (?bot=1). The game's physics already advances a fixed step per frame; here every frame also gets
   exactly 1/60 s of game time, whatever the real clock says, and "faster" means running more of those identical frames per screen refresh, drawing only the last one.
   So no frame is skipped or stretched. The bot page turns "turbo" on only while a shot is flying: aiming and menus stay at normal speed, because the game judges a tap by how long it
   lasts in game time. ?seed=N additionally makes the game's random numbers repeatable, for comparing speeds. */
(function () {
  "use strict";
  var query = typeof location === "undefined" ? "" : location.search;
  var STEP = 1000 / 60, BUDGET_MS = 24;
  /* How many frames are owed: real time passed, times the speed, in whole frames. Pure, so it can be tested. */
  function due(owed, passedMs, speed) {
    if (speed === "max") return Infinity;
    return Math.min(owed + passedMs * speed, STEP * speed * 4);      // never saves up more than a few screens' worth after a stall
  }
  /* The speed actually used: what the viewer asked for, held down by a temporary limit if one is set. The request itself is never changed. */
  function effective(wanted, limit) {
    var w = wanted === "max" ? Infinity : Number(wanted) || 1, l = limit === null || limit === undefined || limit === "max" ? Infinity : Number(limit) || 1, v = Math.min(w, l);
    return v === Infinity ? "max" : v;
  }
  if (typeof window !== "undefined") window.NNSpeed = { effective: effective };
  if (typeof module !== "undefined" && module.exports) { module.exports = { STEP: STEP, due: due, effective: effective }; return; }
  if (query.indexOf("bot=1") < 0) return;
  var seed = /[?&]seed=(\d+)/.exec(query);
  if (seed) { var a = Number(seed[1]) >>> 0; Math.random = function () { a = (a + 0x6d2b79f5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  var realFrame = window.requestAnimationFrame.bind(window), realNow = performance.now.bind(performance), waiting = [], now = realNow(), lastReal = now, owed = 0, wrapped = null;
  var clock = window.NNClock = { speed: 1, turbo: false, frames: 0, ballFrames: 0, achieved: null, skip: false };
  window.requestAnimationFrame = function (f) { waiting.push(f); return waiting.length; };
  window.cancelAnimationFrame = function () {};
  performance.now = function () { return now; };
  function runtime() { try { return window.cr_getC2Runtime ? window.cr_getC2Runtime() : null; } catch (e) { return null; } }
  function wrapDrawing(r) { ["drawGL", "draw"].forEach(function (name) { var real = r[name]; if (real) r[name] = function () { if (!clock.skip) return real.apply(this, arguments); }; }); wrapped = r; }
  var meterMs = 0, meterFrames = 0;
  function screen() {
    var start = realNow(), passed = start - lastReal, r = runtime(), ran = 0; lastReal = start; if (r && wrapped !== r) wrapDrawing(r);
    var speed = clock.turbo ? clock.speed : 1; owed = due(owed, Math.min(passed, 250), speed); clock.skip = true;
    while (owed >= STEP && waiting.length && (ran === 0 || realNow() - start < BUDGET_MS)) {
      now += STEP; var run = waiting; waiting = []; for (var i = 0; i < run.length; i++) run[i](now); ran++; clock.frames++; if (speed !== "max") owed -= STEP;
      r = runtime(); if (r && r.types_by_index && r.types_by_index[9] && r.types_by_index[9].instances.length) clock.ballFrames++;      // lets the bot see a shot even if it starts and ends between two looks
    }
    clock.skip = false; if (ran && r && wrapped === r) { if (r.glwrap) r.drawGL(); else r.draw(); }
    if (clock.turbo) { meterFrames += ran; meterMs += passed; if (meterMs >= 500) { clock.achieved = meterFrames * STEP / meterMs; meterMs = meterFrames = 0; } }      // speed reached while shots were flying
    realFrame(screen);
  }
  realFrame(screen);
})();
