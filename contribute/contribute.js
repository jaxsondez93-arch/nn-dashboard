/* "Lend your processor" page. Layout: helpers -> state -> worker control -> safety pauses -> results list -> community heat map.
   The page cannot talk to the network (see its Content-Security-Policy), only to this site's own files. Sharing is a link the user clicks. */
"use strict";
const $ = (id) => document.getElementById(id), C = NNCore, REPO = "jaxsondez93-arch/nn-dashboard", MINE_KEY = "nn-mine";
let worker = null, state = "idle" /* idle | running | paused | capped */, runMs = 0, lastTick = 0, finishedBoards = 0, current = null, mine = [];
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function el(tag, attrs, ...kids) { const e = document.createElement(tag); for (const k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); } kids.forEach((x) => e.append(x)); return e; }
function say(msg) { $("status").textContent = msg; }
function pickUnit() { const a = new Uint32Array(2); crypto.getRandomValues(a); return { cell: a[0] % (C.KS.length * C.QS.length), block: a[1] % C.BLOCKS }; }   // random pick; duplicates between volunteers are welcome (they confirm each other)

/* ---------- worker control ---------- */
function setButtons() {
  const consent = $("consent").checked;
  $("start").disabled = !consent || state === "running"; $("start").textContent = state === "paused" || state === "capped" ? "Resume" : "Start";
  $("pause").disabled = state !== "running"; $("stop").disabled = state === "idle";
}
function ensureWorker() { if (worker) return; worker = new Worker("worker.js"); worker.onmessage = onWorker; worker.onerror = () => { say("The background worker failed to start in this browser."); state = "idle"; setButtons(); }; }
function nextUnit() {
  if (state !== "running") return;
  if (runMs >= +$("cap").value * 60000) { state = "capped"; say("Session limit reached: thank you! Press Resume to continue for another session."); runMs = 0; setButtons(); return; }
  const p = pickUnit(); current = C.unitFor(p.cell, p.block); worker.postMessage({ cmd: "start", cell: current.cell, block: current.block, duty: +$("duty").value });
  say(`Working on unit ${current.cell}-${current.block}: ${current.K} tests per board, hunch quality ${current.q}.`);
}
function onWorker(e) {
  const m = e.data;
  if (m.type === "progress") { $("bar").value = m.done; updateStats(m.done); }
  else if (m.type === "done") { finishedBoards += m.result.boards; addMine(m.result); $("bar").value = 0; updateStats(0); nextUnit(); }
  else if (m.type === "stopped") { $("bar").value = 0; }
}
function updateStats(partial) { const s = (runMs / 1000) || 1; $("stats").textContent = `boards simulated this visit: ${finishedBoards + partial} · units finished: ${mine.length} · running time: ${Math.round(runMs / 1000)} s`; }
function start() { if (!$("consent").checked) return; ensureWorker(); state = "running"; lastTick = performance.now(); setButtons(); nextUnit(); }
function halt(newState, why) { if (worker && state === "running") worker.postMessage({ cmd: "stop" }); state = newState; if (why) say(why); setButtons(); }
setInterval(() => { const now = performance.now(); if (state === "running") { runMs += now - lastTick; updateStats(+$("bar").value); } lastTick = now; }, 500);
$("consent").addEventListener("change", () => { setButtons(); if (!$("consent").checked && state === "running") halt("paused", "Paused: consent unticked."); else if ($("consent").checked && state === "idle") say("Ready. Press Start."); });
$("start").onclick = start; $("pause").onclick = () => halt("paused", "Paused. Press Resume to continue."); $("stop").onclick = () => halt("idle", "Stopped. Nothing is running.");

/* ---------- safety pauses ---------- */
document.addEventListener("visibilitychange", () => { if (document.hidden && state === "running") halt("paused", "Paused because this tab was hidden. Press Resume when you are back."); });
if (navigator.getBattery) navigator.getBattery().then((b) => { const check = () => { if (state === "running" && !b.charging && b.level < 0.3) halt("paused", "Paused: battery is below 30% and not charging."); }; b.addEventListener("levelchange", check); b.addEventListener("chargingchange", check); });
else $("status").textContent = "Tick the box to begin. (This browser does not report battery level: plug in for long sessions.)";

/* ---------- results list ---------- */
function persist() { try { localStorage.setItem(MINE_KEY, JSON.stringify(mine.slice(-50))); } catch (e) {} }
function addMine(r) { mine.push(r); persist(); renderMine(); }
function issueUrl(r) { const body = "```json\n" + JSON.stringify(r) + "\n```\nA work-unit result from the 'Lend your processor' page. It contains no personal data; verify with `node tools/verify_unit.js`."; return `https://github.com/${REPO}/issues/new?labels=work-unit&title=${encodeURIComponent(`Work unit result ${r.cell}-${r.block}`)}&body=${encodeURIComponent(body)}`; }
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { const ta = el("textarea"); ta.value = t; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {} ta.remove(); return ok; } }
function renderMine() {
  const list = $("list"); list.replaceChildren(); $("mine-note").textContent = mine.length ? "Nothing here has been sent anywhere. Share only if you want to." : "None yet. Each finished unit shows its result here; nothing is shared until you choose.";
  mine.slice().reverse().forEach((r, i) => {
    const u = C.unitFor(r.cell, r.block), note = el("span", { class: "note" });
    const card = el("div", { class: "card", style: "margin:.6rem 0" }, el("h3", { text: `Unit ${r.cell}-${r.block} · ${u.K} tests · hunch ${u.q}` }),
      el("p", { text: `Total regret over ${r.boards} boards (lower is better): random ${r.sums.random} · evenly spaced ${r.sums.even} · zoom-in ${r.sums.c2f} · hunch ${r.sums.hunch}. Checksum ${r.check}.` }));
    const verify = el("button", { class: "small", text: "Verify here" }); verify.onclick = () => { const v = C.verify(r); note.textContent = v.ok ? " verified: recomputed on this device and it matches" : " MISMATCH: " + v.reason; };
    const copy = el("button", { class: "small", text: "Copy JSON" }); copy.onclick = async () => { note.textContent = (await copyText(JSON.stringify(r))) ? " copied" : " could not copy"; };
    const share = el("a", { class: "btn", href: issueUrl(r), target: "_blank", rel: "noopener noreferrer", text: "Share on GitHub (opens a public page)" });
    const drop = el("button", { class: "small", text: "Discard" }); drop.onclick = () => { mine.splice(mine.length - 1 - i, 1); persist(); renderMine(); };
    card.append(el("div", { class: "controls" }, verify, copy, share, drop, note)); list.append(card);
  });
}
try { mine = (JSON.parse(localStorage.getItem(MINE_KEY) || "[]") || []).filter(C.validShape); } catch (e) { mine = []; }
renderMine(); setButtons();

/* ---------- community heat map ---------- */
fetch("phase_diagram.json", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((d) => {
  if (!d) { $("community-note").textContent = "No community results published yet."; return; }
  const done = d.total_units || 0, all = C.KS.length * C.QS.length * C.BLOCKS;
  $("community-note").textContent = `${done} of ${all} work units verified so far (${d.total_confirmations || 0} independent confirmations). Colour = the hunch strategy's average regret; darker is worse. Grey = nothing yet.`;
  drawHeat(d);
}).catch(() => { $("community-note").textContent = "No community results published yet."; });
function drawHeat(d) {
  const cv = $("heat"), g = cv.getContext("2d"), L = 74, T = 34, W = cv.width, H = cv.height, cw = (W - L - 8) / C.QS.length, ch = (H - T - 28) / C.KS.length; g.clearRect(0, 0, W, H); g.font = "13px system-ui, sans-serif"; g.textAlign = "center";
  const mx = Math.max(1, ...d.cells.filter((c) => c.units > 0).map((c) => c.mean.hunch));
  g.fillStyle = css("--muted"); C.QS.forEach((q, j) => g.fillText(String(q), L + (j + 0.5) * cw, T - 8)); g.fillText("hunch quality →", L + (W - L) / 2, 14);
  g.textAlign = "right"; C.KS.forEach((k, i) => g.fillText(k + " tests", L - 8, T + (i + 0.5) * ch + 4));
  d.cells.forEach((c) => { const i = Math.floor(c.cell / C.QS.length), j = c.cell % C.QS.length, x = L + j * cw, y = T + i * ch;
    g.fillStyle = c.units ? `rgba(192,57,43,${0.12 + 0.75 * (c.mean.hunch / mx)})` : css("--line"); g.fillRect(x + 1, y + 1, cw - 2, ch - 2);
    g.fillStyle = css("--ink"); g.textAlign = "center"; g.fillText(c.units ? c.mean.hunch.toFixed(2) : "–", x + cw / 2, y + ch / 2 + 4); });
}
