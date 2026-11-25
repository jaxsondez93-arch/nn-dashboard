/* The "How accurate are the predictions?" panel: tiles, charts, a table and the formulas, from the turns of this session or from a saved log file. The maths is in stats.js. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id), S = window.NNStats, NS = "http://www.w3.org/2000/svg";
  let session = [], loaded = null, timer = 0;
  const el = (tag, attrs, text) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (text !== undefined) e.textContent = text; return e; };
  const html = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const pct = (x) => `${(100 * x).toFixed(x > 0 && x < 0.1 ? 1 : 0)}%`, num = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : x.toFixed(d)), signed = (x, d = 2) => (x > 0 ? "+" : "") + num(x, d);
  const step = (span) => { const raw = span / 4, m = 10 ** Math.floor(Math.log10(raw || 1)); return [1, 2, 5, 10].map((k) => k * m).find((v) => v >= raw) || m * 10; };
  /* One chart: sets up axes and returns the scales. Every mark added with hit() shows its value under the chart on hover or tap. */
  function frame(id, { x0, x1, y0, y1, xlabel, yfmt = (v) => num(v, 0) }) {
    const box = $(id), svg = box.querySelector("svg"), read = box.querySelector(".readline"), W = 600, H = 250, L = 52, R = 12, T = 10, B = 38; svg.replaceChildren(); read.textContent = "Hover or tap a mark for its value.";
    if (x1 <= x0) x1 = x0 + 1; if (y1 <= y0) y1 = y0 + 1;
    const X = (v) => L + (v - x0) / (x1 - x0) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
    const ys = step(y1 - y0); for (let v = Math.ceil(y0 / ys) * ys; v <= y1 + 1e-9; v += ys) svg.append(el("line", { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: "grid" }), el("text", { x: L - 7, y: Y(v) + 4, "text-anchor": "end", class: "tick" }, yfmt(v)));
    const xs = step(x1 - x0); for (let v = Math.ceil(x0 / xs) * xs; v <= x1 + 1e-9; v += xs) svg.append(el("text", { x: X(v), y: H - B + 16, "text-anchor": "middle", class: "tick" }, num(v, xs < 1 ? 1 : 0)));
    svg.append(el("text", { x: (L + W - R) / 2, y: H - 4, "text-anchor": "middle", class: "tick" }, xlabel));
    const hit = (mark, text) => { const show = () => { read.textContent = text; }; mark.addEventListener("pointerenter", show); mark.addEventListener("click", show); svg.append(mark); };
    return { svg, X, Y, hit };
  }
  const path = (f, pts, cls) => f.svg.append(el("polyline", { points: pts.map(([x, y]) => `${f.X(x)},${f.Y(y)}`).join(" "), class: cls }));
  const empty = (id, why) => { const box = $(id); box.querySelector("svg").replaceChildren(el("text", { x: 300, y: 125, "text-anchor": "middle", class: "tick" }, why)); box.querySelector(".readline").textContent = ""; };
  function tile(label, value, note) { const d = html("div", undefined, "tile"); d.append(html("span", label, "k"), html("strong", value), html("span", note, "s")); return d; }
  function table(id, head, rows) { const t = $(id); t.replaceChildren(); const h = html("tr"); head.forEach((c) => h.append(html("th", c))); t.append(h); rows.forEach((r) => { const tr = html("tr"); r.forEach((c) => tr.append(html("td", c))); t.append(tr); }); }
  function render() {
    const turns = loaded ? loaded.turns : session, rows = S.usable(turns); if (window.NNExplore) setTimeout(() => NNExplore.update(rows), 0); $("an-source").textContent = loaded ? `Showing the file ${loaded.name}` : "Showing this session";
    $("an-empty").hidden = rows.length > 0; $("an-body").hidden = rows.length === 0; if (!rows.length) return;
    const all = S.summary(rows), few = S.summary(rows.filter((t) => t.balls <= 4)), many = S.summary(rows.filter((t) => t.balls >= 5)), bins = S.byBalls(rows), lg = S.logistic(rows), pb = S.perBall(rows), c0 = S.constant(rows), maxBalls = Math.max(...rows.map((t) => t.balls));
    const tiles = $("an-tiles"); tiles.replaceChildren(tile("Exactly right", pct(all.exact.p), `95% range ${pct(all.exact.lo)}–${pct(all.exact.hi)}, ${all.n} turns`), tile("Typical miss", num(all.abs.mean, 1), "points of damage, on average"),
      tile("Bias (actual − predicted)", signed(all.bias.mean, 1), all.bias.half === null ? "" : `± ${num(all.bias.half, 1)}; below 0 means the bot expects too much`), tile("Miss as share of expected", all.relative === null ? "–" : pct(all.relative), `${all.lower} turns fell short, ${all.higher} did better`));
    $("an-verdict").textContent = few && many ? `With 4 balls or fewer the prediction was exactly right ${pct(few.exact.p)} of the time (${few.n} turns); with 5 or more, ${pct(many.exact.p)} (${many.n} turns).` : "A comparison of few and many balls appears once the game has passed 4 balls.";
    /* 1: exact rate against balls, with the two fitted curves */
    let f = frame("ch-acc", { x0: 0, x1: maxBalls + 1, y0: 0, y1: 1, xlabel: "balls", yfmt: pct });
    const curve = (m) => Array.from({ length: 101 }, (_, i) => { const x = 1 + (maxBalls - 1) * i / 100; return [x, m.at(x)]; });
    if (lg) path(f, curve(lg), "l1"); if (pb) path(f, curve(pb), "l2");
    bins.forEach((b) => { f.svg.append(el("line", { x1: f.X(b.balls), x2: f.X(b.balls), y1: f.Y(b.exact.lo), y2: f.Y(b.exact.hi), class: "whisk" })); f.hit(el("circle", { cx: f.X(b.balls), cy: f.Y(b.exact.p), r: 6, class: "obs" }), `${b.label} balls: ${b.exact.k} of ${b.n} exact = ${pct(b.exact.p)} (95% range ${pct(b.exact.lo)}–${pct(b.exact.hi)})`); });
    /* 2: rolling rate over the turns */
    const width = Math.min(20, Math.max(5, Math.floor(rows.length / 4))), roll = S.rolling(rows, width); $("an-width").textContent = width;
    if (roll.length < 2) empty("ch-roll", "needs a few more turns"); else { f = frame("ch-roll", { x0: roll[0].i, x1: roll[roll.length - 1].i, y0: 0, y1: 1, xlabel: "predicted turns so far", yfmt: pct }); path(f, roll.map((r) => [r.i, r.p]), "l1"); roll.forEach((r) => f.hit(el("circle", { cx: f.X(r.i), cy: f.Y(r.p), r: 7, class: "ghost" }), `turns ${r.i - width + 1}–${r.i}: ${pct(r.p)} exact`)); }
    /* 3: predicted against actual */
    const top = Math.max(1, ...rows.map((t) => Math.max(t.predicted, t.damage))); f = frame("ch-scatter", { x0: 0, x1: top, y0: 0, y1: top, xlabel: "predicted damage" }); path(f, [[0, 0], [top, top]], "ref");
    rows.forEach((t, i) => f.hit(el("circle", { cx: f.X(t.predicted), cy: f.Y(t.damage), r: 4, class: "dot" }), `turn ${t.turn || i + 1}, ${t.balls} balls: predicted ${t.predicted}, actual ${t.damage}`));
    /* 4: error against balls */
    const err = rows.map((t) => t.damage - t.predicted), reach = Math.max(1, ...err.map(Math.abs)); f = frame("ch-err", { x0: 0, x1: maxBalls + 1, y0: -reach, y1: reach, xlabel: "balls" }); path(f, [[0, 0], [maxBalls + 1, 0]], "ref");
    rows.forEach((t, i) => f.hit(el("circle", { cx: f.X(t.balls), cy: f.Y(err[i]), r: 4, class: "dot" }), `turn ${t.turn || i + 1}, ${t.balls} balls: actual − predicted = ${signed(err[i], 0)}`));
    bins.forEach((b) => f.hit(el("rect", { x: f.X(b.balls) - 9, y: f.Y(b.bias.mean) - 2.5, width: 18, height: 5, class: "meanmark" }), `${b.label} balls, average: ${signed(b.bias.mean)} (${b.n} turns)`));
    /* 5: thinking time */
    const timed = rows.filter((t) => Number.isFinite(t.think_s)), fit = timed.length > 2 ? S.line(timed.map((t) => t.balls), timed.map((t) => t.think_s)) : null;
    if (timed.length < 3) empty("ch-think", "needs a few more turns"); else { f = frame("ch-think", { x0: 0, x1: maxBalls + 1, y0: 0, y1: Math.max(...timed.map((t) => t.think_s)) * 1.05 || 1, xlabel: "balls", yfmt: (v) => num(v, 1) }); timed.forEach((t, i) => f.hit(el("circle", { cx: f.X(t.balls), cy: f.Y(t.think_s), r: 4, class: "dot" }), `turn ${t.turn || i + 1}, ${t.balls} balls: ${num(t.think_s, 1)} s of thinking`)); if (fit) path(f, [[1, Math.max(0, fit.intercept + fit.slope)], [maxBalls, Math.max(0, fit.intercept + fit.slope * maxBalls)]], "l1"); }
    table("an-bins", ["balls", "turns", "exactly right", "95% range", "typical miss", "actual − predicted", "miss / expected"], bins.map((b) => [b.label, b.n, pct(b.exact.p), `${pct(b.exact.lo)}–${pct(b.exact.hi)}`, num(b.abs.mean, 1), signed(b.bias.mean, 1), b.relative === null ? "–" : pct(b.relative)]));
    const speeds = [...new Set(rows.filter((t) => t.speed_used !== undefined).map((t) => String(t.speed_used)))];
    $("an-speed-wrap").hidden = speeds.length === 0; if (speeds.length) table("an-speeds", ["game speed during the shot", "turns", "average balls", "exactly right"], speeds.map((v) => { const g = rows.filter((t) => String(t.speed_used) === v), s = S.summary(g); return [v === "max" ? "fastest" : `${v}×`, g.length, num(g.reduce((a, t) => a + t.balls, 0) / g.length, 1), pct(s.exact.p)]; }));
    /* the formulas, with this data's numbers */
    const m = $("an-models"); m.replaceChildren();
    const say = (t, cls) => m.append(html("p", t, cls));
    say("Each turn is a yes/no result: y = 1 if the prediction was exactly right. The range around a rate is the Wilson interval:", ""); say("(p + z²/2n ± z·√(p(1−p)/n + z²/4n²)) / (1 + z²/n),   p = k/n,   z = 1.96", "formula");
    say(`Here: k = ${all.exact.k}, n = ${all.n} → ${pct(all.exact.lo)} to ${pct(all.exact.hi)}.`);
    say("Model A (logistic): the odds of being right change by the same factor for every extra ball.", "head"); say("P(exact) = 1 / (1 + e^−(a + b·balls))", "formula");
    say(lg ? `a = ${num(lg.a)} ± ${num(1.96 * lg.seA)},   b = ${num(lg.b, 3)} ± ${num(1.96 * lg.seB, 3)}.  Each extra ball multiplies the odds by e^b = ${num(Math.exp(lg.b), 3)}.${lg.half ? ` The 50% point is −a/b = ${num(lg.half.balls, 1)} balls (± ${num(1.96 * lg.half.se, 1)}).` : ""}` : "Not enough mixed results yet to fit it (it needs at least 10 turns with both right and wrong predictions).");
    say("Model B (per ball): every ball independently behaves as predicted with probability q, so all n of them do with probability qⁿ.", "head"); say("P(exact) = qⁿ,   half-life = ln 0.5 / ln q", "formula");
    say(pb ? `q = ${num(pb.q, 4)}${pb.qLo === null ? "" : ` (95% range ${num(pb.qLo, 4)} to ${num(pb.qHi, 4)})`}. The chance of an exact prediction halves every ${num(pb.half, 1)} balls.` : "Not enough mixed results yet to fit it.");
    say("Which fits better? Both are fitted by maximum likelihood and compared by AIC = 2·(number of settings) − 2·ln L. Lower is better.", "head");
    if (lg && pb && c0) { const list = [["Same rate for any number of balls", c0.aic], ["Model A (logistic)", lg.aic], ["Model B (per ball)", pb.aic]].sort((x, y) => x[1] - y[1]); say(list.map(([n, a], i) => `${i + 1}. ${n}: ${num(a, 1)}`).join("   ")); }
    say(fit ? `Thinking time: seconds = ${num(fit.intercept)} + ${num(fit.slope, 3)} × balls (slope ± ${num(fit.half, 3)}), by least squares.` : "");
  }
  const soon = () => { if (!timer) timer = setTimeout(() => { timer = 0; render(); }, session.length > 300 ? Math.min(30000, session.length * 20) : 150); };      // long games: redraw less often, to save the processor
  window.NNChart = { frame, path, empty, table, el, html, num, signed, pct };
  window.NNAnalysis = { update(turns) { session = turns; if (!loaded) soon(); } };
  $("an-file").addEventListener("change", async (e) => { const file = e.target.files[0]; if (!file) return;
    try { const d = JSON.parse(await file.text()); if (!Array.isArray(d.turns)) throw new Error("no turns in it"); loaded = { name: file.name, turns: d.turns.slice(0, 20000) }; $("an-note").textContent = ""; } catch (err) { $("an-note").textContent = `Could not read that file: ${err.message}`; loaded = null; } $("an-back").hidden = !loaded; render(); });
  $("an-back").addEventListener("click", () => { loaded = null; $("an-file").value = ""; $("an-back").hidden = true; render(); });
  render();
})();
