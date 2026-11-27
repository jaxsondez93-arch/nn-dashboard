/* "Does this device agree with the laptop?": run a fixed list of boards and aims through the real game on this device and compare each result with what a desktop browser got (check-cases.json,
   written by tools/make_check_cases.py, which also checks each case is the same every time it is run there before recording it). If every row matches here too, the damage of a shot does not
   depend on the device or its JavaScript engine; if one does not, that row is the thing worth looking at. The game is the same build as every other page (no special settings). */
(function () {
  "use strict";
  const S = window.NNScene, $ = (id) => document.getElementById(id);
  let meta = null, cases = [], results = [];
  const mine = (r) => ({ outcome: r.outcome, damage: r.damage, destroyed: r.destroyed, ballsGained: r.ballsGained, scoreDelta: r.scoreAfter - r.scoreBefore, left: r.left });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const fit = () => { const scr = $("screen"), s = scr.clientWidth / 480; $("game").style.transform = `scale(${s})`; scr.style.height = Math.round(853 * s) + "px"; };
  window.addEventListener("resize", fit); fit();

  function device() {
    const n = navigator, scr = window.screen || {};
    return { userAgent: n.userAgent, platform: n.platform || "", cores: n.hardwareConcurrency || null, screen: `${scr.width}x${scr.height} at ${window.devicePixelRatio || 1}x`, language: n.language || "" };
  }
  $("ck-device").textContent = `This device: ${device().platform || "unknown"}, ${device().cores || "?"} processor threads, screen ${device().screen}.`;

  function renderTable() {
    const tb = $("ck-table").querySelector("tbody"); tb.replaceChildren();
    cases.forEach((c, i) => {
      const r = results[i], tr = document.createElement("tr"), cell = (text, cls) => { const td = document.createElement("td"); td.textContent = text; if (cls) td.className = cls; tr.append(td); };
      cell(c.name); cell(`${c.scene.balls} ball${c.scene.balls === 1 ? "" : "s"}, ${c.scene.blocks.length} block${c.scene.blocks.length === 1 ? "" : "s"}${c.scene.pickups && c.scene.pickups.length ? " + pickup" : ""}`);
      cell(c.expect.damage === undefined ? "-" : String(c.expect.damage)); cell(r ? (r.got.outcome === "ok" ? String(r.got.damage) : r.got.outcome) : "", ""); cell(r ? (r.same ? "same" : "DIFFERENT") : "", r ? (r.same ? "ok" : "bad") : "");
      tb.append(tr);
    });
    const done = results.filter(Boolean), good = done.filter((r) => r.same).length;
    $("ck-summary").textContent = !done.length ? "Nothing run yet." : done.length < cases.length && done.length === results.filter((x) => x !== undefined).length && !$("ck-run").disabled ? `${good} of ${done.length} run are identical.` : `${good} of ${done.length} identical${good === done.length ? ": this device agrees with the laptop on every shot." : `; ${done.length - good} differ.`}`;
    $("ck-summary").className = done.length && good === done.length ? "readout okline" : done.length ? "readout badline" : "readout";
    $("ck-copy").disabled = !done.length;
  }

  async function run(n, clicked) {
    const speed = Number($("ck-speed").value) || 4, buttons = ["ck-run", "ck-quick", "ck-copy"].map($), subset = cases.slice(0, n); results = new Array(cases.length); renderTable();
    const r = await S.withProgress(clicked, buttons, async (step) => {
      for (let i = 0; i < subset.length; i++) {
        const c = subset[i]; step(`Case ${i + 1} of ${subset.length}: ${c.name}`);
        await S.build(c.scene); const got = mine(await S.fire(c.aim, { speed })); results[i] = { name: c.name, got, expect: c.expect, same: same(got, c.expect) }; renderTable();
      }
    }, "Could not finish the checks");
    renderTable(); if (r.ok) { const bad = results.filter((x) => x && !x.same).length; S.say(bad ? `Done in ${r.secs.toFixed(0)} s: ${bad} of ${subset.length} shots differ from the laptop. Press Copy the results and send them.` : `Done in ${r.secs.toFixed(0)} s: all ${subset.length} shots match the laptop exactly.`, !!bad, !bad); }
  }
  $("ck-run").onclick = (e) => run(cases.length, e.currentTarget); $("ck-quick").onclick = (e) => run(Math.min(5, cases.length), e.currentTarget);
  $("ck-copy").onclick = async () => {
    const done = results.filter(Boolean), text = JSON.stringify({ device: device(), speed: Number($("ck-speed").value) || 4, recorded: meta, matched: done.filter((r) => r.same).length, of: done.length, results: done }, null, 1);
    try { await navigator.clipboard.writeText(text); S.say("Results copied. Paste them wherever you want them.", false, true); } catch (e) { $("ck-out").value = text; $("ck-out").hidden = false; $("ck-out").select(); S.say("Could not copy automatically: the results are in the box below; select and copy them.", true); }
  };

  const ready = () => { $("ck-run").disabled = $("ck-quick").disabled = false; };
  fetch("check-cases.json").then((r) => r.json()).then((d) => { meta = d.recordedOn; cases = d.cases; $("ck-meta").textContent = `${cases.length} shots, recorded on ${d.recordedOn}.`; renderTable(); if ($("game").contentDocument && $("game").contentDocument.readyState === "complete") setTimeout(ready, 800); else $("game").addEventListener("load", () => setTimeout(ready, 800)); })
    .catch(() => { $("ck-meta").textContent = "The list of shots could not be loaded."; });
})();
