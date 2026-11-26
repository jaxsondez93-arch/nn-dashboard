/* The puzzle editor's logic that does not touch the page, so it is tested without one: the editing state, snapping, the shapes of the rows the game makes, turning a tap on the board into an aim,
   undo and redo, and the share-link format. The page part is editor.js; the scene format and its checks are scene.js.

   The state keeps every number as the text in its box, so "empty" (fill it in for me) is a state of its own and nothing typed is ever reinterpreted:
     { name, numbers: { score, balls, health, turn, counter, pickupTimer }, blocks: [{ x, y, hp }], pickups: [{ x, y }], aim: { x, y } | null } */
(function (root) {
  "use strict";
  const FIELD = { w: 720, h: 1280 };                                         // the game's play field
  const LAUNCHER = { x: 360, y: 90 };                                        // where the balls come from: the top, in the middle
  const SIZE = { block: 120, pickup: 72, ball: 50 };                          // the sprites, in play-field pixels
  const ROW = 126, SPAWN_Y = 1200, LOSS_Y = 119;                             // a row rises 126 a turn from y = 1200; hud.js counts a block as lost at y = 119
  const AIM = { y: 300, xMin: 22, xMax: 698, view: 1.5 };                    // the bot's taps lie in y 180 to 444; an aim is a direction, kept as where it crosses the middle of that band. view: play-field pixels per pixel of the 480 x 853 view the taps are sent in
  const NUMBERS = ["score", "balls", "health", "turn", "counter", "pickupTimer"];
  const round1 = (v) => Math.round(v * 10) / 10, clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  const blank = () => ({ name: "", numbers: { score: "", balls: "", health: "", turn: "", counter: "", pickupTimer: "" }, blocks: [], pickups: [], aim: null });
  const copy = (state) => JSON.parse(JSON.stringify(state));

  /* ---------- placing things ---------- */
  /* "step" 0 means no snapping (tenths of a pixel). */
  const snap = (v, step) => (step ? Math.round(v / step) * step : round1(v));
  const place = (L, x, y, step) => ({ x: clamp(snap(x, step), L.xMin, L.xMax), y: clamp(snap(y, step), L.yMin, L.yMax) });
  /* A pickup row the way the game makes it: one block and the pickup, one on each side (the pickup in 120 to 240 and the block in 340 to 600, or the other way round), each in the middle of its lane. */
  function pickupRowOf(rules, pickupLeft) { const [blockSide, pickupSide] = pickupLeft ? [rules.pickupRow.blockSides[0], rules.pickupRow.blockSides[1]] : [rules.pickupRow.blockSides[1], rules.pickupRow.blockSides[0]], mid = ([lo, hi]) => Math.round((lo + hi) / 2); return { pickup: { x: mid(pickupSide), y: rules.pickupRow.y }, block: { x: mid(blockSide), y: rules.pickupRow.y } }; }
  /* The row of 1, 2 or 3 blocks the game itself adds, one in the middle of each of its lanes (a row of three sits 10 lower, as in the game). "rules" is scene.js's RULES. */
  function rowOf(n, y, rules) { const row = rules.rows[n]; return row.x.map(([lo, hi]) => ({ x: Math.round((lo + hi) / 2), y: y + (row.y - SPAWN_Y) })); }
  /* How many shots away a block at height y is from the line (1 = it has to be broken this shot): the same count as the danger meter. */
  const shotsLeft = (y) => Math.max(1, Math.ceil((y - LOSS_Y) / ROW - 1e-9));

  /* ---------- aiming ---------- */
  /* A tap anywhere below the launcher names a direction. Returns where that direction crosses the middle of the bot's tapping band, or null for a tap that is not below the launcher. */
  function aimFrom(x, y) {
    const dy = y - LAUNCHER.y; if (!(dy > 20)) return null;
    return { x: Math.round(clamp(LAUNCHER.x + ((x - LAUNCHER.x) * (AIM.y - LAUNCHER.y)) / dy, AIM.xMin, AIM.xMax)), y: AIM.y };
  }
  const aimPixel = (aim) => [Math.round(aim.x / AIM.view), Math.round(aim.y / AIM.view)];

  /* ---------- the state and the scene format ---------- */
  /* What scene.js's complete() takes: boxes that are empty are left out (so they are filled in), anything else is passed as typed (a word becomes NaN, which the checks report). */
  function toInput(state) {
    const input = { blocks: state.blocks.map((b) => [b.x, b.y, b.hp]), pickups: state.pickups.map((p) => [p.x, p.y]) };
    for (const k of NUMBERS) { if (k === "pickupTimer" && state.pickups.length) continue; const raw = String(state.numbers[k]).trim(); if (raw !== "") input[k] = Number(raw); }      // with a pickup on the board the timer is set for you (8 or more), so a number in its box is left out
    if (state.name && state.name.trim()) input.name = state.name.trim();
    return input;
  }
  function fromScene(scene) {
    const s = blank(); if (scene.name) s.name = String(scene.name);
    for (const k of NUMBERS) if (scene[k] !== undefined && scene[k] !== null) s.numbers[k] = String(scene[k]);
    s.blocks = (scene.blocks || []).map((b) => { const a = Array.isArray(b) ? b.slice(-3) : [b.x, b.y, b.hp]; return { x: a[0], y: a[1], hp: a[2] }; });
    s.pickups = (scene.pickups || []).map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y }));
    return s;
  }
  /* Which blocks and pickups are in trouble (to draw them red): outside the field, overlapping something, or with a health that is not a whole number from 1 up. L is scene.js's LIMITS. */
  function trouble(state, L) {
    const bad = { blocks: state.blocks.map(() => false), pickups: state.pickups.map(() => false) };
    const inside = (t) => Number.isFinite(t.x) && Number.isFinite(t.y) && t.x >= L.xMin && t.x <= L.xMax && t.y >= L.yMin && t.y <= L.yMax;
    state.blocks.forEach((b, i) => { if (!inside(b) || !Number.isInteger(b.hp) || b.hp < 1) bad.blocks[i] = true; });
    state.pickups.forEach((p, i) => { if (!inside(p)) bad.pickups[i] = true; });
    const all = state.blocks.map((b, i) => ({ k: "blocks", i, x: b.x, y: b.y })).concat(state.pickups.map((p, i) => ({ k: "pickups", i, x: p.x, y: p.y })));
    for (let a = 0; a < all.length; a++) for (let c = a + 1; c < all.length; c++) if (Math.hypot(all[a].x - all[c].x, all[a].y - all[c].y) < L.gap) { bad[all[a].k][all[a].i] = true; bad[all[c].k][all[c].i] = true; }
    return bad;
  }

  /* ---------- undo and redo ---------- */
  function history(initial, limit) {
    const max = limit || 100; let past = [], future = [], now = JSON.stringify(initial);
    return {
      push(state) { const s = JSON.stringify(state); if (s === now) return false; past.push(now); if (past.length > max) past.shift(); now = s; future = []; return true; },
      undo() { if (!past.length) return null; future.push(now); now = past.pop(); return JSON.parse(now); },
      redo() { if (!future.length) return null; past.push(now); now = future.pop(); return JSON.parse(now); },
      canUndo: () => past.length > 0, canRedo: () => future.length > 0,
    };
  }

  /* ---------- the share link: the whole puzzle as text that fits in a URL ---------- */
  const toBase64 = (text) => { const bytes = new TextEncoder().encode(text); let bin = ""; for (const b of bytes) bin += String.fromCharCode(b); return (typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  const fromBase64 = (text) => { const b64 = text.replace(/-/g, "+").replace(/_/g, "/"), bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary"); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); };
  function encode(state) {
    const numbers = {}; for (const k of NUMBERS) if (String(state.numbers[k]).trim() !== "") numbers[k] = String(state.numbers[k]).trim();
    const compact = { v: 1, b: state.blocks.map((b) => [b.x, b.y, b.hp]) }; if (state.name) compact.n = state.name; if (Object.keys(numbers).length) compact.num = numbers;
    if (state.pickups.length) compact.p = state.pickups.map((p) => [p.x, p.y]); if (state.aim) compact.a = [state.aim.x, state.aim.y];
    return toBase64(JSON.stringify(compact));
  }
  /* Returns a state, or throws an Error whose message says what is wrong with the link. */
  function decode(text) {
    let c; try { c = JSON.parse(fromBase64(String(text).trim())); } catch (e) { throw new Error("That link is not a puzzle (it could not be read)."); }
    const pair = (a) => Array.isArray(a) && a.length === 2 && a.every((v) => typeof v === "number"), triple = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => typeof v === "number");
    if (!c || c.v !== 1 || !Array.isArray(c.b) || !c.b.every(triple) || (c.p !== undefined && !(Array.isArray(c.p) && c.p.every(pair)))) throw new Error("That link is not a puzzle this page understands.");
    const s = blank(); s.blocks = c.b.map(([x, y, hp]) => ({ x, y, hp })); if (c.p) s.pickups = c.p.map(([x, y]) => ({ x, y })); if (typeof c.n === "string") s.name = c.n.slice(0, 80);
    if (c.num && typeof c.num === "object") for (const k of NUMBERS) if (c.num[k] !== undefined) s.numbers[k] = String(c.num[k]);
    if (c.a !== undefined) { if (!pair(c.a)) throw new Error("That link is not a puzzle this page understands."); s.aim = { x: c.a[0], y: c.a[1] }; }
    return s;
  }

  const api = { FIELD, LAUNCHER, SIZE, ROW, SPAWN_Y, LOSS_Y, AIM, NUMBERS, blank, copy, snap, place, rowOf, pickupRowOf, shotsLeft, aimFrom, aimPixel, toInput, fromScene, trouble, history, encode, decode };
  root.NNEditorCore = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
