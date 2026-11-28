#!/usr/bin/env python3
"""Walk one real playthrough forward, turn by turn, numbering every board and testing each one for a one-shot clear.

At each board: brute-force every one of the 781 aims with the real shot simulator (tools/solve_board.js; exact for a
single shot, no learned model). If any aim clears the board completely, it is "solved" (the clear is recorded);
either way, the best aim found (a clearing one if there is one, otherwise the one doing the most damage) is PLAYED
FOR REAL in the actual game, with a fresh seed, and the resulting next board -- one turn later, exactly as the game
would make it, not a statistical guess -- becomes the next node. This is deliberately the simplest reading of "the
AI focuses hard on one board at a time, numbers and tracks the boards, and the daily puzzle is the lowest-numbered
one not yet used": a single chain, not a wide tree. A wider tree (several children per node) is a natural next step
once this is working, by expanding more than one aim per board.

Usage: NN_GAME_DIR=... NN_ENGINE_DIR=... python3 tools/board_tree.py [--steps N] [--out FILE]
  --steps N   how many more boards to add this run (default 8)
  --out FILE  where the tree is kept, read back in and appended to if it already exists (default tools/board_tree.json)
"""
import functools, http.server, json, os, random, subprocess, sys, tempfile, threading, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OPENING = {"balls": 1, "blocks": [[570, 1032, 1], [83, 963, 1], [236, 753, 1], [502, 792, 1], [627, 588, 1], [628, 718, 1]], "pickups": []}

CAPTURE_AND_FIRE = """async ([scene, aim, seed]) => {
  document.getElementById("game").src = "game/index.html?bot=1&seed=" + seed;
  await new Promise((r) => setTimeout(r, 2500));
  for (let i = 0; i < 40; i++) { try { if (document.getElementById("game").contentWindow.cr_getC2Runtime().running_layout) break; } catch (e) {} await new Promise((r) => setTimeout(r, 250)); }
  const v = NNScene.validate(scene); if (v.errors) throw new Error(v.errors.join(" "));
  await NNScene.build(v.scene);
  const shot = await NNScene.fire(aim, { speed: 8 });
  if (shot.outcome !== "ok") return { shot };
  const next = NNScene.capture();
  return { shot, next };
}"""


def solve_offline(scene, node_id):
    """Run tools/solve_board.js on this board and return its summary (needs NN_ENGINE_DIR in the environment)."""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(scene, f); path = f.name
    try:
        out = os.path.join(tempfile.gettempdir(), f"board_tree_solve_{node_id}.json")
        node = os.environ.get("NN_NODE") or "node"
        subprocess.run([node, os.path.join(ROOT, "tools/solve_board.js"), path, "--out", out], check=True, capture_output=True, text=True)
        with open(out) as f: return json.load(f)
    finally:
        os.unlink(path)


def serve(site_dir):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    class Server(http.server.ThreadingHTTPServer):
        def handle_error(self, *a): pass
    srv = Server(("127.0.0.1", 0), functools.partial(Quiet, directory=site_dir)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    args = sys.argv[1:]; val = lambda n, d: args[args.index(n) + 1] if n in args else d
    steps, out_path = int(val("--steps", "8")), val("--out", os.path.join(ROOT, "tools/board_tree.json"))
    if not os.environ.get("NN_ENGINE_DIR"): raise SystemExit("set NN_ENGINE_DIR")

    tree = {"nodes": []}
    if os.path.isfile(out_path):
        try:
            with open(out_path) as f: tree = json.load(f)
        except Exception: tree = {"nodes": []}
    if not tree["nodes"]: tree["nodes"].append({"id": 0, "parent": None, "turn": 1, "scene": OPENING, "solved": None, "best": None, "madeBy": None})
    save = lambda: json.dump(tree, open(out_path, "w"), indent=1)

    site_dir = tempfile.mkdtemp()
    subprocess.run([sys.executable, "-B", os.path.join(ROOT, "tools/build_pages.py"), site_dir], check=True, env=dict(os.environ))
    srv = serve(site_dir)

    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--mute-audio"])
        try:
            for _ in range(steps):
                node = tree["nodes"][-1]
                print(f"\n--- board {node['id']} (turn {node['turn']}, {node['scene']['balls']} ball(s), {len(node['scene']['blocks'])} blocks) ---")

                summary = solve_offline(node["scene"], node["id"])
                cleared = summary["best"]["cleared"]
                node["solved"] = {"aims": summary["best"]["aims"], "example": summary["best"]["examples"][0]} if cleared else None
                node["best"] = {"damage": summary["best"]["damage"], "totalHealth": summary["totalHealth"], "aim": summary["best"]["examples"][0], "cleared": cleared}
                if cleared: print(f"  SOLVED: {summary['clearingAims']} of 781 aims clear it (e.g. pixel {node['best']['aim']})")
                else: print(f"  not solved: best damage {node['best']['damage']} of {summary['totalHealth']} (pixel {node['best']['aim']})")
                save()

                # A shot is deterministic given the same board, aim and seed, so a bad outcome (almost always a timing flake
                # under system load, e.g. the laptop busy with something else) is worth one retry with that exact same
                # triple before giving up -- it is not "trying again and hoping for a different answer".
                seed = random.randint(1, 10**9); shot = result = None
                for attempt in range(3):
                    ctx = browser.new_context(viewport={"width": 800, "height": 900}); page = ctx.new_page()
                    errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
                    page.goto(f"http://127.0.0.1:{srv.server_address[1]}/play/puzzle-dev.html", wait_until="load")
                    page.wait_for_function("() => botReady", timeout=90000)
                    result = page.evaluate(CAPTURE_AND_FIRE, [node["scene"], node["best"]["aim"], seed])
                    ctx.close()
                    if errors: print("  page errors:", errors[:3])
                    shot = result["shot"]
                    if shot["outcome"] == "ok": break
                    print(f"  attempt {attempt + 1}: the shot ended as \"{shot['outcome']}\"" + (", retrying the same board/aim/seed" if attempt < 2 else ""))
                if shot["outcome"] != "ok":
                    print(f"  could not advance after 3 tries: \"{shot['outcome']}\" every time (this looks like a real outcome, not a flake)"); break
                nxt = result["next"]
                print(f"  played pixel {node['best']['aim']}: damage {shot['damage']}, destroyed {shot['destroyed']}, +{shot['ballsGained']} ball(s) -> board {node['id'] + 1}")
                # carry every field NNScene.capture() gives (health, counter, and pickupTimer when there is no pickup): leaving any of these out would
                # make the next build() default them (health from turn, counter from turn%3, pickupTimer to 0), silently restarting the difficulty
                # and the pickup clock from turn 1 instead of truly continuing this playthrough.
                child_scene = {"balls": nxt["balls"], "blocks": nxt["blocks"], "pickups": nxt["pickups"]}
                for key in ("health", "counter", "pickupTimer"):
                    if key in nxt: child_scene[key] = nxt[key]
                child = {"id": node["id"] + 1, "parent": node["id"], "turn": node["turn"] + 1, "seed": seed,
                         "madeBy": {"from": node["id"], "aim": node["best"]["aim"], "clearing": cleared},
                         "scene": child_scene, "solved": None, "best": None}
                tree["nodes"].append(child); save()
        finally:
            browser.close()

    import shutil; shutil.rmtree(site_dir, ignore_errors=True); srv.shutdown()
    solved = [n for n in tree["nodes"] if n["solved"]]
    print(f"\n{len(tree['nodes'])} boards total, {len(solved)} solved (100% clear exists): {', '.join(str(n['id']) for n in solved) or 'none yet'}")
    print(f"saved to {out_path}")


if __name__ == "__main__":
    main()
