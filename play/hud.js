/* The scoreboard over the watch page: big live counters, how close the danger is, records on this device, and a banner when a milestone falls. Display only. */
(function (root) {
  "use strict";
  const RECORD = { score: 2620, turn: 1413, balls: 199, when: "25 Nov 2026" };            // the project's longest recorded game
  const MARKS = { score: [100, 250, 500, 1000, 2000, 2620, 5000], balls: [10, 25, 50, 100, 200] };
  const rowsLeft = (y) => Math.ceil((y - 119) / 126 - 1e-9) - 1;                          // 0: lost if it survives this shot, 1: next turn, ...
  /* How many shots remain to break the lowest block (1 = this shot). null when the board is empty. */
  const shotsLeft = (blocks) => (blocks.length ? Math.max(0, Math.min(...blocks.map((b) => rowsLeft(b[2])))) + 1 : null);
  const crossed = (marks, before, now) => marks.filter((m) => before < m && now >= m);
  const api = { rowsLeft, shotsLeft, crossed, RECORD };
  root.NNHud = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;
  const $ = (id) => document.getElementById(id), calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches, KEY = "nn-best";
  let best = { score: 0, turn: 0, balls: 0 }, seen = { score: 0, balls: 1 }, shown = {}, toastTimer = 0;
  try { Object.assign(best, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  function count(id, to) { const el = $(id), from = shown[id] === undefined ? to : shown[id]; shown[id] = to; if (!el) return; if (calm || from === to) { el.textContent = to.toLocaleString(); return; }
    const t0 = performance.now(), step = (now) => { const k = Math.min(1, (now - t0) / 450); el.textContent = Math.round(from + (to - from) * k).toLocaleString(); if (k < 1 && shown[id] === to) requestAnimationFrame(step); }; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); requestAnimationFrame(step); }
  function toast(text) { const t = $("hud-toast"); if (!t) return; t.textContent = text; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200); }
  function records() { const el = $("hud-best"); if (el) el.textContent = best.score ? `best on this device: score ${best.score.toLocaleString()} · turn ${best.turn.toLocaleString()} · ${best.balls} balls` : "no game finished on this device yet"; const r = $("hud-record"); if (r) r.textContent = `project record: score ${RECORD.score.toLocaleString()} · turn ${RECORD.turn.toLocaleString()} · ${RECORD.balls} balls (${RECORD.when})`; }
  api.turn = (board, score, turn) => {
    const value = Number.isFinite(score) ? score : 0; count("hud-turn", turn); count("hud-score", value); count("hud-balls", board.balls);
    const left = shotsLeft(board.blocks), meter = $("hud-danger"); if (meter) { const level = left === null ? 4 : Math.min(4, left); meter.dataset.level = level; $("hud-danger-text").textContent = left === null ? "clear board" : left === 1 ? "MUST BREAK THIS SHOT" : left === 2 ? "2 shots left" : left === 3 ? "3 shots left" : "safe for now"; }
    for (const m of crossed(MARKS.score, seen.score, value)) toast(m === RECORD.score ? "RECORD SCORE MATCHED" : `Score ${m.toLocaleString()} reached`);
    for (const m of crossed(MARKS.balls, seen.balls, board.balls)) toast(`${m} balls`);
    if (value > RECORD.score && seen.score <= RECORD.score) toast("NEW PROJECT RECORD");
    seen = { score: value, balls: board.balls };
    if (value > best.score || turn > best.turn) { best = { score: Math.max(best.score, value), turn: Math.max(best.turn, turn), balls: Math.max(best.balls, board.balls) }; try { localStorage.setItem(KEY, JSON.stringify(best)); } catch (e) {} records(); }
  };
  api.end = (game) => { toast(`Game over at turn ${game.turns}${game.score === undefined ? "" : `, score ${game.score}`}`); seen = { score: 0, balls: 1 }; };
  records();
})(typeof self !== "undefined" ? self : globalThis);
