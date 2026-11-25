/* "Explore the data": the dashboard's analysis tools applied to the bot's turns. Trends with uncertainty bands, a correlation table you can click, a scatter plot, rolling correlation,
   a several-causes-at-once regression, and the spread and memory of the misses. The maths is in stats.js; the chart helpers come from analysis.js. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id), S = window.NNStats, C = window.NNChart; if (!$("ex")) return;
  const VARS = [["turn", "turn", (t, i) => i + 1], ["balls", "balls", (t) => t.balls], ["blocks", "blocks on the board", (t) => t.blocks], ["hp", "total block health", (t) => t.hp_before], ["predicted", "predicted damage", (t) => t.predicted],
    ["damage", "actual damage", (t) => t.damage], ["miss", "actual − predicted", (t) => t.damage - t.predicted], ["absmiss", "size of the miss", (t) => Math.abs(t.damage - t.predicted)], ["exact", "exactly right (1 or 0)", (t) => S.exact(t)],
    ["perball", "damage per ball", (t) => t.damage / t.balls], ["think", "thinking seconds", (t) => t.think_s], ["sims", "shots simulated", (t) => t.sims], ["secs", "seconds per turn", (t) => t.secs], ["score", "score", (t) => t.score]];
  let rows = [], data = {}, have = [];
  const name = (k) => VARS.find((v) => v[0] === k)[1], pairs = (x, y) => { const xs = [], ys = []; for (let i = 0; i < rows.length; i++) if (Number.isFinite(data[x][i]) && Number.isFinite(data[y][i])) { xs.push(data[x][i]); ys.push(data[y][i]); } return [xs, ys]; };
  function options(id, preferred) { const s = $(id), old = s.value; if (s.dataset.have === have.join()) return; s.dataset.have = have.join(); s.replaceChildren(...have.map((k) => { const o = document.createElement("option"); o.value = k; o.textContent = name(k); return o; })); s.value = have.includes(old) ? old : preferred; if (!s.value) s.value = have[0]; }
  function range(v) { let lo = Math.min(...v), hi = Math.max(...v); if (lo === hi) { lo -= 1; hi += 1; } const pad = (hi - lo) * 0.05; return [lo >= 0 && lo - pad < 0 ? 0 : lo - pad, hi + pad]; }
  /* A scatter (or time series) with its least-squares line and band. */
  function fitted(id, xs, ys, xlabel, ylabel, inOrder, joined) {
    if (xs.length < 4) { C.empty(id, "needs a few more turns"); return null; }
    const t = S.trend(xs, ys, inOrder), [x0, x1] = range(xs); let [y0, y1] = range(ys); const f = C.frame(id, { x0, x1, y0, y1, xlabel, yfmt: (v) => C.num(v, y1 - y0 < 5 ? 1 : 0) });
    if (t) { const grid = Array.from({ length: 41 }, (_, i) => x0 + (x1 - x0) * i / 40), clip = (y) => Math.min(y1, Math.max(y0, y)); f.svg.append(C.el("polygon", { class: "band", points: grid.map((x) => `${f.X(x)},${f.Y(clip(t.at(x) + t.half(x)))}`).concat(grid.slice().reverse().map((x) => `${f.X(x)},${f.Y(clip(t.at(x) - t.half(x)))}`)).join(" ") })); C.path(f, grid.map((x) => [x, clip(t.at(x))]), "fitline"); }
    if (joined) C.path(f, xs.map((x, i) => [x, ys[i]]), "series");
    xs.forEach((x, i) => f.hit(C.el("circle", { cx: f.X(x), cy: f.Y(ys[i]), r: joined ? 3 : 4, class: "dot" }), `${xlabel} ${C.num(x, 0)} · ${ylabel} ${C.num(ys[i], 2)}`));
    return t;
  }
  const sentence = (t, x, y) => (t ? `${y} changes by ${C.signed(t.slope, 3)} ± ${C.num(t.slopeHalf, 3)} for each 1 of ${x} (95% range). R² = ${C.num(t.r2)}${t.rho > 0.05 ? `; range widened because neighbouring turns resemble each other (ρ = ${C.num(t.rho)})` : ""}.` : "");
  function trends() { const k = $("ex-trend").value, [xs, ys] = pairs("turn", k), t = fitted("ex-ch-trend", xs, ys, "turn", name(k), true, true); $("ex-trend-say").textContent = sentence(t, "turn", name(k)); }
  function scatter() { const x = $("ex-x").value, y = $("ex-y").value, [xs, ys] = pairs(x, y), t = fitted("ex-ch-scatter", xs, ys, name(x), name(y), x === "turn", false), r = S.pearson(xs, ys); $("ex-scatter-say").textContent = `${r === null ? "" : `Correlation r = ${C.num(r)}. `}${sentence(t, name(x), name(y))}`; }
  const CORR = ["turn", "balls", "blocks", "hp", "damage", "absmiss", "exact", "think"];
  function matrix() {
    const keys = CORR.filter((k) => have.includes(k)), t = $("ex-corr"); t.replaceChildren(); const head = C.html("tr"); head.append(C.html("th", "")); keys.forEach((k) => head.append(C.html("th", name(k)))); t.append(head);
    keys.forEach((a) => { const tr = C.html("tr"); tr.append(C.html("th", name(a))); keys.forEach((b) => { const r = a === b ? 1 : S.pearson(...pairs(a, b)), td = C.html("td"), btn = C.html("button", r === null ? "–" : r.toFixed(2), "cell");
      if (r !== null) btn.style.background = `color-mix(in srgb, ${r >= 0 ? "var(--s1)" : "var(--neg)"} ${Math.round(Math.abs(r) * 55)}%, var(--card))`; btn.title = `${name(a)} against ${name(b)}`; btn.onclick = () => { $("ex-x").value = b; $("ex-y").value = a; scatter(); $("ex-ch-scatter").scrollIntoView({ behavior: "smooth", block: "center" }); }; td.append(btn); tr.append(td); }); t.append(tr); });
  }
  function rollingCorrelation() {
    const x = $("ex-rx").value, y = $("ex-ry").value, w = +$("ex-w").value; $("ex-wv").textContent = w; const [xs, ys] = pairs(x, y), pts = [];
    for (let i = w; i <= xs.length; i++) { const r = S.pearson(xs.slice(i - w, i), ys.slice(i - w, i)); if (r !== null) pts.push([i, r]); }
    if (pts.length < 2) { C.empty("ex-ch-roll", `needs more than ${w} turns`); return; } const f = C.frame("ex-ch-roll", { x0: pts[0][0], x1: pts[pts.length - 1][0], y0: -1, y1: 1, xlabel: "turns so far", yfmt: (v) => C.num(v, 1) });
    C.path(f, [[pts[0][0], 0], [pts[pts.length - 1][0], 0]], "ref"); C.path(f, pts, "series"); pts.forEach(([i, r]) => f.hit(C.el("circle", { cx: f.X(i), cy: f.Y(r), r: 7, class: "ghost" }), `turns ${i - w + 1}–${i}: r = ${C.num(r)}`));
  }
  function regression() {
    const y = $("ex-target").value, causes = ["balls", "blocks", "hp", "turn"].filter((k) => k !== y && have.includes(k)), keep = rows.map((_, i) => i).filter((i) => [y].concat(causes).every((k) => Number.isFinite(data[k][i])));
    const m = S.multiple(keep.map((i) => data[y][i]), causes.map((k) => keep.map((i) => data[k][i])));
    if (!m) { C.table("ex-reg", ["not enough varied data yet"], []); $("ex-reg-say").textContent = ""; return; }
    C.table("ex-reg", ["cause", "effect of one typical step", "95% range", "overlap with the other causes (VIF)"], causes.map((k, j) => [name(k), C.signed(m.terms[j].coef), `${C.signed(m.terms[j].coef - m.terms[j].half)} to ${C.signed(m.terms[j].coef + m.terms[j].half)}`, C.num(m.terms[j].vif, 1)]));
    $("ex-reg-say").textContent = `Together these explain R² = ${C.num(m.r2)} of the variation in ${name(y)} (${m.n} turns).${m.terms.some((t) => t.vif > 5) ? " A VIF above 5 means two causes move so much together that their separate effects cannot be told apart." : ""}`;
  }
  function spread() {
    const miss = rows.map((t) => t.damage - t.predicted), h = S.histogram(miss, 25);
    if (h.length) { const f = C.frame("ex-ch-hist", { x0: h[0].lo, x1: h[h.length - 1].hi, y0: 0, y1: Math.max(...h.map((b) => b.n)) * 1.05, xlabel: "actual − predicted" }); h.forEach((b) => f.hit(C.el("rect", { x: f.X(b.lo) + 1, y: f.Y(b.n), width: Math.max(1, f.X(b.hi) - f.X(b.lo) - 2), height: Math.max(0, f.Y(0) - f.Y(b.n)), rx: 2, class: "bar" }), `miss ${C.num(b.lo, 0)} to ${C.num(b.hi, 0)}: ${b.n} turns`)); }
    const ac = S.autocorrelation(rows.map((t) => Math.abs(t.damage - t.predicted)), 15), band = 1.96 / Math.sqrt(rows.length);
    if (!ac.length) C.empty("ex-ch-acf", "needs a few more turns"); else { const f = C.frame("ex-ch-acf", { x0: 0, x1: ac.length + 1, y0: -1, y1: 1, xlabel: "turns apart", yfmt: (v) => C.num(v, 1) }); [band, -band].forEach((v) => C.path(f, [[0, v], [ac.length + 1, v]], "ref")); ac.forEach((r, i) => f.hit(C.el("rect", { x: f.X(i + 1) - 6, y: f.Y(Math.max(0, r)), width: 12, height: Math.max(1, Math.abs(f.Y(r) - f.Y(0))), rx: 2, class: "bar" }), `${i + 1} turns apart: correlation ${C.num(r)}`)); }
  }
  function all() { trends(); matrix(); scatter(); rollingCorrelation(); regression(); spread(); }
  window.NNExplore = { update(r) { rows = r; if (!rows.length) { $("ex").hidden = true; return; } $("ex").hidden = false; data = {}; VARS.forEach(([k, , get]) => { data[k] = rows.map((t, i) => { const v = get(t, i); return Number.isFinite(v) ? v : NaN; }); }); have = VARS.map((v) => v[0]).filter((k) => data[k].some(Number.isFinite));
    options("ex-trend", "absmiss"); options("ex-x", "balls"); options("ex-y", "absmiss"); options("ex-rx", "balls"); options("ex-ry", "absmiss"); options("ex-target", "absmiss"); all(); } };
  $("ex-trend").onchange = trends; $("ex-x").onchange = scatter; $("ex-y").onchange = scatter; ["ex-rx", "ex-ry"].forEach((i) => { $(i).onchange = rollingCorrelation; }); $("ex-w").oninput = rollingCorrelation; $("ex-target").onchange = regression;
})();
