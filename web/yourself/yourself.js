/* "Play it yourself": scales the game to the screen and counts your turns. It only READS the game; it never sends it any input. */
"use strict";
const $ = (id) => document.getElementById(id), frame = $("game"), BEST_KEY = "nn-your-best";
let turns = 0, games = 0, flying = false, inGame = false, best = 0;
try { best = +localStorage.getItem(BEST_KEY) || 0; } catch (e) {}
function fit() { const s = $("screen").clientWidth / 480; frame.style.transform = `scale(${s})`; $("screen").style.height = Math.round(853 * s) + "px"; }
window.addEventListener("resize", fit); fit();
function show() { $("score").textContent = inGame || games ? `turns this game: ${turns} · your best: ${best} · games: ${games}` : "Press Play inside the game to begin." + (best ? ` Your best: ${best} turns.` : ""); }
setInterval(() => {
  let r; try { r = frame.contentWindow.cr_getC2Runtime(); if (!r || !r.running_layout) return; } catch (e) { return; }
  if (r.running_layout.name !== "Game") { if (inGame) { inGame = false; games++; flying = false; show(); } return; }
  if (!inGame) { inGame = true; turns = 0; show(); }
  const balls = r.types_by_index[9].instances.length;                                   // a turn = balls were in flight and then all landed
  if (balls > 0) flying = true;
  else if (flying) { flying = false; turns++; if (turns > best) { best = turns; try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {} } show(); }
}, 200);
fetch("../play/game/index.html", { method: "HEAD" }).then((r) => { if (!r.ok) throw 0; }).catch(() => { $("missing").style.display = "block"; $("stage").style.display = "none"; });
show();
