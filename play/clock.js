/* Game speed control, loaded inside the game only when the bot page asks for it (?bot=1). The game's physics already advances a fixed step per frame; here every frame also gets
   exactly 1/60 s of game time, whatever the real clock says, and "faster" means running more of those identical frames per screen refresh, drawing only the last one.
   So no frame is skipped or stretched. The bot page turns "turbo" on only while a shot is flying: aiming and menus stay at normal speed, because the game judges a tap by how long it
   lasts in game time. ?seed=N additionally makes the game's random numbers repeatable, for comparing speeds.
   While the page says the game is scrolled out of sight (NNClock.offscreen) every frame is still run, so the game plays exactly the same, but nothing is painted: painting is most of its cost.
   When a shot has destroyed every block and there is no pickup left, nothing the remaining balls do can change anything (the score, the board and the ball count are final), so the turn is ended there
   instead of launching and waiting for them all (see endIfEmpty). ?fastend=0 turns that off. */
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
  var clock = window.NNClock = { speed: 1, turbo: false, frames: 0, ballFrames: 0, achieved: null, skip: false, offscreen: false, fastEnd: query.indexOf("fastend=0") < 0, cuts: 0, cutAt: -1000 };
  window.requestAnimationFrame = function (f) { waiting.push(f); return waiting.length; };
  window.cancelAnimationFrame = function () {};
  performance.now = function () { return now; };
  function runtime() { try { return window.cr_getC2Runtime ? window.cr_getC2Runtime() : null; } catch (e) { return null; } }
  function wrapDrawing(r) { ["drawGL", "draw"].forEach(function (name) { var real = r[name]; if (real) r[name] = function () { if (!clock.skip) return real.apply(this, arguments); }; }); wrapped = r; }
  var gv = null, gvFor = null;
  function globals(r) { if (gvFor !== r) { gv = {}; (r.all_global_vars || []).forEach(function (v) { gv[v.name] = v; }); gvFor = r; } return gv; }
  /* No block and no pickup left while a shot is on: the balls still to come cannot change anything, so end the turn now. It ends by the game's own rule (it ends when ballEnd reaches 0):
     stop the launching (ballStart = 0), say that only the balls in flight are left (ballEnd = how many), and remove those; each one counts itself off, as the game does when a ball is lost, and ballEnd reaches 0. */
  function endIfEmpty(r) {
    if (!r || !r.running_layout || r.running_layout.name !== "Game" || !r.types_by_index) return;
    var t = r.types_by_index; if (!t[9] || !t[11] || !t[22] || t[11].instances.length || t[22].instances.length) return;
    var g = globals(r); if (!g.Tap || g.Tap.data !== 1 || !g.ballStart || !g.ballEnd) return;
    var flying = t[9].instances.slice(); if (!flying.length && !(g.ballStart.data > 0)) return;           // nothing left to cut short: the turn ends by itself
    if (clock.frames - clock.cutAt < 30) return; clock.cutAt = clock.frames;
    g.ballStart.data = 0; g.ballEnd.data = flying.length; for (var i = 0; i < flying.length; i++) r.DestroyInstance(flying[i]); clock.cuts++;
  }
  var meterMs = 0, meterFrames = 0;
  function screen() {
    var start = realNow(), passed = start - lastReal, r = runtime(), ran = 0; lastReal = start; if (r && wrapped !== r) wrapDrawing(r);
    var speed = clock.turbo ? clock.speed : 1; owed = due(owed, Math.min(passed, 250), speed); clock.skip = true;
    while (owed >= STEP && waiting.length && (ran === 0 || realNow() - start < BUDGET_MS)) {
      now += STEP; var run = waiting; waiting = []; for (var i = 0; i < run.length; i++) run[i](now); ran++; clock.frames++; if (speed !== "max") owed -= STEP;
      r = runtime(); if (r && r.types_by_index && r.types_by_index[9] && r.types_by_index[9].instances.length) clock.ballFrames++;      // lets the bot see a shot even if it starts and ends between two looks
      if (clock.fastEnd && clock.turbo && (clock.frames & 3) === 0) endIfEmpty(r);
    }
    clock.skip = false; if (ran && r && wrapped === r && !clock.offscreen) { if (r.glwrap) r.drawGL(); else r.draw(); }
    if (clock.turbo) { meterFrames += ran; meterMs += passed; if (meterMs >= 500) { clock.achieved = meterFrames * STEP / meterMs; meterMs = meterFrames = 0; } }      // speed reached while shots were flying
    realFrame(screen);
  }
  realFrame(screen);
})();
