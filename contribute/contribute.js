/* One consent box. Ticked: a background worker computes units and finished results are sent automatically to the collector. Unticked: everything stops.
   Nothing runs without consent, and nothing runs if no collector is configured (so no device is used for work that cannot be received). Add ?preview=1 to try it without sending. */
"use strict";
const $ = (id) => document.getElementById(id), PREVIEW = /[?&]preview=1/.test(location.search), CAP_MS = 30 * 60000, QUEUE_KEY = "nn-queue", OK_KEY = "nn-consent";
let endpoint = "", worker = null, units = 0, running = false, busy = false, shots = 0, sentShots = 0, queue = [], runMs = 0, last = 0, lowBattery = false;
try { queue = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); shots = +localStorage.getItem("nn-shots") || 0; } catch (e) {}
const save = () => { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-400))); localStorage.setItem("nn-shots", String(shots)); } catch (e) {} };
function status(msg) { $("status").textContent = msg; $("state").className = busy ? "on" : ""; }
function show() { $("count").textContent = shots.toLocaleString(); $("sent").textContent = PREVIEW ? "Preview mode: nothing is sent." : (sentShots ? `${sentShots.toLocaleString()} sent this visit` : ""); }
function pickUnit() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % units; }      // random task; two devices doing the same one is a useful cross-check

async function send() {                                                                 // automatic: every few units, and again later if the network is down
  if (PREVIEW || !endpoint || !queue.length) return; const batch = queue.slice(0, 50);
  try { await fetch(endpoint, { method: "POST", mode: "no-cors", keepalive: true, body: JSON.stringify({ v: 3, results: batch }) });
    queue.splice(0, batch.length); sentShots += batch.reduce((a, r) => a + r.d.length, 0); save(); show(); } catch (e) { /* offline: kept and retried */ }
}
function next() { if (!running) return; if (runMs >= CAP_MS) { halt("Done for this visit (30 minutes). Thank you!"); return; } busy = true; worker.postMessage({ cmd: "unit", unit: pickUnit() }); status("Working. Thank you!"); }
function start() {
  if (running || !$("consent").checked) return;
  if (!endpoint && !PREVIEW) { status("Collection is not switched on yet, so your device is not being used. Please check back later."); return; }
  if (document.hidden) { status("Paused while the page is hidden."); return; }
  if (lowBattery) { status("Paused: battery is low and not charging."); return; }
  running = true; last = performance.now();
  if (!worker) { status("Loading the simulator..."); worker = new Worker("worker.js"); worker.onerror = () => halt("This copy of the site cannot run the simulator.");
    worker.onmessage = (e) => { const m = e.data; if (m.type === "ready") { units = m.units; next(); } else if (m.type === "shot") { shots++; show(); } else if (m.type === "unit") { if (!PREVIEW) queue.push(m.result); save(); if (queue.length >= 3) send(); next(); } else if (m.type === "error") halt("The simulator could not start on this device."); }; }
  else if (units) next();
}
function halt(msg) { running = false; busy = false; if (worker) worker.postMessage({ cmd: "stop" }); status(msg); send(); }
setInterval(() => { const t = performance.now(); if (running) runMs += t - last; last = t; }, 1000); setInterval(send, 30000);
$("consent").addEventListener("change", () => { const on = $("consent").checked; try { localStorage.setItem(OK_KEY, on ? "1" : "0"); } catch (e) {} if (on) start(); else halt("Stopped. Nothing is running."); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { if (running) halt("Paused while the page is hidden."); } else start(); });
window.addEventListener("online", send);
if (navigator.getBattery) navigator.getBattery().then((b) => { const check = () => { lowBattery = !b.charging && b.level < 0.3; if (lowBattery && running) halt("Paused: battery is low and not charging."); else if (!lowBattery) start(); }; b.addEventListener("levelchange", check); b.addEventListener("chargingchange", check); check(); });
show();
fetch("collector.json", { cache: "no-store" }).then((r) => r.json()).then((c) => { endpoint = /^https:\/\/script\.google\.com\//.test(c.endpoint || "") ? c.endpoint : ""; }).catch(() => {}).finally(() => {
  try { $("consent").checked = localStorage.getItem(OK_KEY) === "1"; } catch (e) {}
  if (!endpoint && !PREVIEW) { $("consent").checked = false; $("consent").disabled = true; status("Collection is not switched on yet, so no device is being used. Please check back later."); } else start();
});
