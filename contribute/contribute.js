/* One consent box. Ticked: background workers compute units (as many and as busy as the power slider and the safety switches allow) and finished results are sent automatically. Unticked: everything stops.
   Nothing runs without consent, and nothing runs if no collector is configured (so no device is used for work that cannot be received). Add ?preview=1 to try it without sending. */
"use strict";
const $ = (id) => document.getElementById(id), PREVIEW = /[?&]preview=1/.test(location.search), CAP_MS = 30 * 60000, QUEUE_KEY = "nn-queue", OK_KEY = "nn-consent";
let endpoint = "", pool = [], units = 0, planKey = "", easedAt = 0, ease = 1, baseMs = [], recentMs = [], running = false, busy = false, shots = 0, sentShots = 0, queue = [], runMs = 0, last = 0, lowBattery = false;
try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); shots = +localStorage.getItem("nn-shots") || 0; } catch (e) {}
const PHONE = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent), CORES = navigator.hardwareConcurrency || 2, POWER_KEY = "nn-power";
const guard = (id) => $(id).checked;                                                    // safety switches: always ON when the page opens
const currentPlan = () => NNPower.plan(+$("power").value, CORES, { heat: guard("g-heat"), stability: guard("g-stable"), phone: PHONE, ease });
const save = () => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); localStorage.setItem("nn-shots", String(shots)); } catch (e) {} };
function status(msg) { $("status").textContent = msg; $("state").className = busy ? "on" : ""; }
function show() { $("sent").textContent = PREVIEW ? "Preview mode: nothing is sent." : (Date.now() < blockedUntil ? "The relay asked us to slow down. Trying again in a few minutes; your results are saved." : sentShots ? `${sentShots.toLocaleString()} sent this visit` : ""); NNMonitor.state({ running: busy && running && units > 0, waiting: queue.length, total: shots, capLeft: guard("g-time") ? CAP_MS - runMs : null, capAll: CAP_MS }); }
function pickUnit() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % units; }      // random task; two devices doing the same one is a useful cross-check

let sending = false, lastSend = 0, lastTry = 0, blockedUntil = 0, holding = false;
const COMPRESS = typeof CompressionStream === "function";
async function send() {                                                                 // automatic: one packed message at a time, and again later if the network is down or the relay says "slow down"
  const now = Date.now(); if (PREVIEW || !endpoint || !queue.length || sending || now < blockedUntil || now - lastTry < 5000) return; sending = true; lastTry = now;
  try { const relay = endpoint.startsWith("https://ntfy.sh/"), { count, body } = await NNOutbox.pack(queue, relay && COMPRESS);
    const r = await fetch(endpoint, relay ? { method: "POST", keepalive: true, body } : { method: "POST", mode: "no-cors", keepalive: true, body });
    if (r.ok || r.type === "opaque") { const n = queue.splice(0, count).reduce((a, x) => a + x.d.length, 0); sentShots += n; lastSend = Date.now(); save(); NNMonitor.sent(n); show(); }
    else if (r.status === 429) blockedUntil = Date.now() + NNOutbox.BACKOFF; } catch (e) { /* offline: kept and retried */ }
  sending = false;
}
const due = () => NNOutbox.due({ queued: queue.length, now: Date.now(), lastTry, lastSend, blockedUntil });   // the first goes at once, then full messages (the relay limits messages per day)
/* ---------- the workers ---------- */
function give(w) { if (!running) return; if (guard("g-time") && runMs >= CAP_MS) { halt("Done for this visit (30 minutes). Thank you!"); return; }
  holding = NNOutbox.hold(holding, queue.length); if (holding) { busy = false; status("Paused so the sending can catch up. Keep this page open."); return; }      // a full backlog: wait instead of piling up more
  w.job = true; w.postMessage({ cmd: "unit", unit: pickUnit(), duty: currentPlan().duty }); busy = true; status("Working. Thank you!"); }
function addWorker() {
  const w = new Worker("worker.js"); w.job = false; w.ready = false; pool.push(w); w.onerror = () => failed(w);
  w.onmessage = (e) => { const m = e.data;
    if (m.type === "ready") { units = m.units; w.ready = true; give(w); }
    else if (m.type === "shot") { shots++; NNMonitor.shot(m.ms); if (baseMs.length < 300) baseMs.push(m.ms); else { recentMs.push(m.ms); if (recentMs.length > 300) recentMs.shift(); } show(); }
    else if (m.type === "unit") { w.job = false; if (!PREVIEW) queue.push(m.result); save(); if (due()) send(); give(w); }
    else if (m.type === "error") failed(w); };
}
function failed(w) { w.terminate(); pool = pool.filter((x) => x !== w); if (!pool.length) halt("The simulator could not start on this device."); else $("power-note").textContent = "This device could not run that many workers; using fewer."; }
function stopWorkers() { pool.forEach((w) => w.terminate()); pool = []; }
function apply(changed) {                                                                // match the workers to the slider and the switches, live
  const p = currentPlan(); $("power-value").textContent = `${p.asked}%`;
  $("power-effect").textContent = `Using about ${p.percent < 10 ? p.percent.toFixed(1) : Math.round(p.percent)}% of ${p.cores} core${p.cores > 1 ? "s" : ""}: ${p.workers} worker${p.workers > 1 ? "s" : ""}, each busy ${Math.round(p.duty * 100)}% of the time.` + (p.why.length ? ` (${p.why.join("; ")})` : "");
  const off = ["g-heat", "g-stable", "g-battery", "g-time"].filter((id) => !guard(id)); $("risk").hidden = !off.length;
  if (changed) NNMonitor.mark();
  const key = p.workers + ":" + p.duty.toFixed(3); if (key !== planKey) { planKey = key; baseMs = []; recentMs = []; }      // shot times are only comparable at the same setting
  if (!running) return;
  while (pool.length > p.workers) pool.pop().terminate();
  while (pool.length < p.workers) addWorker();
  pool.forEach((w) => w.postMessage({ cmd: "duty", duty: p.duty }));
}
function start() {
  if (running || !$("consent").checked) return;
  if (!endpoint && !PREVIEW) { status("Collection is not switched on yet, so your device is not being used. Please check back later."); return; }
  if (document.hidden) { status("Paused while the page is hidden."); return; }
  if (lowBattery && guard("g-battery")) { status("Paused: battery is low and not charging."); return; }
  running = true; busy = true; last = performance.now(); status("Loading the simulator..."); apply(true);
}
function halt(msg) { running = false; busy = false; holding = false; stopWorkers(); status(msg); show(); send(); }

/* ---------- the slider and the safety switches ---------- */
const WARN = { "g-heat": "Turn off heat protection? The device may become very hot, slow down, drain its battery quickly or shut itself off.", "g-stable": "Turn off stability protection? Using every core can make the device freeze, become unresponsive, or close this page or other apps.",
  "g-battery": "Turn off battery protection? The work will continue on a low battery until the device dies.", "g-time": "Remove the time limit? The work will continue for as long as this page stays open." };
Object.keys(WARN).forEach((id) => { $(id).checked = true; $(id).addEventListener("change", () => { if (!$(id).checked && !window.confirm(WARN[id] + "\n\nYou accept this risk.")) $(id).checked = true; if (id === "g-heat") ease = 1; apply(true); if (running === false && $("consent").checked) start(); }); });
try { const v = +localStorage.getItem(POWER_KEY); if (v >= 1 && v <= 100) $("power").value = v; } catch (e) {}
$("power").addEventListener("input", () => { ease = 1; try { localStorage.setItem(POWER_KEY, $("power").value); } catch (e) {} apply(true); });
setInterval(() => { if (!running || !guard("g-heat") || recentMs.length < 100) return; const next2 = NNPower.easing(baseMs, recentMs, ease), now = Date.now();
  if (next2 === ease || (next2 > ease && now - easedAt < 300000)) return; if (next2 < ease) easedAt = now; ease = next2; recentMs = []; apply(true); }, 30000);      // ease off at once, come back only after 5 calm minutes
apply(false);
setInterval(() => { const t = performance.now(); if (running) runMs += t - last; last = t; if (running && guard("g-time") && runMs >= CAP_MS) halt("Done for this visit (30 minutes). Thank you!"); if (running && holding) pool.filter((w) => w.ready && !w.job).forEach(give); show(); }, 1000); setInterval(() => { if (due()) send(); }, 5000);
$("consent").addEventListener("change", () => { const on = $("consent").checked; try { localStorage.setItem(OK_KEY, on ? "1" : "0"); } catch (e) {} if (on) start(); else halt(queue.length && !PREVIEW ? "Stopped computing. Finished results are still sent while this page is open." : "Stopped. Nothing is running."); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { if (running) halt("Paused while the page is hidden."); } else start(); });
window.addEventListener("online", send);
if (navigator.getBattery) navigator.getBattery().then((b) => { const note = () => NNMonitor.battery(b.level, b.charging); note(); b.addEventListener("levelchange", note); b.addEventListener("chargingchange", note); const check = () => { lowBattery = !b.charging && b.level < 0.3; if (lowBattery && running && guard("g-battery")) halt("Paused: battery is low and not charging."); else if (!lowBattery) start(); }; b.addEventListener("levelchange", check); b.addEventListener("chargingchange", check); check(); });
show();
fetch("collector.json", { cache: "no-store" }).then((r) => r.json()).then((c) => { endpoint = /^https:\/\/(ntfy\.sh\/[A-Za-z0-9_-]{10,}$|script\.google\.com\/)/.test(c.endpoint || "") ? c.endpoint : ""; }).catch(() => {}).finally(() => {
  try { $("consent").checked = localStorage.getItem(OK_KEY) === "1"; } catch (e) {}
  if (!endpoint && !PREVIEW) { $("consent").checked = false; $("consent").disabled = true; status("Collection is not switched on yet, so no device is being used. Please check back later."); } else start();
});
