#!/usr/bin/env python3
"""Print the game's own rules, as readable pseudo-code, straight from the running game.

  python3 tools/decompile_game.py SITE_DIR [--out DIR]

SITE_DIR is a built copy of the site that includes the game (tools/build_pages.py makes one). The game is a Construct 2 export: its rules are stored as a tree of events
(conditions and actions with parsed expressions). This opens the watch page in a headless browser, gets to the game screen, and walks that tree, naming each condition, action
and expression, one text file per event sheet. Triggers ("on created", "on destroyed", "on layout start") are kept in a separate table by the engine and are listed after the plain events.
Object types are shown by their engine names (t9 = ball, t11 = block, t20 = a block's health label, t22 = pickup). Needs playwright (pip install playwright)."""
import functools, http.server, os, sys, threading, time

DECOMPILE = r"""() => {
  const r = document.getElementById("game").contentWindow.cr_getC2Runtime(), lines = [];
  const nameOf = (table, fn) => { if (!table) return "?"; for (const k in table) if (table[k] === fn) return k; return "?"; };
  const OPS = ["+", "-", "*", "/", "%", "^", "&", "|", "=", "!=", "<", "<=", ">", ">="];
  const tname = (t) => (t ? t.name : "System");
  function expr(e) {                                   // node types: 0-2 literals, 3 minus, 4-17 operators, 18 conditional, 19 system function, 20 object function, 21 instance variable, 22 behaviour function, 23 global variable
    if (!e) return "null";
    switch (e.type) {
      case 0: case 1: return String(e.value); case 2: return JSON.stringify(e.value); case 3: return "-(" + expr(e.first) + ")";
      case 18: return "(" + expr(e.first) + " ? " + expr(e.second) + " : " + expr(e.third) + ")";
      case 19: return nameOf(r.system.exps, e.func) + "(" + (e.parameters || []).map(expr).join(", ") + ")";
      case 20: return tname(e.object_type) + "." + nameOf(e.object_type.plugin.exps, e.func) + "(" + (e.parameters || []).map(expr).join(", ") + ")";
      case 21: return tname(e.object_type) + ".var" + e.varindex;
      case 22: return tname(e.object_type) + "." + (e.behavior_type ? e.behavior_type.name : "?") + "." + nameOf(e.behavior_type && e.behavior_type.behavior && e.behavior_type.behavior.exps, e.func) + "(" + (e.parameters || []).map(expr).join(", ") + ")";
      case 23: return e.varname;
      default: return "(" + expr(e.first) + " " + OPS[e.type - 4] + " " + expr(e.second) + ")";
    }
  }
  function param(p) { try { if (p.expression) return expr(p.expression); const o = {}; for (const k of ["varname", "index", "key", "combosel"]) if (p[k] !== undefined && p[k] !== null) o[k] = p[k]; if (p.object) o.object = tname(p.object); return JSON.stringify(o); } catch (e) { return "<param?>"; } }
  function call(x, kind) {
    let table; const bt = x.behaviortype;
    if (bt && bt.behavior) table = bt.behavior[kind]; else if (x.type && x.type.plugin) table = x.type.plugin[kind]; else table = r.system[kind];
    return (x.type ? tname(x.type) + (bt ? "." + bt.name : "") : "System") + "." + nameOf(table, x.func) + "(" + (x.parameters || []).map(param).join(", ") + ")";
  }
  function walk(events, depth) {
    const pad = "  ".repeat(depth);
    for (const e of events) {
      if (e.name !== undefined && !e.conditions) { lines.push(pad + "VAR " + e.name + " = " + JSON.stringify(e.initial !== undefined ? e.initial : e.data)); continue; }
      if (e.is_group) { lines.push(pad + "GROUP " + (e.group_name || "")); if (e.subevents) walk(e.subevents, depth + 1); continue; }
      if (!e.conditions) { lines.push(pad + "<include or comment>"); continue; }
      lines.push(pad + "IF " + (e.conditions.map((c) => (c.inverted ? "NOT " : "") + call(c, "cnds")).join("  AND  ") || "(always)"));
      for (const a of e.actions) lines.push(pad + "   DO " + call(a, "acts"));
      if (e.subevents && e.subevents.length) walk(e.subevents, depth + 1);
    }
  }
  const out = {};
  for (const name of Object.keys(r.eventsheets)) {
    lines.length = 0; const sheet = r.eventsheets[name];
    walk(sheet.events, 0);
    for (const typeIndex of Object.keys(sheet.triggers || {})) for (const entry of sheet.triggers[typeIndex]) for (const pair of entry.evs) {
      const ev = Array.isArray(pair) ? pair[0] : pair; lines.push("TRIGGER on " + (typeIndex === "system" ? "System" : typeIndex) + "  [" + call(ev.conditions[pair[1] || 0], "cnds") + "]"); walk([ev], 1);
    }
    out[name] = lines.slice();
  }
  return out;
}"""


def main(argv):
    if not argv or argv[0].startswith("-"): sys.exit(__doc__)
    site, out = argv[0], "game-rules"
    if "--out" in argv: out = argv[argv.index("--out") + 1]
    try: from playwright.sync_api import sync_playwright
    except ImportError: sys.exit("This needs playwright: pip install playwright && playwright install chromium")

    class Quiet(http.server.ThreadingHTTPServer):
        def handle_error(self, *a): pass

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass

    server = Quiet(("127.0.0.1", 0), functools.partial(Handler, directory=site)); threading.Thread(target=server.serve_forever, daemon=True).start()
    layout = "() => { try { return document.getElementById('game').contentWindow.cr_getC2Runtime().running_layout.name; } catch (e) { return null; } }"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--mute-audio"]); page = browser.new_context(service_workers="block").new_page()
        page.goto(f"http://127.0.0.1:{server.server_address[1]}/play/", wait_until="load"); page.wait_for_function("() => botReady", timeout=60000)
        t0 = time.time()
        while page.evaluate(layout) != "Game":                          # press Play until the game screen appears, as the bot does
            if time.time() - t0 > 60: sys.exit("the game screen never appeared")
            page.evaluate("() => tapAt(240, 526, 40)"); time.sleep(0.4)
        sheets = page.evaluate(DECOMPILE); browser.close()
    server.shutdown(); os.makedirs(out, exist_ok=True)
    for name, lines in sheets.items():
        with open(os.path.join(out, name + ".txt"), "w") as f: f.write("\n".join(lines) + "\n")
        print(f"{name}: {len(lines)} lines -> {os.path.join(out, name + '.txt')}")


if __name__ == "__main__":
    main(sys.argv[1:])
