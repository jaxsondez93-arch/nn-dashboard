/* "Build a puzzle": type in a scene (blocks with health, a ball count, a score) and the real game is made to build exactly that board and, if you ask, the bot plays on from it.
   Two parts. The first (validate / parse) is pure, so it is tested without a page. The second talks to the game through the same runtime object driver.js already reads, in reverse.

   What the game needs for a built board to play like a real one (found by experiment, each step confirmed by "predicted damage = actual damage"):
     - the ball count is three variables that move together, ballStart / ballEnd / TotalBall; the launch loop uses ballStart..ballEnd, so setting only TotalBall launches one ball;
     - every block needs an id (slot 1 of its variables), a health mirror (slot 2) and a companion label object pinned to it; hits are processed through the label;
     - new objects only exist from the next game tick, so the board is read back and compared with the scene before anything is allowed to look at it. */
(function (root) {
  "use strict";
  const LIMITS = { xMin: 60, xMax: 660, yMin: 150, yMax: 1270, gap: 115, maxBlocks: 40, maxBalls: 1000, maxHp: 99999, maxScore: 1e9 };
  const isInt = (v) => Number.isInteger(v), num = (v) => typeof v === "number" && Number.isFinite(v);

  /* Check a scene and put it in the one shape the rest uses. Returns { scene } or { errors: [text, ...] } - every problem at once, in plain words. */
  function validate(input) {
    const errors = [], L = LIMITS;
    if (!input || typeof input !== "object" || Array.isArray(input)) return { errors: ["The scene must be an object like { \"balls\": 12, \"score\": 0, \"blocks\": [[150, 420, 30]] }."] };
    const balls = input.balls === undefined ? 1 : input.balls, score = input.score === undefined ? 0 : input.score;
    if (!isInt(balls) || balls < 1 || balls > L.maxBalls) errors.push(`balls must be a whole number from 1 to ${L.maxBalls}.`);
    if (!isInt(score) || score < 0 || score > L.maxScore) errors.push("score must be a whole number, 0 or more.");
    if (!Array.isArray(input.blocks) || input.blocks.length < 1) errors.push("blocks must be a list with at least one block, each written [x, y, health].");
    else if (input.blocks.length > L.maxBlocks) errors.push(`at most ${L.maxBlocks} blocks.`);
    const blocks = [];
    if (Array.isArray(input.blocks) && input.blocks.length <= L.maxBlocks) input.blocks.forEach((b, i) => {
      const n = i + 1; let x, y, hp;
      if (Array.isArray(b) && b.length === 3) [x, y, hp] = b; else if (Array.isArray(b) && b.length === 4) [, x, y, hp] = b; else if (b && typeof b === "object" && !Array.isArray(b)) ({ x, y, hp } = b);
      else { errors.push(`block ${n}: write it as [x, y, health].`); return; }
      if (!num(x) || x < L.xMin || x > L.xMax) errors.push(`block ${n}: x must be a number from ${L.xMin} (left) to ${L.xMax} (right).`);
      if (!num(y) || y < L.yMin || y > L.yMax) errors.push(`block ${n}: y must be a number from ${L.yMin} (near the top, the danger end) to ${L.yMax} (the bottom).`);
      if (!isInt(hp) || hp < 1 || hp > L.maxHp) errors.push(`block ${n}: health must be a whole number from 1 to ${L.maxHp}.`);
      blocks.push([n, x, y, hp]);
    });
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      if (![blocks[i][1], blocks[i][2], blocks[j][1], blocks[j][2]].every(num)) continue;
      const d = Math.hypot(blocks[i][1] - blocks[j][1], blocks[i][2] - blocks[j][2]); if (d < L.gap) errors.push(`blocks ${i + 1} and ${j + 1} overlap (their centres are ${Math.round(d)} apart; keep them at least ${L.gap} apart).`);
    }
    if (input.pickups !== undefined && !(Array.isArray(input.pickups) && input.pickups.length === 0)) errors.push("pickups are not supported yet; leave the list out or empty.");
    if (errors.length) return { errors };
    const scene = { score, balls, blocks, pickups: [] };
    if (input.turn !== undefined) { if (!isInt(input.turn) || input.turn < 1) return { errors: ["turn must be a whole number, 1 or more."] }; scene.turn = input.turn; }
    if (input.name !== undefined) scene.name = String(input.name).slice(0, 80);
    return { scene };
  }
  function parse(text) {
    let value; try { value = JSON.parse(text); } catch (e) { return { errors: [`That is not valid JSON (${e.message}).`] }; }
    return validate(value);
  }
  const EXAMPLE_TEXT = `{
 "name": "Example puzzle: five blocks, twelve balls",
 "score": 0,
 "balls": 12,
 "blocks": [
  [150, 420, 30],
  [480, 420, 30],
  [320, 640, 60],
  [120, 860, 45],
  [520, 860, 45]
 ]
}`, EXAMPLE = JSON.parse(EXAMPLE_TEXT);
  const api = { validate, parse, LIMITS, EXAMPLE, EXAMPLE_TEXT };
  root.NNScene = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof document === "undefined") return;

  /* ---------- the part that touches the game ---------- */
  const $ = (id) => document.getElementById(id), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const runtime = () => { try { return $("game").contentWindow.cr_getC2Runtime(); } catch (e) { return null; } };
  const layout = () => { const r = runtime(); return r && r.running_layout ? r.running_layout.name : null; };
  const readBoard = () => { const r = runtime(), t = r.types_by_index, g = {}; for (const v of r.all_global_vars) g[v.name] = v.data;
    return { blocks: t[11].instances.map((b) => [Math.round(b.x), Math.round(b.y), b.instance_vars[0], b.instance_vars[2]]).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]), labels: t[20].instances.filter((l) => l.instance_vars[0] !== 0).length, balls: [g.TotalBall, g.ballStart, g.ballEnd], score: g.score }; };

  /* Press Play ourselves (the bot's Start button would begin choosing shots at once), then wait for the opening board to stop changing. */
  async function enterGame() {
    const t0 = Date.now();
    while (layout() !== "Game") { if (Date.now() - t0 > 30000) throw new Error("the game screen never appeared"); await window.tapAt(240, 526, 40); await sleep(300); }
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
    const spawnHp = scene.turn !== undefined ? Math.floor((scene.turn - 1) / 3) + 2 : 1 + Math.max(...scene.blocks.map((b) => b[3]));
    set("score", scene.score); set("TotalBall", scene.balls); set("ballStart", scene.balls); set("ballEnd", scene.balls); set("num", id); set("hp", spawnHp); set("color", spawnHp); set("power", Math.max(3, scene.balls));
  }
  /* Build the scene (the bot must not be running) and wait until what is in the game is exactly the scene. Throws, in words, if it never is. */
  async function build(scene) {
    if ($("start").disabled) throw new Error("the bot is running; press Pause first");
    await enterGame(); inject(scene);
    const want = scene.blocks.map(([, x, y, hp]) => [x, y, hp, hp]), t0 = Date.now();
    // every wanted block is in the game within a pixel of where it was put (the game round-trips positions through its physics, so 934.5 can come back as 934.4999), same health, nothing extra
    const sameBoard = (got) => { const left = got.slice(); for (const w of want) { const k = left.findIndex((g) => Math.abs(g[0] - w[0]) <= 1 && Math.abs(g[1] - w[1]) <= 1 && g[2] === w[2] && g[3] === w[3]); if (k < 0) return false; left.splice(k, 1); } return left.length === 0; };
    for (;;) {
      const got = readBoard(); if (sameBoard(got.blocks) && got.labels === want.length && got.balls.every((v) => v === scene.balls) && got.score === scene.score) return got;
      if (Date.now() - t0 > 10000) throw new Error("the board did not settle into the scene");
      await sleep(100);
    }
  }
  api.build = build;

  const text = $("scene-text"); if (!text) return;
  const status = $("scene-status"), buttons = ["scene-example", "scene-build", "scene-build-start"].map($);
  const say = (s, bad) => { status.textContent = s; status.style.color = bad ? "#ff8a8a" : ""; };
  text.value = EXAMPLE_TEXT;
  $("scene-example").onclick = () => { text.value = EXAMPLE_TEXT; say("Example loaded. Change anything you like."); };
  async function go(startBot) {
    const res = parse(text.value); if (res.errors) { say(res.errors.join(" "), true); return; }
    buttons.forEach((b) => { b.disabled = true; }); say("Building: opening the game screen, then placing the blocks...");
    try {
      const s = res.scene, got = await build(s);
      say(`Built and checked: ${got.blocks.length} blocks, ${s.balls} ball${s.balls === 1 ? "" : "s"}, score ${s.score}. ${startBot ? "Starting the bot..." : "The bot is paused. Press Start to let it play from here."}`);
      if (startBot) $("start").click();
    } catch (e) { say(`Could not build it: ${e.message}.`, true); }
    finally { buttons.forEach((b) => { b.disabled = false; }); }
  }
  $("scene-build").onclick = () => go(false); $("scene-build-start").onclick = () => go(true);
})(typeof self !== "undefined" ? self : globalThis);
