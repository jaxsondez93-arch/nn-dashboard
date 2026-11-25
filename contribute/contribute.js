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
  if (+$("cap").value > 0 && runMs >= +$("cap").value * 60000) { state = "capped"; say("Session limit reached: thank you! Press Resume to continue for another session."); runMs = 0; setButtons(); return; }
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

/* ---------- results: collect everything, submit with one press ---------- */
const MAX_KEEP = 20000, MAX_PER_ISSUE = 2500, URL_LIMIT = 7500;
function persist() { try { localStorage.setItem(MINE_KEY, JSON.stringify(mine.slice(-MAX_KEEP).map((r) => [r.cell, r.block, r.sums.random, r.sums.even, r.sums.c2f, r.sums.hunch, r.sent ? 1 : 0]))); } catch (e) {} }
function restore() { try { const rows = JSON.parse(localStorage.getItem(MINE_KEY) || "[]"); return rows.map((x) => { if (!Array.isArray(x)) return null; const r = C.expandBundle({ v: 2, units: [x.slice(0, 6)] })[0]; if (r) r.sent = !!x[6]; return r; }).filter((r) => r && C.validShape(r)); } catch (e) { return []; } }
function addMine(r) { mine.push(r); persist(); renderMine(); }
const unsent = () => mine.filter((r) => !r.sent);
function renderMine() {
  const u = unsent().length, n = mine.length;
  $("mine-note").textContent = n ? `${n} units finished on this device (${(n * C.COUNT).toLocaleString()} boards) · ${u} not yet submitted.` : "None yet. Finished work collects here; nothing is sent until you press the button.";
  $("submit").disabled = !u; $("submit").textContent = u ? `Submit all ${Math.min(u, MAX_PER_ISSUE)} (one press)` : "Submit all"; $("download").disabled = $("check").disabled = !n; $("clear").disabled = !(n - u);
}
const issueLink = (title, body) => `https://github.com/${REPO}/issues/new?labels=work-unit&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
function copyNow(t) { const ta = el("textarea"); ta.value = t; ta.style.cssText = "position:fixed;opacity:0"; document.body.append(ta); ta.select(); ta.setSelectionRange(0, t.length); let ok = false; try { ok = document.execCommand("copy"); } catch (e) {} ta.remove(); return ok; }   // synchronous: stays inside the tap, which phone browsers require
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch (e) { const ta = el("textarea"); ta.value = t; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e2) {} ta.remove(); return ok; } }
$("submit").onclick = async () => {
  const batch = unsent().slice(0, MAX_PER_ISSUE); if (!batch.length) return;
  const json = JSON.stringify(C.makeBundle(batch)), title = `Work unit result bundle (${batch.length} units)`, body = "```json\n" + json + "\n```\nResults from the 'Lend your processor' page. No personal data; verify with tools/aggregate_results.js.";
  let url = issueLink(title, body), msg = `Opened GitHub with ${batch.length} results: press "Submit new issue" there.`;
  if (url.length > URL_LIMIT) { const ok = copyNow(body) || (await copyText(body)); if (!ok) { $("submit-note").textContent = "Could not copy automatically. Use Download and attach the file to a new issue."; return; }
    url = issueLink(title, "Delete this line, then PASTE here (the results are on your clipboard)."); msg = `${batch.length} results copied. In the page that opened, paste into the big box and press "Submit new issue".`; }
  window.open(url, "_blank", "noopener,noreferrer"); batch.forEach((r) => { r.sent = true; }); persist(); renderMine();
  $("submit-note").replaceChildren(msg + " ", el("a", { href: url, target: "_blank", rel: "noopener noreferrer", text: "Nothing opened? Tap here." }), " ", Object.assign(el("button", { class: "small", text: "It did not go through: mark as not sent" }), { onclick: () => { batch.forEach((r) => { r.sent = false; }); persist(); renderMine(); $("submit-note").textContent = "Marked as not sent."; } }));
};
$("download").onclick = () => { const a = el("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(C.makeBundle(mine))], { type: "application/json" })); a.download = "my-results.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
$("check").onclick = () => { const pick = mine.slice().sort(() => Math.random() - 0.5).slice(0, 3), ok = pick.filter((r) => C.verify(r).ok).length; $("submit-note").textContent = `Recomputed ${pick.length} of your results on this device: ${ok} match exactly.`; };
$("clear").onclick = () => { mine = unsent(); persist(); renderMine(); $("submit-note").textContent = "Submitted results forgotten on this device."; };
mine = restore(); renderMine(); setButtons();
/* start by itself, if the visitor asked for that earlier (consent is part of that choice); it still pauses when the tab is hidden or the battery is low */
try { if (localStorage.getItem("nn-auto") === "1") { $("auto").checked = true; $("consent").checked = true; $("cap").value = "0"; setTimeout(() => { if (!document.hidden) start(); }, 600); } } catch (e) {}
$("auto").addEventListener("change", () => { try { localStorage.setItem("nn-auto", $("auto").checked ? "1" : "0"); } catch (e) {} if ($("auto").checked) { $("consent").checked = true; $("cap").value = "0"; setButtons(); start(); } });

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
