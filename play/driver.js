/* Runs the bot against the real game in the iframe. Layout: helpers -> reading the game -> sending input -> the play loop -> screen/telemetry.
   The loop mirrors the earlier Playwright bot: wait for a settled board, choose an aim, press at that pixel, wait for the balls to finish, record, repeat.
   It reads the game's own runtime object (same page origin) and sends pointer and mouse events to the canvas. It makes no network requests. */
"use strict";
const $ = (id) => document.getElementById(id), frame = $("game"), PLAY = [240, 526], VIEW = { w: 480, h: 853 };
let running = false, loopId = 0, pixels = [], rng = null, games = [], cur = null, allTurns = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* On a touch screen (a phone or a tablet) the bot starts out using one processor and not drawing its search over the game: the page stays smooth and the device cool. Both can be changed with the controls. */
if (window.matchMedia && matchMedia("(pointer: coarse)").matches) { $("power").value = "1"; if ($("showmind")) $("showmind").checked = false; }

/* ---------- speed ---------- */
const gameClock = () => { try { return frame.contentWindow.NNClock || null; } catch (e) { return null; } };
let speedLimit = null, limitWhy = "";                                                   // a temporary ceiling (for example while a machine is hot); the chosen speed is left alone
const speedNow = () => NNSpeed.effective($("speed").value, speedLimit), speedName = (v) => (v === "max" ? "fastest" : v === 1 || v === "1" ? "normal" : `${v}×`);
window.setSpeedLimit = (limit, why) => { speedLimit = limit; limitWhy = why || ""; applySpeed(); showSpeed(); };
function applySpeed() { const c = gameClock(); if (c) c.speed = speedNow(); }
function showSpeed() { const c = gameClock(), want = $("speed").value, now = speedNow(), limited = String(now) !== String(want === "max" ? "max" : +want);
  $("pace").textContent = `chosen: ${speedName(want)} · now: ${speedName(now)}${limited && limitWhy ? ` (limited: ${limitWhy})` : ""}${c && now !== 1 && c.achieved > 1.05 ? ` · shots last reached ${c.achieved.toFixed(1)}×` : ""}`; }
const turbo = (on) => { const c = gameClock(); if (c) c.turbo = on; };                  // fast only while a shot flies
$("speed").addEventListener("change", applySpeed);
/* The game is painted only while some of it is on screen. Scrolled away (to the controls, say) it plays exactly the same frames and just stops drawing them. */
let offscreen = false; const applyVisibility = () => { const c = gameClock(); if (c) c.offscreen = offscreen; };
if (window.IntersectionObserver && $("screen")) new IntersectionObserver((entries) => { offscreen = !entries[entries.length - 1].isIntersecting; applyVisibility(); }, { rootMargin: "120px" }).observe($("screen"));
setInterval(() => { applySpeed(); applyVisibility(); showSpeed(); }, 1000);

/* ---------- the best bot (runs in a background worker so the game stays smooth) ---------- */
let spare = 1, bot = null, botReady = false, botWaiting = new Map(), botSeq = 0, baseBudget = null, msPerSim = null;
const TARGET_MS = 6000, MIN_BUDGET = 14;                              // keep a turn's base search near this long; never shrink below the minimum seed count needs
function nextBudget() { if (!baseBudget || !msPerSim) return undefined; return Math.max(MIN_BUDGET, Math.min(baseBudget, Math.round(TARGET_MS / msPerSim))); }
function startBestBot() {
  try { bot = new Worker("best/worker.js"); } catch (e) { engineNote("This browser could not start the best bot."); return; }
  bot.onmessage = (e) => { const m = e.data;
    if (m.type === "ready") { botReady = true; spare = m.spare || 1; baseBudget = m.baseBudget || null; engineNote(`Best bot ready (it runs on this device, with up to ${spare} processor${spare > 1 ? "s" : ""}).`); }
    else if (m.type === "progress") { const w = botWaiting.get(m.id); if (w) { w.heard = Date.now(); if (window.NNThought) NNThought.progress(m.n, m.of, m.info); if (window.NNSystem && m.info && m.n) NNSystem.sim(); if (m.n) say(m.of > 100 ? `danger: searching every aim for a way to survive, ${m.n}/${m.of}` : `thinking ${m.n}/${m.of}`); } }
    else if (m.type === "choice") { const f = botWaiting.get(m.id); botWaiting.delete(m.id);
      if (m.result.sims) { const sample = m.result.think_ms / m.result.sims; msPerSim = msPerSim === null ? sample : msPerSim * 0.7 + sample * 0.3; }      // the budget asked for next time scales down as simulations get slower (more balls), and back up as they get cheaper again
      if (f) { if (window.NNThought) NNThought.choose(m.result); f.ok(m.result); } }
    else if (m.type === "error") { if (m.id === undefined) engineNote("The best bot is not available here: " + m.message); else { const f = botWaiting.get(m.id); botWaiting.delete(m.id); if (f) f.fail(new Error(m.message)); } } };
  bot.onerror = () => engineNote("The best bot is not available on this copy of the site (engine files missing).");
}
function engineNote(s) { $("engine").textContent = s; }
function bestChoice(board) { if (window.NNThought) NNThought.start(board); return new Promise((ok, fail) => { const id = ++botSeq; const w = { ok, fail, heard: Date.now() }; botWaiting.set(id, w); bot.postMessage({ cmd: "choose", id, board, cores: $("power").value === "1" ? 1 : spare, budget: nextBudget() }); const watch = setInterval(() => { if (!botWaiting.has(id)) clearInterval(watch); else if (Date.now() - w.heard > 120000) { clearInterval(watch); botWaiting.delete(id); fail(new Error("timed out")); } }, 5000); }); }      // gives up only after 2 minutes with no progress: an emergency search may be long
const boardFor = (snap, turn) => ({ blocks: snap.blocks.map((b) => [b.uid, b.x, b.y, b.hp]).sort((a, b) => a[0] - b[0]), pickups: snap.pickups.map((p) => [p.x, p.y]), balls: snap.vars.TotalBall, turn });
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- reading the game ---------- */
const win = () => frame.contentWindow;
function runtime() { try { return win().cr_getC2Runtime(); } catch (e) { return null; } }
function layoutName() { try { const r = runtime(); return r && r.running_layout ? r.running_layout.name : null; } catch (e) { return null; } }
function snapshot() {                                                                    // the same fields the earlier bot read
  const r = runtime(); if (!r || !r.running_layout) return null; const t = r.types_by_index, sheet = r.running_layout.event_sheet, vars = {};
  if (sheet && sheet.events) for (const e of sheet.events) if (e.name !== undefined) vars[e.name] = e.data;
  const globals = {}; (r.all_global_vars || []).forEach((v) => { globals[v.name] = v.data; });
  return { layout: r.running_layout.name, score: globals.score, n9: t[9].instances.length, waits: r.system && Array.isArray(r.system.waits) ? r.system.waits.length : null, vars,
    blocks: t[11].instances.map((b) => ({ uid: b.uid, x: b.x, y: b.y, hp: b.instance_vars[0] })), pickups: t[22].instances.map((p) => ({ uid: p.uid, x: p.x, y: p.y })) };
}
const settled = (s) => !!s && s.layout === "Game" && s.n9 === 0 && (s.waits === 0 || s.waits === null) && s.vars.Tap === 0 && s.vars.FirstHit === 0 && s.vars.Random1 === 0 && s.vars.power2 === 0;
const hpTotal = (s) => s.blocks.reduce((a, b) => a + b.hp, 0);

/* ---------- sending input ---------- */
function fire(kind, x, y) {                                                              // kind: move | down | up
  const w = win(), d = w.document, el = d.getElementById("c2canvas") || d.body, down = kind === "down";
  const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, view: w };
  const names = { move: ["pointermove", "mousemove"], down: ["pointerdown", "mousedown"], up: ["pointerup", "mouseup"] }[kind];
  el.dispatchEvent(new w.PointerEvent(names[0], Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true, button: kind === "move" ? -1 : 0, buttons: down ? 1 : 0 }, base)));
  el.dispatchEvent(new w.MouseEvent(names[1], Object.assign({ button: 0, buttons: down ? 1 : 0 }, base)));
}
async function tapAt(x, y, holdMs) { fire("move", x, y); await sleep(80); fire("down", x, y); await sleep(holdMs || 80); fire("up", x, y); }

/* ---------- the play loop ---------- */
function say(s) { $("state").textContent = s; }
async function loop(id) {
  say("starting"); let inGame = false, t = 0;
  while (running && id === loopId) {
    await sleep(100); if (document.hidden) continue; const layout = layoutName();     // the game suspends itself while the page is hidden
    if (layout !== "Game") {
      if (inGame) { endGame(layout); inGame = false; }
      if (layout) { await tapAt(PLAY[0], PLAY[1], 40); await sleep(300); } continue;     // press Play until the game screen appears
    }
    const snap = snapshot(); if (!settled(snap)) continue;
    if (!inGame) { inGame = true; cur = { n: games.length + 1, turns: [], t0: Date.now(), strategy: $("strategy").value }; t = 0; }     // the strategy is locked for the whole game
    const strategy = cur.strategy; if (strategy === "best" && !botReady) { say("loading the best bot"); continue; }
    t++; if (window.NNHud) NNHud.turn(boardFor(snap, t), snap.score, t); say(`game ${cur.n}, turn ${t}${snap.score === undefined ? "" : `, score ${snap.score}`}`); let pick;
    if (strategy === "best") {
      try { const r = await bestChoice(boardFor(snap, t)); pick = { arm: r.rescued ? "best+rescue" : r.collects && !r.losing ? "best+ball" : r.guard_changed ? "best+guard" : "best", target: null, cores: r.cores, urgent: r.urgent, pickups: r.pickups, collects: r.collects, rescued: r.rescued, searched_all: r.searched_all, index: r.index, pixel: r.pixel, predicted: r.predicted, think_s: +(r.think_ms / 1000).toFixed(1), sims: r.sims, predicted_losing: r.losing }; }
      catch (e) { engineNote("The best bot failed on this turn: " + e.message + ". Using a simple aim."); pick = NNExactBot.pickAim("mix", snap.blocks, rng); }
      if (!running || id !== loopId) break; if (layoutName() !== "Game") { t--; continue; } say(`game ${cur.n}, turn ${t}`);
    } else pick = NNExactBot.pickAim(strategy, snap.blocks, rng);
    const rec = { cores: pick.cores, turn: t, arm: pick.arm, pickups: pick.pickups, collects: pick.collects, rescued: pick.rescued, searched_all: pick.searched_all, target: pick.target, index: pick.index, pixel: pick.pixel, predicted: pick.predicted, think_s: pick.think_s, sims: pick.sims, balls: snap.vars.TotalBall, blocks: snap.blocks.length, hp_before: hpTotal(snap), score: snap.score, board: boardFor(snap, t) }, t0 = performance.now();
    const ballsBefore = gameClock() ? gameClock().ballFrames : 0;
    await tapAt(pick.pixel[0], pick.pixel[1], 80); applySpeed(); const used = speedNow(); turbo(true);
    let seen = false, res = null, tr = performance.now();
    while (running && id === loopId) {
      await sleep(150); const l = layoutName(); if (l !== "Game") { res = "left"; break; }
      const s = snapshot(); if (!s) continue; if (s.n9 > 0) { seen = true; continue; }
      if (gameClock() && gameClock().ballFrames > ballsBefore) seen = true;
      if (seen && settled(s)) { res = s; break; } else if (!seen && performance.now() - tr > 8000) { res = "no_launch"; break; } if (performance.now() - tr > 120000 + 500 * snap.vars.TotalBall) { res = "stuck"; break; }
    }
    turbo(false);
    if (res === "no_launch") { t--; continue; }
    rec.speed_used = used; const c = gameClock(); if (c && used !== 1 && c.achieved) rec.speed_reached = +c.achieved.toFixed(1);
    if (res === "left" || res === "stuck" || !res) { rec.outcome = res || "paused"; cur.turns.push(rec); record(rec); continue; }
    const before = new Map(snap.blocks.map((b) => [b.uid, b.hp])); let dmg = 0; for (const [uid, hp0] of before) { const a = res.blocks.find((b) => b.uid === uid); dmg += hp0 - (a ? a.hp : 0); }
    Object.assign(rec, { damage: dmg, balls_after: res.vars.TotalBall, secs: +((performance.now() - t0) / 1000).toFixed(1) }); cur.turns.push(rec); record(rec);
  }
  say(running ? "stopped" : "paused");
}
function record(rec) { allTurns.push(Object.assign({ game: cur.n }, rec)); save(); render(); }

/* ---------- keeping the log: it survives a refresh, on this device only ---------- */
const LOG_KEY = "nn-bot-log";
let keepHint = Infinity;                                                                     // how many recent boards fitted last time: start there, so a full store costs one attempt a turn, not several big ones
function save() {
  for (let keepBoards = Math.min(allTurns.length, keepHint); ; keepBoards = Math.floor(keepBoards * 0.75)) {       // if the browser's space runs out, older turns give up their board first
    const turns = allTurns.map((t, i) => (i < allTurns.length - keepBoards ? Object.assign({}, t, { board: undefined }) : t));
    try { localStorage.setItem(LOG_KEY, JSON.stringify({ v: 2, games, turns })); keepHint = keepBoards >= allTurns.length ? Infinity : keepBoards; return; } catch (e) { if (!keepBoards) return; }
  }
}
function restore() {
  try { const d = JSON.parse(localStorage.getItem(LOG_KEY) || "null"); if (!d || !Array.isArray(d.turns) || !Array.isArray(d.games)) return; games = d.games; allTurns = d.turns; } catch (e) { return; }
  const last = allTurns.length ? allTurns[allTurns.length - 1].game : 0; if (last > games.length) games.push({ game: last, turns: allTurns.filter((t) => t.game === last).length, interrupted: true });      // the page closed mid-game
  if (allTurns.length) render();
}
function endGame(layout) { if (!cur) return; setTimeout(save, 0); const last = snapshot(); games.push({ score: last ? last.score : undefined, game: cur.n, turns: cur.turns.length, damage: cur.turns.reduce((a, r) => a + (r.damage || 0), 0), strategy: cur.strategy, secs: Math.round((Date.now() - cur.t0) / 1000), ended_on: layout }); if (window.NNHud) NNHud.end(games[games.length - 1]); cur = null; render(); }

/* ---------- screen and telemetry ---------- */
function render() {
  const g = games.filter((x) => !x.interrupted), n = g.length, mean = n ? g.reduce((a, x) => a + x.turns, 0) / n : 0, best = n ? Math.max(...g.map((x) => x.turns)) : 0;
  const pred = allTurns.filter((r) => r.predicted !== undefined && r.damage !== undefined), exact = pred.filter((r) => r.predicted === r.damage).length;
  const acc = pred.length ? ` · simulator exactly right on ${exact} of ${pred.length} predicted shots (${Math.round(100 * exact / pred.length)}%)` : "";
  $("summary").textContent = (n ? `games finished: ${n} · average turns survived: ${mean.toFixed(1)} · best: ${best} · turns logged: ${allTurns.length}` : `current game in progress · turns logged: ${allTurns.length}`) + acc;
  const bars = $("bars"); bars.replaceChildren(); const mx = Math.max(1, ...g.map((x) => x.turns));
  g.slice(-12).forEach((x) => { const row = document.createElement("div"); row.style.cssText = "display:flex;gap:.5rem;align-items:center;margin:.15rem 0;font-size:.85rem"; const lab = document.createElement("span"); lab.textContent = `game ${x.game}`; lab.style.width = "4.5rem"; const bar = document.createElement("div"); bar.className = "bar"; bar.style.width = (x.turns / mx * 60) + "%"; const v = document.createElement("span"); v.textContent = `${x.turns} turns`; row.append(lab, bar, v); bars.append(row); });
  const tb = document.querySelector("#turns tbody"); tb.replaceChildren(); allTurns.slice(-8).reverse().forEach((r) => { const tr = document.createElement("tr"); [r.turn, r.arm, r.balls, r.blocks, r.predicted === undefined ? "–" : r.predicted, r.damage === undefined ? "–" : r.damage, r.think_s === undefined ? "–" : r.think_s].forEach((v) => { const td = document.createElement("td"); td.textContent = v; tr.append(td); }); tb.append(tr); });
  $("dl").disabled = allTurns.length === 0; $("clear").disabled = allTurns.length === 0; if (window.NNAnalysis) NNAnalysis.update(allTurns);
}
function fit() { const scr = $("screen"), s = scr.clientWidth / VIEW.w; frame.style.transform = `scale(${s})`; scr.style.height = Math.round(VIEW.h * s) + "px"; }
window.addEventListener("resize", fit); fit();
$("start").onclick = () => { if (running) return; running = true; loopId++; rng = mulberry32((Date.now() ^ 0x5bd1e995) >>> 0); $("start").disabled = true; $("stop").disabled = false; loop(loopId); };
$("stop").onclick = () => { if (window.NNThought) NNThought.clear(); running = false; $("start").disabled = false; $("stop").disabled = true; say("paused"); $("start").textContent = "Resume the bot"; };
$("dl").onclick = () => { const data = { v: 1, note: "bot log from the in-page player", games, turns: allTurns }, a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" })); a.download = "bot-log.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
$("clear").onclick = () => { if (running || !window.confirm("Erase the saved log of games and turns on this device?")) return; games = []; allTurns = []; try { localStorage.removeItem(LOG_KEY); } catch (e) {} render(); };
restore();
startBestBot();
fetch("pixels781.json").then((r) => r.json()).then((d) => { pixels = d.pixels; NNExactBot.setPixels(pixels); }).catch(() => { $("now").textContent = "Could not load the aim list."; });
fetch("game/index.html", { method: "HEAD" }).then((r) => { if (!r.ok) throw 0; }).catch(() => { $("missing").style.display = "block"; $("stage").style.display = "none"; });
setInterval(() => { if (!running) return; const l = layoutName(), s = l === "Game" ? snapshot() : null; if (s) $("now").textContent = `turn ${cur ? cur.turns.length + 1 : "-"} · balls ${s.vars.TotalBall} · blocks ${s.blocks.length} · hp on board ${hpTotal(s)}`; else if (l) $("now").textContent = `screen: ${l}`; }, 500);
