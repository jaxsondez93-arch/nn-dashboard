/* The puzzle editor page: place every block and the pickup, set every number, build it in the real game, fire a test shot at an aim, read the board back from the game, share it as a link.
   The logic that does not touch the page is editor-core.js (tested without a page); the scene format and the game side (build, fire, capture, the progress bar) are scene.js. */
(function () {
  "use strict";
  const C = window.NNEditorCore, S = window.NNScene, L = S.LIMITS, $ = (id) => document.getElementById(id), SVGNS = "http://www.w3.org/2000/svg", KEY = "nn-editor-v1";
  const svg = $("ed-board"), NUM = { score: "n-score", balls: "n-balls", health: "n-health", turn: "n-turn", counter: "n-counter", pickupTimer: "n-timer" };
  const HINTS = {
    select: "Move: drag a block or the pickup to move it; tap one to edit its numbers. Tap empty space to let go of it.",
    block: "Add block: tap the board to put a block there, with the health in the last block you used. Tapping a block selects it instead.",
    pickup: "Pickup: tap the board to put the pickup there. The game only ever has one, so tapping again moves it. A ball touching it adds a ball.",
    aim: "Aim: tap anywhere below the dot at the top. The dashed line is the way the balls leave (they bounce, so the line only shows the first leg).",
  };
  let state = C.blank(), hist = C.history(state), mode = "select", sel = null, data = null, resolved = null, drag = null, tapStart = null, layoutSeed = null, layoutKey = "", pickupLeft = true;
  const el = (name, attrs, text) => { const e = document.createElementNS(SVGNS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; };
  const say = (s, bad, good) => S.say(s, bad, good), snapStep = () => Number($("ed-snap").value) || 0;
  const things = (kind) => (kind === "block" ? state.blocks : state.pickups), cur = () => (sel ? things(sel.kind)[sel.i] : undefined);
  const debounce = (f, ms) => { let t = 0; return () => { clearTimeout(t); t = setTimeout(f, ms); }; };
  const num = (v) => (typeof v === "number" ? v.toLocaleString() : String(v)), plural = (n, w) => `${num(n)} ${w}${n === 1 ? "" : "s"}`;
  const hue = (hp) => { const v = Number(hp); return Number.isFinite(v) && v > 0 ? Math.round((Math.log2(v + 1) * 53) % 360) : 0; };

  /* ---------- the board ---------- */
  function drawStatic() {
    const g = $("ed-static"); g.replaceChildren();
    g.append(el("rect", { class: "bg", x: 0, y: 0, width: 720, height: 1280, fill: "#141a26" }), el("rect", { x: 0, y: 0, width: 720, height: 89, fill: "#4a1a22", "pointer-events": "none" }),
      el("text", { x: 18, y: 56, fill: "#ff9aa6", "font-size": 28, "font-weight": 700, "pointer-events": "none" }, "LOSS LINE"), el("rect", { x: 0, y: 89, width: 720, height: 86, fill: "#5b4a12", opacity: 0.35, "pointer-events": "none" }),
      el("rect", { x: L.xMin, y: L.yMin, width: L.xMax - L.xMin, height: L.yMax - L.yMin, fill: "none", stroke: "#3c5576", "stroke-width": 3, "stroke-dasharray": "14 10", "pointer-events": "none" }));
    for (let k = 0; k <= 8; k++) { const y = C.SPAWN_Y - C.ROW * k; g.append(el("line", { x1: 0, x2: 720, y1: y, y2: y, stroke: "#26324a", "stroke-width": 2, "pointer-events": "none" }), el("text", { x: 706, y: y - 8, "text-anchor": "end", fill: "#5f7596", "font-size": 24, "pointer-events": "none" }, String(C.shotsLeft(y)))); }
    g.append(el("circle", { cx: C.LAUNCHER.x, cy: C.LAUNCHER.y, r: 28, fill: "#8fe6ff", "pointer-events": "none" }), el("text", { x: C.LAUNCHER.x, y: C.LAUNCHER.y + 72, "text-anchor": "middle", fill: "#8fe6ff", "font-size": 24, "pointer-events": "none" }, "the balls come from here"));
  }
  function renderBoard() {
    const bad = C.trouble(state, L), layer = $("ed-things"), aimLayer = $("ed-aim"); layer.replaceChildren(); aimLayer.replaceChildren();
    state.blocks.forEach((b, i) => {
      const on = sel && sel.kind === "block" && sel.i === i, text = String(b.hp), fs = text.length <= 3 ? 56 : text.length <= 5 ? 44 : text.length <= 8 ? 32 : 24, h = hue(b.hp);
      const g = el("g", { class: "thing", "data-kind": "block", "data-i": i, transform: `translate(${b.x} ${b.y})` });
      g.append(el("rect", { x: -60, y: -60, width: 120, height: 120, rx: 18, fill: bad.blocks[i] ? "#7a2230" : `hsl(${h} 50% 36%)`, stroke: on ? "#fff" : bad.blocks[i] ? "#ff6b7d" : `hsl(${h} 60% 55%)`, "stroke-width": on ? 8 : 4 }));
      const t = el("text", { x: 0, y: fs * 0.36, "text-anchor": "middle", fill: "#fff", "font-size": fs, "font-weight": 700, "pointer-events": "none" }, text);
      if (text.length > 9) { t.setAttribute("textLength", 104); t.setAttribute("lengthAdjust", "spacingAndGlyphs"); } g.append(t); layer.append(g);
    });
    state.pickups.forEach((p, i) => {
      const on = sel && sel.kind === "pickup" && sel.i === i, g = el("g", { class: "thing", "data-kind": "pickup", "data-i": i, transform: `translate(${p.x} ${p.y})` });
      g.append(el("circle", { r: 40, fill: bad.pickups[i] ? "#7a2230" : "#c99a1c", stroke: on ? "#fff" : bad.pickups[i] ? "#ff6b7d" : "#ffd24d", "stroke-width": on ? 8 : 4 }), el("text", { x: 0, y: 14, "text-anchor": "middle", fill: "#fff", "font-size": 40, "font-weight": 700, "pointer-events": "none" }, "+1")); layer.append(g);
    });
    if (state.aim) {                                                                                   // the first leg of the shot: from the launcher through the aim point, to the wall or the bottom
      const a = state.aim, dx = a.x - C.LAUNCHER.x, dy = a.y - C.LAUNCHER.y, tEnd = Math.min((C.FIELD.h - C.LAUNCHER.y) / dy, dx > 0 ? (C.FIELD.w - C.LAUNCHER.x) / dx : dx < 0 ? -C.LAUNCHER.x / dx : Infinity);
      aimLayer.append(el("line", { x1: C.LAUNCHER.x, y1: C.LAUNCHER.y, x2: C.LAUNCHER.x + dx * tEnd, y2: C.LAUNCHER.y + dy * tEnd, stroke: "#58d6ff", "stroke-width": 5, "stroke-dasharray": "18 12", opacity: 0.9, "pointer-events": "none" }),
        el("circle", { cx: a.x, cy: a.y, r: 14, fill: "none", stroke: "#58d6ff", "stroke-width": 5, "pointer-events": "none" }), el("text", { x: a.x + 24, y: a.y - 14, fill: "#58d6ff", "font-size": 26, "font-weight": 700, "pointer-events": "none" }, "aim"));
    }
    $("ed-aim-info").textContent = state.aim ? `Aim set: tap at pixel (${C.aimPixel(state.aim).join(", ")}) of the game's 480 x 853 view.` : "No aim set yet (press Aim, then tap the board).";
  }
  const toField = (e) => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); return { x: p.x, y: p.y }; };
  svg.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return; const p = toField(e), g = mode !== "aim" && e.target.closest ? e.target.closest("g.thing") : null;           // in Aim mode a tap is an aim wherever it lands, even on a block
    if (g) {
      const kind = g.dataset.kind, i = Number(g.dataset.i), t = things(kind)[i]; sel = { kind, i };
      drag = { kind, i, id: e.pointerId, dx: t.x - p.x, dy: t.y - p.y, moved: false, sx: e.clientX, sy: e.clientY };
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* a pointer that cannot be captured still drags while it stays on the board */ }
      syncSelected(); renderBoard(); e.preventDefault();
    } else tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), p };
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id || (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4)) return;
    drag.moved = true; const p = toField(e), t = things(drag.kind)[drag.i], q = C.place(L, p.x + drag.dx, p.y + drag.dy, snapStep()); t.x = q.x; t.y = q.y;
    const g = svg.querySelector(`g.thing[data-kind="${drag.kind}"][data-i="${drag.i}"]`); if (g) g.setAttribute("transform", `translate(${t.x} ${t.y})`);         // move the shape itself while the finger is down, rebuild everything when it lifts
    syncSelected(); e.preventDefault();
  });
  svg.addEventListener("pointerup", (e) => {
    if (drag && e.pointerId === drag.id) { const d = drag; drag = null; try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* already released */ } if (d.moved) commit(); else renderAll({ keepTable: false }); return; }
    if (tapStart && e.pointerId === tapStart.id) { const s = tapStart; tapStart = null; if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < 10 && performance.now() - s.t < 700) boardTap(s.p); }
  });
  svg.addEventListener("pointercancel", () => { if (drag) { drag = null; renderAll(); } tapStart = null; });
  svg.addEventListener("touchmove", (e) => { if (drag) e.preventDefault(); }, { passive: false });                    // a finger on a block moves the block, not the page
  svg.addEventListener("keydown", (e) => {
    const t = cur(); if (!t) return; const step = (e.shiftKey ? 10 : 1) * (snapStep() || 1), mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (mv) { nudge(mv[0], mv[1]); e.preventDefault(); } else if (e.key === "Delete" || e.key === "Backspace") { removeSelected(); e.preventDefault(); }
  });
  function boardTap(p) {
    if (mode === "block" || mode === "pickup") {
      const q = C.place(L, p.x, p.y, snapStep());
      if (mode === "block") { if (state.blocks.length >= L.maxBlocks) { say(`At most ${L.maxBlocks} blocks.`, true); return; } state.blocks.push({ x: q.x, y: q.y, hp: defaultHp() }); sel = { kind: "block", i: state.blocks.length - 1 }; }
      else { state.pickups = [{ x: q.x, y: q.y }]; sel = { kind: "pickup", i: 0 }; }                              // there is only ever one: placing it again moves it
      commit();
    } else if (mode === "aim") { const a = C.aimFrom(p.x, p.y); if (!a) { say("Tap below the dot at the top: the balls only go downward.", true); return; } state.aim = a; commit(); }
    else { sel = null; renderAll({ keepTable: true }); }
  }
  function defaultHp() {
    const c = cur(); if (c && sel.kind === "block" && Number.isInteger(c.hp) && c.hp >= 1) return c.hp;
    const last = state.blocks[state.blocks.length - 1]; if (last && Number.isInteger(last.hp) && last.hp >= 1) return last.hp;
    const h = Number(state.numbers.health); if (Number.isInteger(h) && h >= 1) return h; return resolved && resolved.scene ? resolved.scene.health : 5;
  }

  /* ---------- the selected block or pickup ---------- */
  function syncSelected() {
    const t = cur(), box = $("ed-sel"); if (!t) { box.hidden = true; return; } box.hidden = false;
    $("sel-title").textContent = sel.kind === "block" ? `Block ${sel.i + 1}` : "The pickup"; for (const id of ["sel-hp-wrap", "sel-hp-btns", "sel-dup"]) $(id).hidden = sel.kind !== "block";
    for (const [id, v] of [["sel-x", t.x], ["sel-y", t.y], ["sel-hp", t.hp]]) { const e = $(id); if (document.activeElement !== e) { e.value = v === undefined ? "" : String(v); e.classList.remove("invalid"); } }
    $("sel-shots").textContent = `${plural(C.shotsLeft(t.y), "shot")} from the line`;
  }
  function nudge(dx, dy) { const t = cur(); if (!t) return; const q = C.place(L, t.x + dx, t.y + dy, 0); t.x = q.x; t.y = q.y; commit(); }
  function removeSelected() { if (!sel) return; things(sel.kind).splice(sel.i, 1); sel = null; commit(); }
  const free = (x, y) => state.blocks.concat(state.pickups).every((t) => Math.hypot(t.x - x, t.y - y) >= L.gap);
  function duplicate() {
    const t = cur(); if (!t || sel.kind !== "block") return; if (state.blocks.length >= L.maxBlocks) { say(`At most ${L.maxBlocks} blocks.`, true); return; }
    for (const [dx, dy] of [[130, 0], [-130, 0], [0, -130], [0, 130], [130, -130], [-130, -130], [260, 0], [-260, 0]]) {
      const q = C.place(L, t.x + dx, t.y + dy, 0); if (Math.abs(q.x - (t.x + dx)) < 1 && Math.abs(q.y - (t.y + dy)) < 1 && free(q.x, q.y)) { state.blocks.push({ x: q.x, y: q.y, hp: t.hp }); sel = { kind: "block", i: state.blocks.length - 1 }; commit(); return; }
    }
    say("There is no free place next to it for a copy; move something first.", true);
  }
  for (const id of ["sel-x", "sel-y", "sel-hp"]) {
    const e = $(id), key = id.slice(4);
    e.addEventListener("input", () => { const t = cur(), v = Number(e.value); if (!t) return; if (e.value.trim() === "" || !Number.isFinite(v)) { e.classList.add("invalid"); return; } e.classList.remove("invalid"); t[key] = v; renderBoard(); scheduleResolve(); $("sel-note").textContent = S.inexact(e.value).length ? `The game holds ${S.inexact(e.value)[0].held} (its numbers are 64-bit floats).` : ""; });
    e.addEventListener("change", () => { if (!e.classList.contains("invalid") && cur()) commit({ keepSelected: true }); });
  }
  $("sel-hp-minus").onclick = () => { const t = cur(); if (t) { t.hp = Number.isInteger(t.hp) ? Math.max(1, t.hp - 1) : 1; commit(); } };
  $("sel-hp-plus").onclick = () => { const t = cur(); if (t) { t.hp = Number.isInteger(t.hp) ? t.hp + 1 : 1; commit(); } };
  $("nudge-l").onclick = () => nudge(-(snapStep() || 1), 0); $("nudge-r").onclick = () => nudge(snapStep() || 1, 0); $("nudge-u").onclick = () => nudge(0, -(snapStep() || 1)); $("nudge-d").onclick = () => nudge(0, snapStep() || 1);
  $("sel-up").onclick = () => nudge(0, -C.ROW); $("sel-down").onclick = () => nudge(0, C.ROW); $("sel-mirror").onclick = () => { const t = cur(); if (t) { t.x = C.FIELD.w - t.x; commit(); } };
  $("sel-dup").onclick = duplicate; $("sel-del").onclick = removeSelected;

  /* ---------- the numbers, rows and whole-board actions ---------- */
  $("n-name").addEventListener("input", (e) => { state.name = e.target.value; scheduleResolve(); scheduleSave(); }); $("n-name").addEventListener("change", () => commit({ keepTable: true }));
  for (const k of C.NUMBERS) {
    const e = $(NUM[k]);
    e.addEventListener("input", () => { state.numbers[k] = e.value; $("n-note").textContent = S.inexactNote(C.NUMBERS.map((q) => state.numbers[q]).join(" ")).replace(/^ Note: /, ""); scheduleResolve(); scheduleSave(); });
    e.addEventListener("change", () => commit({ keepTable: true }));
  }
  function addRow(n) {
    if (state.blocks.length + n > L.maxBlocks) { say(`At most ${L.maxBlocks} blocks.`, true); return; }
    const hp = defaultHp(); for (let y = C.SPAWN_Y; y >= L.yMin + 100; y -= C.ROW) {
      const row = C.rowOf(n, y, S.RULES); if (row.every((q) => q.y >= L.yMin && q.y <= L.yMax && free(q.x, q.y))) { const first = state.blocks.length; row.forEach((q) => state.blocks.push({ x: q.x, y: q.y, hp })); sel = { kind: "block", i: first }; commit(); return; }
    }
    say("There is no room for a row: move something first.", true);
  }
  function addPickupRow() {
    if (state.pickups.length) { say("There is already a pickup (the game only has one at a time): drag it, or delete it first.", true); return; }
    if (state.blocks.length >= L.maxBlocks) { say(`At most ${L.maxBlocks} blocks.`, true); return; }
    for (let y = C.SPAWN_Y; y >= L.yMin + 100; y -= C.ROW) {
      const r = C.pickupRowOf(S.RULES, pickupLeft); if ([r.pickup, r.block].every((q) => free(q.x, q.y - (C.SPAWN_Y - y)))) {
        state.pickups = [{ x: r.pickup.x, y: y }]; state.blocks.push({ x: r.block.x, y, hp: defaultHp() }); sel = { kind: "pickup", i: 0 }; pickupLeft = !pickupLeft; commit(); return; }
    }
    say("There is no room for a pickup row: move something first.", true);
  }
  $("row-1").onclick = () => addRow(1); $("row-2").onclick = () => addRow(2); $("row-3").onclick = () => addRow(3); $("row-pickup").onclick = addPickupRow;
  $("ed-clear").onclick = () => { state.blocks = []; state.pickups = []; sel = null; commit(); say("Cleared the board. Undo brings it back.", false, true); };
  $("ed-mirror").onclick = () => { for (const t of state.blocks.concat(state.pickups)) t.x = C.FIELD.w - t.x; if (state.aim) state.aim.x = C.FIELD.w - state.aim.x; commit(); };
  function undo() { const s = hist.undo(); if (s) { state = s; fixSelection(); saveLocal(); renderAll(); } }
  function redo() { const s = hist.redo(); if (s) { state = s; fixSelection(); saveLocal(); renderAll(); } }
  $("ed-undo").onclick = undo; $("ed-redo").onclick = redo;
  document.addEventListener("keydown", (e) => { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || !(e.ctrlKey || e.metaKey)) return; const k = e.key.toLowerCase(); if (k === "z" && !e.shiftKey) { undo(); e.preventDefault(); } else if (k === "y" || (k === "z" && e.shiftKey)) { redo(); e.preventDefault(); } });
  const fixSelection = () => { if (sel && !cur()) sel = null; };
  function setMode(m) { mode = m; for (const k of ["select", "block", "pickup", "aim"]) $("mode-" + k).setAttribute("aria-pressed", String(k === m)); svg.classList.toggle("adding", m === "block" || m === "pickup"); svg.classList.toggle("aiming", m === "aim"); $("ed-hint").textContent = HINTS[m]; }
  for (const m of ["select", "block", "pickup", "aim"]) $("mode-" + m).onclick = () => setMode(m);

  /* ---------- what the numbers add up to ---------- */
  function resolve() {
    const input = C.toInput(state);
    resolved = !state.blocks.length ? { errors: ["Add at least one block: press + Block and tap the board (or press Typical board)."] } : data ? S.complete(input, data) : S.validate(input);
    const ul = $("ed-issues"); ul.replaceChildren(); const add = (t, k) => { const li = document.createElement("li"); li.className = k; li.textContent = t; ul.append(li); };
    if (resolved.errors) resolved.errors.forEach((m) => add(m, "bad")); else { const s = resolved.scene; add(`Ready: ${plural(s.blocks.length, "block")}${s.pickups.length ? " and the pickup" : ""}, ${plural(s.balls, "ball")}, score ${num(s.score)}, new-block health ${num(s.health === undefined ? 1 : s.health)}.`, "ok"); }
    const s = resolved.scene, auto = s ? { score: s.score, balls: s.balls, health: s.health, turn: s.turn, counter: s.counter !== undefined ? s.counter : (s.turn === undefined ? 1 : s.turn) % 3, pickupTimer: s.pickups.length ? "set for you" : s.pickupTimer !== undefined ? s.pickupTimer : 0 } : {};
    for (const k of C.NUMBERS) { const v = auto[k]; $(NUM[k]).placeholder = v === undefined ? "auto" : `auto: ${typeof v === "number" ? num(v) : v}`; }
    $("n-timer").disabled = state.pickups.length > 0; if (document.activeElement !== $("ed-json")) $("ed-json").value = s ? S.pretty(s) : ""; $("ed-link").value = shareLink();
  }
  const scheduleResolve = debounce(resolve, 120), saveLocal = () => { try { localStorage.setItem(KEY, C.encode(state)); } catch (e) { /* private window or no room: the page still works */ } }, scheduleSave = debounce(saveLocal, 400);
  const shareLink = () => `${location.origin === "null" ? "" : location.origin}${location.pathname}#s=${C.encode(state)}`;

  /* ---------- the table of exact numbers ---------- */
  function renderTable() {
    const tb = $("ed-table").querySelector("tbody"); tb.replaceChildren();
    const add = (kind, i, t) => {
      const tr = document.createElement("tr"); tr.dataset.kind = kind; tr.dataset.i = i; if (sel && sel.kind === kind && sel.i === i) tr.className = "on";
      const cell = (child) => { const c = document.createElement("td"); c.append(child); tr.append(c); };
      const name = document.createElement("button"); name.type = "button"; name.dataset.act = "select"; name.textContent = kind === "block" ? `Block ${i + 1}` : "Pickup"; cell(name);
      for (const f of kind === "block" ? ["x", "y", "hp"] : ["x", "y"]) { const inp = document.createElement("input"); inp.value = String(t[f]); inp.dataset.f = f; inp.inputMode = "decimal"; inp.setAttribute("aria-label", `${name.textContent} ${f === "hp" ? "health" : f}`); cell(inp); }
      if (kind === "pickup") cell(document.createTextNode("-"));
      const del = document.createElement("button"); del.type = "button"; del.dataset.act = "delete"; del.textContent = "✕"; del.setAttribute("aria-label", `Delete ${name.textContent}`); cell(del); tb.append(tr);
    };
    state.blocks.forEach((b, i) => add("block", i, b)); state.pickups.forEach((p, i) => add("pickup", i, p));
  }
  $("ed-table").addEventListener("change", (e) => {
    const inp = e.target; if (!(inp instanceof HTMLInputElement)) return; const tr = inp.closest("tr"), t = things(tr.dataset.kind)[Number(tr.dataset.i)], v = Number(inp.value);
    if (inp.value.trim() === "" || !Number.isFinite(v)) { inp.classList.add("invalid"); say(`"${inp.value}" is not a number.`, true); return; } t[inp.dataset.f] = v; commit({ keepTable: true });
  });
  $("ed-table").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return; const tr = b.closest("tr"), kind = tr.dataset.kind, i = Number(tr.dataset.i);
    if (b.dataset.act === "delete") { things(kind).splice(i, 1); sel = null; commit(); } else { sel = { kind, i }; renderAll({ keepTable: true }); }
  });

  /* ---------- keeping everything in step ---------- */
  function renderAll(opts) {
    opts = opts || {}; renderBoard(); syncSelected(); if (!opts.keepTable) renderTable();
    for (const k of C.NUMBERS) { const e = $(NUM[k]); if (document.activeElement !== e) e.value = state.numbers[k]; } if (document.activeElement !== $("n-name")) $("n-name").value = state.name;
    $("ed-undo").disabled = !hist.canUndo(); $("ed-redo").disabled = !hist.canRedo(); resolve();
  }
  function commit(opts) { hist.push(state); saveLocal(); renderAll(opts); }

  /* ---------- the game ---------- */
  const actionButtons = () => ["ed-build", "ed-build-start", "ed-fire", "ed-read", "ed-fill", "ed-typical"].map($);
  function noteText() {
    const typed = S.inexactNote(C.NUMBERS.map((k) => state.numbers[k]).join(" ")), big = state.blocks.map((b, i) => [b, i]).filter(([b]) => Number.isInteger(b.hp) && !Number.isSafeInteger(b.hp)).map(([b, i]) => `block ${i + 1}'s health is ${BigInt(b.hp)}`);
    return typed + (big.length ? ` Note: ${big.join(", ")}, past 9,007,199,254,740,991, where the game cannot always take 1 off for a hit.` : "");
  }
  async function doBuild(startBot, btn) {
    if (!resolved || !resolved.scene) { say("Fix this first: " + (resolved ? resolved.errors.join(" ") : "the page is still loading."), true); return; }
    const scene = resolved.scene, notes = noteText(), r = await S.withProgress(btn, actionButtons(), (step) => S.build(scene, step), "Could not build it"); if (!r.ok) return;
    say(`Done in ${r.secs.toFixed(1)} s: ${plural(scene.blocks.length, "block")}${scene.pickups.length ? " and the pickup" : ""}, ${plural(scene.balls, "ball")}, score ${num(scene.score)}. ${startBot ? "The bot is starting." : state.aim ? "Fire a test shot, or start the bot." : "Set an aim to fire a test shot, or start the bot."}${notes}`, false, true);
    if (startBot) $("start").click();
  }
  const shotLine = (v) => (v.outcome === "ok" ? `Shot done in ${v.secs} s: damage ${num(v.damage)}, ${plural(v.destroyed, "block")} destroyed${v.ballsGained ? `, +${v.ballsGained} ball` : ""}, score ${num(v.scoreBefore)} to ${num(v.scoreAfter)}.` : { left: "The game ended on that shot: a block reached the line.", no_launch: "No ball was launched: the game did not take the tap.", stuck: "The shot did not finish in time." }[v.outcome]);
  function showShot(v) {
    const card = $("ed-shot"); card.hidden = false; card.replaceChildren(); const h = document.createElement("strong"), p = document.createElement("p"); p.className = "note"; card.append(h);
    if (v.outcome !== "ok") { h.textContent = shotLine(v); p.textContent = "Build the board again to carry on."; card.append(p); return; }
    h.textContent = "Last test shot"; const dl = document.createElement("dl"), row = (k, val) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = val; dl.append(dt, dd); };
    row("damage", num(v.damage)); row("blocks destroyed", num(v.destroyed)); row("balls", `${num(v.ballsBefore)} to ${num(v.ballsAfter)}${v.ballsGained ? ` (+${v.ballsGained})` : ""}`); row("score", `${num(v.scoreBefore)} to ${num(v.scoreAfter)}`); row("time", `${v.secs} s`); card.append(dl);
    p.textContent = "The game has moved on one turn. Press Read the board from the game to carry on from here."; card.append(p);
  }
  async function doFire(btn) {
    if (!state.aim) { say("Set an aim first: press Aim, then tap the board below the dot at the top.", true); return; }
    if ($("start").disabled) { say("Pause the bot first: it is playing.", true); return; }
    if (!S.isSettled()) { say("The game is not ready for a shot: press Build it first.", true); return; }
    const r = await S.withProgress(btn, actionButtons(), (step) => { step("Firing at the aim"); return S.fire(C.aimPixel(state.aim), {}); }, "Could not fire"); if (!r.ok) return;
    showShot(r.value); say(shotLine(r.value), r.value.outcome !== "ok", r.value.outcome === "ok");
  }
  function doRead() {
    try {
      const sc = S.capture(), name = state.name, aim = state.aim; state = C.fromScene(sc); state.name = name; state.aim = aim; sel = null; commit();
      say(`Read from the game: ${plural(sc.blocks.length, "block")}${sc.pickups.length ? " and the pickup" : ""}, ${plural(sc.balls, "ball")}, score ${num(sc.score)}.`, false, true);
    } catch (e) { say(`Could not read the game: ${e.message}`, true); }
  }
  function doTypical() {
    if (!data) { say("The numbers a real game has are still loading; try again in a moment.", true); return; }
    const input = C.toInput(state); delete input.blocks; delete input.pickups; const key = JSON.stringify(input); if (key !== layoutKey) { layoutKey = key; layoutSeed = null; } if (layoutSeed !== null) input.seed = layoutSeed;
    const r = S.complete(input, data); if (r.errors) { say(r.errors.join(" "), true); return; }
    layoutSeed = (r.scene.seed === undefined ? 0 : r.scene.seed) + 1; state.blocks = C.fromScene(r.scene).blocks; state.pickups = []; sel = null; commit();
    say(`A typical board for those numbers: ${plural(state.blocks.length, "block")}. Press it again for another layout.`, false, true);
  }
  function doFill() {
    if (!resolved || !resolved.scene) { say("Fix this first: " + (resolved ? resolved.errors.join(" ") : "the page is still loading."), true); return; }
    const filled = (resolved.filled || []).filter((f) => C.NUMBERS.includes(f.field)); if (!filled.length) { say("Nothing to fill in: those numbers are all set.", false, true); return; }
    for (const f of filled) state.numbers[f.field] = String(f.value); commit({ keepTable: true }); say(`Filled in: ${filled.map((f) => `${f.field} ${num(f.value)}`).join(", ")}. What you had typed is unchanged.`, false, true);
  }
  $("ed-build").onclick = (e) => doBuild(false, e.currentTarget); $("ed-build-start").onclick = (e) => doBuild(true, e.currentTarget); $("ed-fire").onclick = (e) => doFire(e.currentTarget);
  $("ed-read").onclick = doRead; $("ed-typical").onclick = doTypical; $("ed-fill").onclick = doFill;

  /* ---------- sharing ---------- */
  async function copyText(text, what) {
    try { await navigator.clipboard.writeText(text); say(`${what} copied.`, false, true); } catch (e) {
      const t = document.createElement("textarea"); t.value = text; t.style.cssText = "position:fixed;opacity:0"; document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (x) { ok = false; } t.remove();
      say(ok ? `${what} copied.` : "Could not copy it: select the text in the box and copy it by hand.", !ok, ok);
    }
  }
  function loadObject(obj, from) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("that is not a scene (it should look like { \"score\": 38 })");
    const aim = state.aim; state = C.fromScene(obj); state.aim = aim; sel = null; commit(); say(`Loaded ${from}: ${plural(state.blocks.length, "block")}${state.pickups.length ? " and the pickup" : ""}.`, false, true);
  }
  $("ed-copy-link").onclick = () => copyText(shareLink(), "The link"); $("ed-copy-json").onclick = () => copyText($("ed-json").value, "The scene");
  $("ed-load").onclick = () => { try { loadObject(JSON.parse($("ed-json").value), "from the text box"); } catch (e) { say(`Could not load that: ${e.message}`, true); } };
  $("ed-download").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([$("ed-json").value], { type: "application/json" })); a.download = "puzzle.json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  $("ed-file").addEventListener("change", async (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; try { loadObject(JSON.parse(await f.text()), `from ${f.name}`); } catch (x) { say(`Could not load ${f.name}: ${x.message}`, true); } e.target.value = ""; });

  /* ---------- start ---------- */
  function init() {
    drawStatic(); let loaded = false; const m = /[#&]s=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (m) { try { state = C.decode(m[1]); loaded = true; say("Loaded the puzzle from the link.", false, true); } catch (e) { say(e.message, true); } }
    if (!loaded) { try { const saved = localStorage.getItem(KEY); if (saved) { state = C.decode(saved); loaded = true; } } catch (e) { loaded = false; } }
    if (!loaded) state = C.fromScene(S.EXAMPLE);
    hist = C.history(state); setMode("select"); renderAll(); S.ready.then((d) => { data = d; resolve(); });
  }
  init();
})();
