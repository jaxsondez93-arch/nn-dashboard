/* "Watching it think": a see-through display over the game that draws what the bot is really doing. First the scorer's opinion of all 781 aims (the faint fan), then every shot the physics
   simulator tries, as a beam whose length is the damage it found (red = that shot loses, gold = it gets the extra ball), the best so far, and finally the shot chosen.
   It only draws. It never touches the game, slows the bot or changes a choice. */
(function () {
  "use strict";
  const canvas = document.getElementById("mind"), toggle = document.getElementById("showmind"); if (!canvas) return;
  const g = canvas.getContext("2d"), W = 480, H = 853, LX = 239.9, LY = 60, calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let threats = [], dirs = [], fan = null, beams = [], best = null, chosen = null, label = "", count = "", stage = "idle", running = false, t0 = 0, endAt = 0, most = 1;
  fetch("pixels781.json").then((r) => r.json()).then((d) => { dirs = d.pixels.map(([x, y]) => { const a = Math.atan2(y - LY, x - LX); return [Math.cos(a), Math.sin(a)]; }); }).catch(() => {});
  const reach = (damage) => 90 + 520 * Math.min(1, damage / most);
  const tip = (i, r) => [LX + dirs[i][0] * r, LY + dirs[i][1] * r];
  const NAMES = { search: "SIMULATING", ball: "HUNTING THE EXTRA BALL", rescue: "DANGER · SEARCHING FOR A WAY TO SURVIVE", sturdy: "CHECKING THE SHOT IS STURDY", threat: "LOOKING AHEAD · BREAKING LOW BLOCKS" };
  const hue = (b) => (b.lost ? "255,92,92" : b.got ? "255,206,84" : "88,214,255");
  const rank = (b) => (b.lost ? 0 : 1e9) + (b.got || 0) * 1e6 + b.damage;
  function ray(i, r, colour, alpha, width) { const [x, y] = tip(i, r); g.strokeStyle = `rgba(${colour},${alpha})`; g.lineWidth = width; g.beginPath(); g.moveTo(LX, LY); g.lineTo(x, y); g.stroke(); return [x, y]; }
  function dot(x, y, radius, colour, alpha) { g.fillStyle = `rgba(${colour},${alpha})`; g.beginPath(); g.arc(x, y, radius, 0, 7); g.fill(); }
  /* Rings around the blocks that matter: red must break this shot, orange next, yellow the one after. Block positions are in game units; the view is 1.5006 times smaller. */
  function rings(now) { const S = 1.5005861664712778; for (const [, x, y, hp] of threats) { const left = window.NNHud ? NNHud.rowsLeft(y) : 9; if (left > 2) continue; const c = left <= 0 ? "255,70,70" : left === 1 ? "255,150,50" : "255,215,80", beat = calm ? 0 : Math.sin(now / (left <= 0 ? 90 : 180)) * (left <= 0 ? 5 : 2.5), cx = (x - 9) / S, cy = (y - 4) / S;
      g.strokeStyle = `rgba(${c},.95)`; g.lineWidth = left <= 0 ? 4 : 2.5; g.setLineDash(left === 2 ? [6, 6] : []); g.beginPath(); g.arc(cx, cy, 47 + beat, 0, 7); g.stroke(); g.setLineDash([]); if (left <= 1) { g.fillStyle = `rgba(${c},.95)`; g.font = "bold 12px ui-monospace, monospace"; g.fillText(left <= 0 ? `NOW · ${hp}` : `NEXT · ${hp}`, cx - 26, cy - 54 - beat); } } }
  function draw(now) {
    g.clearRect(0, 0, W, H); const fade = endAt ? Math.max(0, 1 - (now - endAt) / 900) : 1;
    if (stage === "idle" || !dirs.length || fade <= 0 || (toggle && !toggle.checked)) { running = false; return; }
    g.save(); g.globalAlpha = fade; g.globalCompositeOperation = "lighter";
    if (fan) { const grow = calm ? 1 : Math.min(1, (now - t0) / 260); for (let i = 0; i < fan.length && i < dirs.length; i += 2) ray(i, 26 + 74 * fan[i] * grow, "150,120,255", 0.10 + 0.45 * fan[i] ** 3, 1); }
    if (!calm && !chosen) { const spin = (now - t0) / 340; for (let k = 0; k < 3; k++) { g.strokeStyle = `rgba(88,214,255,${0.55 - k * 0.15})`; g.lineWidth = 2; g.beginPath(); g.arc(LX, LY, 20 + k * 11, spin * (k % 2 ? -1 : 1) + k * 2, spin * (k % 2 ? -1 : 1) + k * 2 + 1.7); g.stroke(); }
      const sweep = Math.PI * (0.5 + 0.46 * Math.sin((now - t0) / 420)); g.strokeStyle = "rgba(88,214,255,.16)"; g.lineWidth = 9; g.beginPath(); g.moveTo(LX, LY); g.lineTo(LX + Math.cos(sweep) * 640, LY + Math.sin(sweep) * 640); g.stroke(); }
    for (const b of beams) { const age = (now - b.at) / 700, fresh = Math.max(0, 1 - age), r = reach(b.damage) * (calm ? 1 : Math.min(1, (now - b.at) / 150)), [x, y] = ray(b.i, r, hue(b), 0.14 + 0.7 * fresh, 1 + 2.5 * fresh); dot(x, y, 2 + 4 * fresh, hue(b), 0.35 + 0.65 * fresh); }
    if (best && !chosen) { const [x, y] = ray(best.i, reach(best.damage), hue(best), 0.95, 2.5), pulse = calm ? 0 : Math.sin(now / 110) * 3; g.strokeStyle = `rgba(${hue(best)},.9)`; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 11 + pulse, 0, 7); g.stroke(); }
    if (chosen) { const k = Math.min(1, (now - chosen.at) / 220), [x, y] = ray(chosen.i, 700 * (calm ? 1 : k), "150,255,190", 0.95, 3); ray(chosen.i, 700 * (calm ? 1 : k), "150,255,190", 0.22, 14); dot(x, y, 7, "220,255,230", 0.9); }
    g.globalCompositeOperation = "source-over"; rings(now); g.fillStyle = "rgba(8,14,24,.72)"; g.fillRect(8, H - 62, W - 16, 52); g.strokeStyle = "rgba(88,214,255,.5)"; g.lineWidth = 1; g.strokeRect(8.5, H - 61.5, W - 17, 51);
    g.fillStyle = "#8fe6ff"; g.font = "bold 15px ui-monospace, monospace"; g.fillText(label, 20, H - 39); g.fillStyle = "#dbe7f5"; g.font = "13px ui-monospace, monospace"; g.fillText(count, 20, H - 19);
    g.restore(); if (calm && !endAt) { running = false; return; } requestAnimationFrame(draw);
  }
  const wake = () => { if (!running) { running = true; requestAnimationFrame(draw); } };
  window.NNThought = {
    start(board) { threats = (board && board.blocks) || []; fan = null; beams = []; best = null; chosen = null; most = 1; endAt = 0; t0 = performance.now(); stage = "search"; label = "READING THE BOARD"; count = "asking the scorer about 781 aims"; wake(); },
    progress(n, of, info) {
      if (stage === "idle" || !info) return;
      if (info.scores) { const lo = Math.min(...info.scores), span = Math.max(...info.scores) - lo || 1; fan = info.scores.map((s) => (s - lo) / span); label = "SCORED 781 AIMS"; count = "now testing the promising ones with real physics"; }
      else { stage = info.stage || "search"; most = Math.max(most, info.damage); const b = { i: info.i, damage: info.damage, lost: info.lost, got: info.got, at: performance.now() }; beams.push(b); if (beams.length > 140) beams.shift(); if (!best || rank(b) > rank(best)) best = b;
        label = `${NAMES[stage] || "SIMULATING"}  ${n}/${of}`; count = best.lost ? "every shot tried so far loses" : `best so far: ${best.damage} damage${best.got ? " + EXTRA BALL" : ""}`; }
      wake();
    },
    choose(result) { if (stage === "idle") return; chosen = { i: result.index, at: performance.now() }; label = result.losing ? "NO WAY TO SURVIVE FOUND" : `LOCKED · ${result.sims} shots simulated`; count = `expecting ${result.predicted} damage${result.collects ? " + extra ball" : ""}`; endAt = performance.now() + 500; wake(); },
    clear() { stage = "idle"; g.clearRect(0, 0, W, H); }
  };
})();
