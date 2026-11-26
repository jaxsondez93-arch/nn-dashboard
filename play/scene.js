/* "Build a puzzle": describe a scene (blocks with health, a ball count, a score) and the real game is made to build exactly that board; the bot can then play on from it.
   Leave things out and they are filled in the way a real game would have them (see complete()). The first part is pure, so it is tested without a page; the second talks to the game
   through the same runtime object driver.js already reads, in reverse.

   What the game needs for a built board to play like a real one (read from the game's own rules and confirmed by "predicted damage = actual damage"; see docs/GAME_RULES.md):
     - the ball count is three variables that move together, ballStart / ballEnd / TotalBall; the launch loop uses ballStart..ballEnd, so setting only TotalBall launches one ball;
     - every block has an id (slot 1 of its variables), a health mirror (slot 2) and a companion label object pinned to it. A hit only takes health off a block, and a destroyed block
       only adds to the score, when a label with the block's id exists;
     - new objects only exist from the next game tick, so the board is read back and compared with the scene before anything is allowed to look at it. */
(function (root) {
  "use strict";
  // The game accepts a block anywhere in the play field; its own rows keep to the ranges below. Two blocks of one row can sit as close as 100 apart (a row of two: 260 and 360), so that is the least allowed.
  const LIMITS = { xMin: 60, xMax: 660, yMin: 150, yMax: 1270, gap: 100, maxBlocks: 40, maxBalls: 1000, maxHealth: 99999 };            // no limit on the score: it only has to be a whole number, 0 or more
  const isInt = (v) => Number.isInteger(v), num = (v) => typeof v === "number" && Number.isFinite(v), empty = (v) => v === undefined || v === null || v === "";

  /* ---------- what the game's own rules say (read from its event sheet) ---------- */
  const RULES = {
    blocksPerTurn: 13 / 7,                          // 6 turns in 7 add 1, 2 or 3 blocks (equally likely, so 2 on average); the 7th is a pickup row with 1 block: (6*2 + 1) / 7
    healthEvery: 3,                                 // the health of new blocks goes up by one every 3 turns: 1 + floor(turn / 3)
    rise: 126,                                      // every block moves up one row (126) each turn
    // where a new block goes: uniform inside these ranges. Rows of three sit at y = 1210, every other row at 1200.
    rows: { 1: { y: 1200, x: [[120, 600]] }, 2: { y: 1200, x: [[120, 260], [360, 600]] }, 3: { y: 1210, x: [[65, 217], [340, 400], [510, 657]] } },
    pickupRow: { y: 1200, blockSides: [[340, 600], [120, 240]] },     // a pickup row holds one block, on the right or the left (the pickup takes the other side)
    opening: [[570, 1032], [83, 963], [236, 753], [502, 792], [627, 588], [628, 718]],     // the fixed opening board (every block has health 1)
  };

  /* ---------- turning "how far into a game" into the numbers a game of that age has ---------- */
  // Each number you enter says how far into a game you are (a turn). The turn used for everything left empty is the average of those.
  const turnFrom = {
    turn: (v) => v,
    score: (v, f) => (v - f.score_intercept) / f.score_slope,             // score = blocks destroyed = 13/7 a turn, less the blocks still on the board
    balls: (v, f) => f.ball_start_turn + f.ball_period * (v - 1),         // 1 + (turn - start) / turns per extra ball
    health: (v) => RULES.healthEvery * (v - 1) + 1,                       // health = 1 + floor(turn / 3): the middle of the 3 turns that share it
  };
  const valueAt = {
    turn: (T) => Math.max(1, Math.round(T)),
    score: (T, f) => Math.max(0, Math.round(f.score_slope * T + f.score_intercept)),
    balls: (T, f) => Math.max(1, Math.round(1 + Math.max(0, T - f.ball_start_turn) / f.ball_period)),
    health: (T) => 1 + Math.floor(Math.max(1, Math.round(T)) / RULES.healthEvery),
  };

  function hashSeed(value) { const s = JSON.stringify(value); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const between = (rng, [lo, hi]) => Math.round((lo + (hi - lo) * rng()) * 10) / 10;
  const interpolate = (points, values, u) => { for (let i = 1; i < points.length; i++) if (u <= points[i]) return values[i - 1] + ((u - points[i - 1]) / (points[i] - points[i - 1])) * (values[i] - values[i - 1]); return values[values.length - 1]; };

  /* The row that appears after a turn, the way the rules make it: a pickup row (one block) about once in "ball_period" turns, otherwise 1, 2 or 3 blocks equally likely. */
  function newRow(rng, pickupShare) {
    if (rng() < pickupShare) { const side = RULES.pickupRow.blockSides[rng() < 0.5 ? 0 : 1]; return [{ x: between(rng, side), y: RULES.pickupRow.y }]; }
    const shape = RULES.rows[1 + Math.floor(rng() * 3)]; return shape.x.map((range) => ({ x: between(rng, range), y: shape.y }));
  }
  /* A typical board for a game that has reached turn T, with the newest blocks at health "level": the rows that have appeared in the last few turns (their places from the rules),
     thinned and worn down the way the bot's play thins and wears them (measured: share still alive and share of health left, by how many turns old the row is). */
  function typicalBoard(T, level, data, rng) {
    if (T <= 1) return RULES.opening.map(([x, y]) => [0, x, y, level]);
    const board = data.board, pickupShare = 1 / data.fit.ball_period, out = [];
    for (let age = 0; age <= Math.min(board.max_age, T - 2); age++) {
      const spawnHealth = Math.max(1, level - (Math.floor(T / RULES.healthEvery) - Math.floor((T - age) / RULES.healthEvery))), alive = age === 0 ? 1 : Math.min(1, board.alive_per_row[age] / RULES.blocksPerTurn);
      for (const b of newRow(rng, pickupShare)) {
        if (rng() > alive) continue;
        const left = age === 0 ? 1 : interpolate(board.quantile_points, board.health_left[age], rng());
        out.push([0, b.x, b.y - RULES.rise * age, Math.max(1, Math.round(spawnHealth * left))]);
      }
    }
    return out;
  }

  /* Check a scene and put it in the one shape the rest uses. Returns { scene } or { errors: [text, ...] } - every problem at once, in plain words. */
  function validate(input) {
    const errors = [], L = LIMITS;
    if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["The scene must be an object like { \"score\": 38 } or { \"balls\": 12, \"blocks\": [[150, 420, 30]] }."] };
    const balls = empty(input.balls) ? 1 : input.balls, score = empty(input.score) ? 0 : input.score;
    if (!isInt(balls) || balls < 1 || balls > L.maxBalls) errors.push(`balls must be a whole number from 1 to ${L.maxBalls}.`);
    if (!isInt(score) || score < 0) errors.push("score must be a whole number, 0 or more.");
    if (!empty(input.health) && (!isInt(input.health) || input.health < 1 || input.health > L.maxHealth)) errors.push(`health must be a whole number from 1 to ${L.maxHealth}.`);
    if (!empty(input.turn) && (!isInt(input.turn) || input.turn < 1)) errors.push("turn must be a whole number, 1 or more.");
    if (!empty(input.seed) && !isInt(input.seed)) errors.push("seed must be a whole number.");
    if (!Array.isArray(input.blocks) || input.blocks.length < 1) errors.push("blocks must be a list with at least one block, each written [x, y, health].");
    else if (input.blocks.length > L.maxBlocks) errors.push(`at most ${L.maxBlocks} blocks.`);
    const blocks = [];
    if (Array.isArray(input.blocks) && input.blocks.length <= L.maxBlocks) input.blocks.forEach((b, i) => {
      const n = i + 1; let x, y, hp;
      if (Array.isArray(b) && b.length === 3) [x, y, hp] = b; else if (Array.isArray(b) && b.length === 4) [, x, y, hp] = b; else if (b && typeof b === "object" && !Array.isArray(b)) ({ x, y, hp } = b);
      else { errors.push(`block ${n}: write it as [x, y, health].`); return; }
      if (!num(x) || x < L.xMin || x > L.xMax) errors.push(`block ${n}: x must be a number from ${L.xMin} (left) to ${L.xMax} (right).`);
      if (!num(y) || y < L.yMin || y > L.yMax) errors.push(`block ${n}: y must be a number from ${L.yMin} (near the top, the danger end) to ${L.yMax} (the bottom).`);
      if (!isInt(hp) || hp < 1 || hp > L.maxHealth) errors.push(`block ${n}: health must be a whole number from 1 to ${L.maxHealth}.`);
      blocks.push([n, x, y, hp]);
    });
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      if (![blocks[i][1], blocks[i][2], blocks[j][1], blocks[j][2]].every(num)) continue;
      const d = Math.hypot(blocks[i][1] - blocks[j][1], blocks[i][2] - blocks[j][2]); if (d < L.gap) errors.push(`blocks ${i + 1} and ${j + 1} overlap (their centres are ${Math.round(d)} apart; keep them at least ${L.gap} apart).`);
    }
    if (!empty(input.pickups) && !(Array.isArray(input.pickups) && input.pickups.length === 0)) errors.push("pickups are not supported yet; leave the list out or empty.");
    if (errors.length) return { errors };
    const scene = { score, balls, blocks, pickups: [] };
    for (const key of ["turn", "health", "seed"]) if (!empty(input[key])) scene[key] = input[key];
    if (!empty(input.name)) scene.name = String(input.name).slice(0, 80);
    return { scene };
  }

  /* Fill in whatever was left empty, and change nothing that was entered. Every number entered (turn, score, balls, health) says how far into a game it is; the empty ones take the average of those.
     If no number was entered at all, the strongest block's health stands in for one. With one number that is that number's own estimate. Returns { scene, filled, kept, turn, estimates } or { errors }.
     "data" is web/play/progression.json (measured from real games by tools/fit_progression.py); without it only a scene that already has its blocks can be checked. */
  function complete(input, data) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return validate(input);
    const entered = {}; for (const key of ["turn", "score", "balls", "health", "blocks", "seed", "name", "pickups"]) if (!empty(input[key])) entered[key] = input[key];
    const problems = [];                                                                                      // a wrong kind of value is reported as it is, never "fixed"
    for (const key of ["turn", "score", "balls", "health"]) if (key in entered && !(isInt(entered[key]) && entered[key] >= (key === "score" ? 0 : 1))) problems.push(`${key} must be a whole number, ${key === "score" ? "0" : "1"} or more.`);
    if (problems.length) return { errors: problems };
    const f = data && data.fit;
    if (!f) return entered.blocks ? validate(input) : { errors: ["The numbers a real game has are still loading; try again in a moment."] };
    const estimates = [];
    for (const key of ["turn", "score", "balls", "health"]) if (key in entered) estimates.push({ field: key, turn: turnFrom[key](entered[key], f) });
    const healths = Array.isArray(entered.blocks) ? entered.blocks.map((b) => (Array.isArray(b) ? b[b.length - 1] : b && b.hp)).filter(isInt) : [];
    if (healths.length && !estimates.length) estimates.push({ field: "the strongest block", turn: turnFrom.health(Math.max(...healths)) });      // only when no number was entered: a number you typed decides, blocks do not dilute it
    if (!estimates.length) return entered.blocks ? validate(input) : { errors: ["Give at least one of score, balls, health or turn (or a list of blocks) and the rest is filled in for you."] };
    const T = Math.max(1, estimates.reduce((s, e) => s + e.turn, 0) / estimates.length), filled = [], scene = {};
    const take = (key, make, why) => { if (key in entered) scene[key] = entered[key]; else { scene[key] = make(); filled.push({ field: key, value: scene[key], why }); } };
    take("turn", () => valueAt.turn(T), "the average turn of what you entered");
    take("score", () => valueAt.score(T, f), "a real game's score at that turn");
    const ballsAtT = valueAt.balls(T, f), healthAtT = valueAt.health(T);                                        // a very high score points to a very late game: more balls and health than can be built
    take("balls", () => Math.min(LIMITS.maxBalls, ballsAtT), ballsAtT > LIMITS.maxBalls ? `a real game that far in would have ${ballsAtT} balls; the most built is ${LIMITS.maxBalls}` : "a real game's ball count at that turn");
    take("health", () => Math.min(LIMITS.maxHealth, healthAtT), healthAtT > LIMITS.maxHealth ? `a real game that far in would have health ${healthAtT}; the most built is ${LIMITS.maxHealth}` : "the health of new blocks at that turn: 1 + turn / 3");
    for (const x of filled) if ((x.field === "balls" && ballsAtT > LIMITS.maxBalls) || (x.field === "health" && healthAtT > LIMITS.maxHealth)) x.limited = true;
    if (entered.blocks) scene.blocks = entered.blocks;
    else {
      const seed = "seed" in entered ? entered.seed : hashSeed({ turn: entered.turn, score: entered.score, balls: entered.balls, health: entered.health });
      scene.blocks = typicalBoard(scene.turn, scene.health, data, mulberry32(seed)).sort((a, b) => b[2] - a[2] || a[1] - b[1]).map((b, i) => [i + 1, b[1], b[2], b[3]]); scene.seed = seed;
      filled.push({ field: "blocks", value: `${scene.blocks.length} blocks`, why: `a typical board at turn ${scene.turn} (layout ${seed})` });
    }
    if ("name" in entered) scene.name = entered.name; if ("pickups" in entered) scene.pickups = entered.pickups;
    const checked = validate(scene); if (checked.errors) return checked;
    return { scene: checked.scene, filled, kept: Object.keys(entered).filter((k) => k !== "seed" && k !== "name"), turn: T, estimates };
  }
  function parse(text, data) {
    let value; try { value = JSON.parse(text); } catch (e) { return { errors: [`That is not valid JSON (${e.message}).`] }; }
    return complete(value, data);
  }
  /* The scene as text: one block to a line. */
  function pretty(scene) {
    const head = ["name", "score", "balls", "health", "turn", "seed"].filter((k) => scene[k] !== undefined).map((k) => ` ${JSON.stringify(k)}: ${JSON.stringify(scene[k])}`);
    const lines = head.concat([` "blocks": [\n${scene.blocks.map((b) => `  [${b.join(", ")}]`).join(",\n")}\n ]`]); if (scene.pickups && scene.pickups.length) lines.push(` "pickups": ${JSON.stringify(scene.pickups)}`);
    return `{\n${lines.join(",\n")}\n}`;
  }
  const EXAMPLE_TEXT = `{
 "name": "Example puzzle: five blocks, twelve balls",
 "balls": 12,
 "blocks": [
  [150, 420, 30],
  [480, 420, 30],
  [320, 640, 60],
  [120, 860, 45],
  [520, 860, 45]
 ]
}`, EXAMPLE = JSON.parse(EXAMPLE_TEXT);
  const api = { validate, complete, parse, pretty, typicalBoard, LIMITS, RULES, EXAMPLE, EXAMPLE_TEXT };
  root.NNScene = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  /* ---------- the part that touches the game ---------- */
  const $ = (id) => document.getElementById(id), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runtime = () => { try { return $("game").contentWindow.cr_getC2Runtime(); } catch (e) { return null; } };
  const layout = () => { const r = runtime(); return r && r.running_layout ? r.running_layout.name : null; };
  const readBoard = () => { const r = runtime(), t = r.types_by_index, g = {}; for (const v of r.all_global_vars) g[v.name] = v.data;
    return { blocks: t[11].instances.map((b) => [Math.round(b.x), Math.round(b.y), b.instance_vars[0], b.instance_vars[2]]), labels: t[20].instances.filter((l) => l.instance_vars[0] !== 0).length, balls: [g.TotalBall, g.ballStart, g.ballEnd], score: g.score }; };

  /* A tap on the game, the same way driver.js sends one (the watch page has the driver; a page without a bot, such as check.html, uses this). */
  function fire(kind, x, y) {
    const w = $("game").contentWindow, d = w.document, el = d.getElementById("c2canvas") || d.body, down = kind === "down";
    const base = { bubbles: true, cancelable: true, clientX: x, clientY: y, screenX: x, screenY: y, view: w };
    const names = { move: ["pointermove", "mousemove"], down: ["pointerdown", "mousedown"], up: ["pointerup", "mouseup"] }[kind];
    el.dispatchEvent(new w.PointerEvent(names[0], Object.assign({ pointerId: 1, pointerType: "mouse", isPrimary: true, button: kind === "move" ? -1 : 0, buttons: down ? 1 : 0 }, base)));
    el.dispatchEvent(new w.MouseEvent(names[1], Object.assign({ button: 0, buttons: down ? 1 : 0 }, base)));
  }
  const tap = async (x, y, holdMs) => { if (window.tapAt) return window.tapAt(x, y, holdMs); fire("move", x, y); await sleep(80); fire("down", x, y); await sleep(holdMs || 80); fire("up", x, y); };
  api.tap = tap;

  /* Press Play ourselves (the bot's Start button would begin choosing shots at once), then wait for the opening board to stop changing. */
  async function enterGame() {
    const t0 = Date.now();
    while (layout() !== "Game") { if (Date.now() - t0 > 30000) throw new Error("the game screen never appeared"); await tap(240, 526, 40); await sleep(300); }
    let last = "", since = Date.now(); while (Date.now() - since < 1500) { const now = JSON.stringify(readBoard().blocks); if (now !== last) { last = now; since = Date.now(); } await sleep(150); }
  }
  function inject(scene) {
    const r = runtime(), t = r.types_by_index, layer = (t[11].instances[0] && t[11].instances[0].layer) || r.running_layout.layers[0], gv = {}; for (const v of r.all_global_vars) gv[v.name] = v;
    const set = (name, value) => { if (!gv[name]) throw new Error(`the game has no variable "${name}"`); gv[name].data = value; };
    for (const i of t[11].instances.slice()) r.DestroyInstance(i);                                             // the old blocks, pickups and labels (the one label with id 0 is not a block's)
    for (const i of t[22].instances.slice()) r.DestroyInstance(i);
    for (const i of t[20].instances.slice()) if (i.instance_vars[0] !== 0) r.DestroyInstance(i);
    let id = gv.num ? gv.num.data + 1 : 1;
    for (const [, x, y, hp] of scene.blocks) {
      const b = r.createInstance(t[11], layer, x, y); b.instance_vars[0] = hp; b.instance_vars[1] = id; b.instance_vars[2] = hp;
      const lab = r.createInstance(t[20], layer, x, y); lab.instance_vars[0] = id; lab.text = String(hp); lab.text_changed = true;
      const pin = lab.behavior_insts[0]; pin.pinObject = b; pin.pinObjectUid = -1; pin.pinAngle = 0; pin.pinDist = 0; pin.myStartAngle = 0; pin.theirStartAngle = 0; pin.lastKnownAngle = 0; pin.mode = 1; id++;
    }
    const turn = scene.turn !== undefined ? scene.turn : 1, level = scene.health !== undefined ? scene.health : 1 + Math.floor(turn / RULES.healthEvery);
    set("score", scene.score); set("TotalBall", scene.balls);
    // The game draws its on-screen score only when a block is destroyed, and removing the old blocks above made it count and draw the OLD total (the old board's block count) just before this line.
    // So draw the new score ourselves, or the screen would show the old count until the first block of the new board is destroyed.
    const shown = t[23].instances[0]; if (shown) { shown.text = String(scene.score); shown.text_changed = true; } set("ballStart", scene.balls); set("ballEnd", scene.balls); set("num", id);
    set("hp", level); set("color", level); set("jump", turn % RULES.healthEvery); set("power", 0);              // the rules: the next row's health is hp; every 3rd turn it goes up; the pickup timer starts again
  }
  // The scoreboard above the game moves only when the bot plays a turn; show the built score and balls at once (the milestone banners and "best on this device" are left alone).
  function scoreboard(scene) { for (const [id, v] of [["hud-score", scene.score], ["hud-balls", scene.balls]]) { const el = $(id); if (el) el.textContent = v.toLocaleString(); } }
  /* Build the scene (the bot must not be running) and wait until what is in the game is exactly the scene. Throws, in words, if it never is. */
  async function build(scene) {
    if ($("start") && $("start").disabled) throw new Error("the bot is running; press Pause first");
    await enterGame(); inject(scene);
    const want = scene.blocks.map(([, x, y, hp]) => [x, y, hp, hp]), t0 = Date.now();
    // every wanted block is in the game within a pixel of where it was put (the game round-trips positions through its physics, so 934.5 can come back as 934.4999), same health, nothing extra
    const sameBoard = (got) => { const left = got.slice(); for (const w of want) { const k = left.findIndex((g) => Math.abs(g[0] - w[0]) <= 1 && Math.abs(g[1] - w[1]) <= 1 && g[2] === w[2] && g[3] === w[3]); if (k < 0) return false; left.splice(k, 1); } return left.length === 0; };
    for (;;) {
      const got = readBoard(); if (sameBoard(got.blocks) && got.labels === want.length && got.balls.every((v) => v === scene.balls) && got.score === scene.score) { scoreboard(scene); return got; }
      if (Date.now() - t0 > 10000) throw new Error("the board did not settle into the scene");
      await sleep(100);
    }
  }
  api.build = build;

  /* ---------- the panel: the number boxes are the inputs, the scene box shows (and lets you edit) the full result ---------- */
  const text = $("scene-text"); if (!text) return;
  const status = $("scene-status"), FIELDS = ["score", "balls", "health", "turn"], box = (k) => $("scene-" + k), buttons = ["scene-fill", "scene-another", "scene-example", "scene-build", "scene-build-start"].map($);
  const say = (s, bad) => { status.textContent = s; status.style.color = bad ? "#ff8a8a" : ""; };
  let data = null, layoutSeed = null; const loaded = fetch("progression.json").then((r) => r.json()).then((d) => { data = d; api.data = d; }).catch(() => {});
  // an empty box is left out, so it is filled in; anything typed that is not a whole number is reported, not changed
  function fromBoxes() {
    const partial = {}, errors = [];
    for (const k of FIELDS) { const raw = box(k).value.trim(); if (raw === "") continue; const v = Number(raw); if (!Number.isInteger(v)) errors.push(`${k} must be a whole number (or left empty).`); else partial[k] = v; }
    return { partial, errors };
  }
  /* What to complete: the number boxes if any has something in it, otherwise whatever (partial) scene is in the scene box. */
  function source() {
    const { partial, errors } = fromBoxes(); if (errors.length) throw new Error(errors.join(" "));
    if (Object.keys(partial).length) return { input: partial, fromBoxes: true };
    const raw = text.value.trim(); if (!raw) throw new Error("Type at least one number in the boxes above, or load the example.");
    let v; try { v = JSON.parse(raw); } catch (e) { throw new Error(`The scene box is not valid JSON (${e.message}).`); } return { input: v, fromBoxes: false };
  }
  const clearBoxes = () => FIELDS.forEach((k) => { box(k).value = ""; });                 // their numbers now live in the scene box
  function explain(r) {
    const kept = r.kept.length ? `Kept exactly as you entered: ${r.kept.join(", ")}.` : "";
    const round = (x) => Math.round(x);
    const how = r.estimates.length > 1 ? ` Your numbers point to turns ${r.estimates.map((e) => `${round(e.turn)} (${e.field})`).join(", ")}, so the empty ones use their average, turn ${round(r.turn)}.` : ` That points to about turn ${round(r.turn)} of a real game.`;
    return kept + how + (r.filled.length ? ` Filled in: ${r.filled.map((x) => (x.field === "blocks" ? x.value : `${x.field} ${x.value}${x.limited ? " (the most the page builds)" : ""}`)).join(", ")}.` : "");
  }
  async function fill(another) {
    await loaded;
    try {
      const { input: base, fromBoxes: typed } = source(), input = Object.assign({}, base); if (another) { delete input.blocks; input.seed = (layoutSeed === null ? 0 : layoutSeed) + 1; }
      const r = complete(input, data); if (r.errors) throw new Error(r.errors.join(" "));
      text.value = pretty(r.scene); if (typed) clearBoxes(); layoutSeed = r.scene.seed === undefined ? null : r.scene.seed; say(explain(r));
    } catch (e) { say(e.message, true); }
  }
  $("scene-fill").onclick = () => { layoutSeed = null; fill(false); }; $("scene-another").onclick = () => fill(true);
  $("scene-example").onclick = () => { text.value = EXAMPLE_TEXT; say("Example loaded. It has no score written in it, so the score is filled in to match the balls; change the balls and the score follows."); };
  async function go(startBot) {
    buttons.forEach((b) => { b.disabled = true; });
    try {
      await loaded; let scene;
      const typed = Object.keys(fromBoxes().partial).length > 0;                       // numbers typed in the boxes win over whatever is in the scene box
      if (typed || text.value.trim() === "") { const r = complete(source().input, data); if (r.errors) throw new Error(r.errors.join(" ")); scene = r.scene; text.value = pretty(scene); clearBoxes(); }
      else { const r = parse(text.value, data); if (r.errors) throw new Error(r.errors.join(" ")); scene = r.scene; if (r.filled && r.filled.length) text.value = pretty(scene); }      // a partial scene: show the whole one that is being built
      say("Building: opening the game screen, then placing the blocks...");
      const got = await build(scene);
      say(`Built and checked: ${got.blocks.length} blocks, ${scene.balls} ball${scene.balls === 1 ? "" : "s"}, score ${scene.score}. ${startBot ? "Starting the bot..." : "The bot is paused. Press Start to let it play from here."}`);
      if (startBot) $("start").click();
    } catch (e) { say(`Could not build it: ${e.message}`, true); }
    finally { buttons.forEach((b) => { b.disabled = false; }); }
  }
  $("scene-build").onclick = () => go(false); $("scene-build-start").onclick = () => go(true);
})(typeof self !== "undefined" ? self : globalThis);
