#!/usr/bin/env python3
"""Build web/play/check-cases.json: a fixed list of (board, aim) pairs with the real game's result on THIS browser, for check.html to compare against on another device.
Each case is fired twice here first and kept only if both runs agree (the game's physics must be deterministic; this is the self-check for that claim on the recording device itself).

  python3 tools/make_check_cases.py SITE_DIR [--out FILE]      SITE_DIR is a built copy of the site that includes the game (tools/build_pages.py makes one)."""
import json, os, sys, functools, http.server, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# name, scene (as the builder's validate() wants it), aim pixel in the game's 480x853 view. A spread of ball counts and board shapes; kept modest so a phone can run the full list in a few minutes.
CASES = [
    ("light: 1 ball, dead centre", {"balls": 1, "blocks": [[360, 700, 1]]}, [240, 220]),
    ("light: 1 ball, a clean miss", {"balls": 1, "blocks": [[150, 700, 1]]}, [460, 130]),
    ("light: 2 balls, two blocks", {"balls": 2, "blocks": [[150, 700, 1], [480, 700, 1]]}, [240, 220]),
    ("light: 4 balls, grazing hit", {"balls": 4, "blocks": [[300, 650, 2], [420, 680, 2]]}, [250, 200]),
    ("moderate: 8 balls, one tough block", {"balls": 8, "blocks": [[360, 750, 10]]}, [240, 220]),
    ("moderate: 10 balls, three blocks", {"balls": 10, "blocks": [[150, 600, 6], [360, 750, 8], [550, 650, 5]]}, [260, 210]),
    ("moderate: 15 balls, health 20", {"balls": 15, "blocks": [[300, 700, 20], [450, 850, 15]]}, [230, 205]),
    ("moderate: 12 balls, a pickup", {"balls": 12, "blocks": [[200, 700, 9], [520, 750, 9]], "pickups": [[360, 550]]}, [240, 220]),
    ("heavy: 20 balls, health 40", {"balls": 20, "blocks": [[360, 800, 40]]}, [240, 220]),
    ("heavy: 30 balls, four blocks", {"balls": 30, "blocks": [[150, 600, 25], [320, 700, 30], [480, 650, 20], [580, 900, 15]]}, [270, 215]),
    ("heavy: 40 balls, health 80", {"balls": 40, "blocks": [[300, 750, 80], [460, 850, 25]]}, [235, 208]),
]


def run(site_dir):
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    class Server(http.server.ThreadingHTTPServer):
        def handle_error(self, *a): pass
    srv = Server(("127.0.0.1", 0), functools.partial(Quiet, directory=site_dir)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{srv.server_address[1]}/play/puzzle-dev.html"           # the editor page already wires up NNScene.build/fire with no bot running
    results, engine = [], None
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=["--mute-audio"])
        pg = b.new_context(viewport={"width": 800, "height": 900}, service_workers="block").new_page()
        errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(base, wait_until="load"); pg.wait_for_function("() => botReady", timeout=90000)
        engine = pg.evaluate("() => navigator.userAgent")
        FIRE = """async ([scene, aim]) => { await NNScene.build(scene); const r = await NNScene.fire(aim, { speed: 8 });
          return { outcome: r.outcome, damage: r.damage, destroyed: r.destroyed, ballsGained: r.ballsGained, scoreDelta: r.scoreAfter - r.scoreBefore, left: r.left }; }"""
        for name, raw, aim in CASES:
            # NNScene.build() wants the canonical shape validate() produces (score defaulted, each block given an id) -- the raw, partial form above is only what a person would type.
            canon = pg.evaluate("(raw) => { const v = NNScene.validate(raw); if (v.errors) throw new Error(v.errors.join(' ')); return v.scene; }", raw)
            got = pg.evaluate(FIRE, [canon, aim])
            again = pg.evaluate(FIRE, [canon, aim])
            if got != again: raise SystemExit(f"'{name}' was not deterministic on this very browser: {got} vs {again}. Not writing check-cases.json; look at this case first.")
            print(f"  {name}: {got}")
            results.append({"name": name, "scene": canon, "aim": aim, "expect": got})
        if errs: raise SystemExit(f"page errors while recording: {errs}")
        b.close()
    srv.shutdown()
    return engine, results


def main():
    if len(sys.argv) < 2: raise SystemExit(f"usage: {sys.argv[0]} SITE_DIR [--out FILE]")
    site_dir = sys.argv[1]; out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.join(ROOT, "web/play/check-cases.json")
    import datetime
    engine, results = run(site_dir)
    data = {"recordedOn": f"{datetime.date.today().isoformat()}, {engine}", "cases": results}
    with open(out, "w") as f: json.dump(data, f, indent=1)
    print(f"wrote {len(results)} cases to {out}")


if __name__ == "__main__":
    main()
