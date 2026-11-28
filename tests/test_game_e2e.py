"""The built puzzle page against the REAL game, in a headless browser. Skipped unless the game files (NN_GAME_DIR), the physics engine (NN_ENGINE_DIR) and playwright are available:
the game is not part of the repository, so this only runs on a machine that has it. Each test builds a board in the game with NNScene.build and fires real shots with NNScene.fire.

  NN_GAME_DIR=/path/to/game NN_ENGINE_DIR=/path/to/engine python3 -m unittest tests.test_game_e2e"""
import functools, http.server, os, shutil, subprocess, sys, tempfile, threading, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME, ENGINE = os.environ.get("NN_GAME_DIR"), os.environ.get("NN_ENGINE_DIR")
try:
    from playwright.sync_api import sync_playwright
except Exception:                                                                       # playwright is optional
    sync_playwright = None
READY = bool(sync_playwright and GAME and ENGINE and os.path.isfile(os.path.join(GAME, "index.html")) and os.path.isfile(os.path.join(ENGINE, "box2d.js")))

GLOBALS = '''() => { const o = {}; for (const v of document.getElementById("game").contentWindow.cr_getC2Runtime().all_global_vars) o[v.name] = v.data; return o; }'''
CLOCK = '''() => { const c = document.getElementById("game").contentWindow.NNClock; return { frames: c.frames, cuts: c.cuts }; }'''
# True once the iframe has finished loading the game AFTER a src change: a running layout, the touch-input canvas driver.js's
# fire() needs, and clock.js's own override of requestAnimationFrame in place. Checking running_layout alone raced once under
# a loaded test run: it can turn true a moment before the canvas element itself exists.
READY = '''() => { try { const w = document.getElementById("game").contentWindow; return !!(w.cr_getC2Runtime().running_layout && w.document.getElementById("c2canvas") && w.NNClock); } catch (e) { return false; } }'''
BUILD_FIRE = '''async ([scene, pixel]) => {
  const g = () => { const o = {}; for (const v of document.getElementById("game").contentWindow.cr_getC2Runtime().all_global_vars) o[v.name] = v.data; return o; };
  const c = () => document.getElementById("game").contentWindow.NNClock;
  await NNScene.build(scene); const f0 = c().frames, cuts0 = c().cuts, built = NNScene.capture(); const shot = await NNScene.fire(pixel, { speed: 8 });
  return { built, shot, frames: c().frames - f0, cuts: c().cuts - cuts0, vars: g() }; }'''


@unittest.skipUnless(READY, "needs the game (NN_GAME_DIR), the engine (NN_ENGINE_DIR) and playwright")
class RealGame(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = tempfile.mkdtemp()
        site = os.path.join(cls.out, "site")
        subprocess.run([sys.executable, "-B", os.path.join(ROOT, "tools/build_pages.py"), site], check=True, capture_output=True, env=dict(os.environ, NN_GAME_DIR=GAME, NN_ENGINE_DIR=ENGINE))

        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a): pass
        class Server(http.server.ThreadingHTTPServer):
            def handle_error(self, *a): pass
        cls.server = Server(("127.0.0.1", 0), functools.partial(Quiet, directory=site)); threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start(); cls.browser = cls.pw.chromium.launch(headless=True, args=["--mute-audio"])
        cls.page = cls.browser.new_context(viewport={"width": 800, "height": 900}, service_workers="block").new_page()
        cls.errors = []; cls.page.on("pageerror", lambda e: cls.errors.append(str(e)))
        cls.page.goto(f"http://127.0.0.1:{cls.server.server_address[1]}/play/puzzle.html", wait_until="load"); cls.page.wait_for_function("() => botReady", timeout=90000)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); shutil.rmtree(cls.out, ignore_errors=True)

    def run_shot(self, scene, pixel=(240, 200)): return self.page.evaluate(BUILD_FIRE, [scene, list(pixel)])

    def with_fastend(self, scene, pixel):
        """Run one shot with the experimental early-turn-end shortcut turned on (off by default: see clock.js). Reloads the
        game iframe with ?fastend=1 for this one shot, then reloads it back to the default so later tests are unaffected."""
        try:
            self.page.evaluate('() => { document.getElementById("game").src = "game/index.html?bot=1&fastend=1"; }')
            self.page.wait_for_function(READY, timeout=60000)
            return self.run_shot(scene, pixel)
        finally:
            self.page.evaluate('() => { document.getElementById("game").src = "game/index.html?bot=1"; }')
            self.page.wait_for_function(READY, timeout=60000)

    def test_a_built_board_reads_back_exactly_and_the_score_is_drawn_on_the_game_screen(self):
        scene = {"score": 10, "balls": 7, "counter": 2, "blocks": [[1, 150, 800, 6], [2, 570, 800, 9]], "pickups": [[360, 500]]}
        r = self.page.evaluate('''async (scene) => { await NNScene.build(scene); const cap = NNScene.capture(); const shown = document.getElementById("game").contentWindow.cr_getC2Runtime().types_by_index[23].instances[0].text; return { cap, shown, hud: document.getElementById("hud-score").textContent }; }''', scene)
        self.assertEqual(r["cap"]["blocks"], [[150, 800, 6], [570, 800, 9]]); self.assertEqual(r["cap"]["pickups"], [[360, 500]])
        self.assertEqual((r["cap"]["score"], r["cap"]["balls"], r["cap"]["counter"]), (10, 7, 2)); self.assertNotIn("pickupTimer", r["cap"])        # a pickup is on the board, so the timer is not a number to read
        self.assertEqual(r["shown"], "10"); self.assertEqual(r["hud"], "10")                                                                         # the game redraws its score only when a block dies: the builder draws it itself

    def test_a_ball_that_touches_a_built_pickup_adds_a_ball_and_restarts_the_pickup_timer(self):
        r = self.run_shot({"score": 20, "balls": 3, "counter": 1, "blocks": [[1, 150, 800, 6], [2, 570, 800, 6]], "pickups": [[360, 600]]})
        self.assertEqual(r["shot"]["outcome"], "ok"); self.assertEqual((r["shot"]["ballsBefore"], r["shot"]["ballsAfter"], r["shot"]["ballsGained"]), (3, 4, 1))
        self.assertLessEqual(r["vars"]["power"], 1)                                                                                                    # collected: 0, then one turn counted

    def test_the_early_turn_end_shortcut_is_off_unless_asked_for(self):
        r = self.run_shot({"score": 0, "balls": 60, "blocks": [[1, 360, 700, 1]]})                                                                      # the same case the next test turns the shortcut on for
        self.assertEqual(r["shot"]["outcome"], "ok"); self.assertEqual(r["cuts"], 0); self.assertGreater(r["frames"], 600)                             # no ?fastend=1: plays out all 60 balls, same as any other shot

    def test_fastend_when_the_first_ball_clears_the_board_the_turn_ends_at_once_and_the_counters_are_whole(self):
        # Experimental (see clock.js): known to work for this exact shape (one block, the ball that clears it is not the turn's
        # last ball queued to launch) -- not a general guarantee. ?fastend=1 only; off by default.
        try:
            self.page.evaluate('() => { document.getElementById("game").src = "game/index.html?bot=1&fastend=1"; }')
            self.page.wait_for_function(READY, timeout=60000)
            full = self.run_shot({"score": 0, "balls": 60, "blocks": [[1, 360, 700, 1]]})
            self.assertEqual(full["shot"]["outcome"], "ok"); self.assertEqual((full["shot"]["damage"], full["shot"]["destroyed"]), (1, 1)); self.assertEqual(full["cuts"], 1)
            self.assertLess(full["frames"], 300)                                                                                                       # 60 balls would take about 900 frames to launch
            self.assertEqual((full["vars"]["TotalBall"], full["vars"]["ballStart"], full["vars"]["ballEnd"], full["vars"]["score"], full["vars"]["Tap"]), (60, 60, 60, 1, 0))
            again = self.page.evaluate('''async () => { const f0 = document.getElementById("game").contentWindow.NNClock.frames; const shot = await NNScene.fire([300, 220], { speed: 8 }); return { shot, frames: document.getElementById("game").contentWindow.NNClock.frames - f0 }; }''')
            self.assertEqual(again["shot"]["outcome"], "ok"); self.assertGreater(again["frames"], 600)                                                 # the following turn still launches all 60 balls and ends by itself
            self.assertEqual(self.page.evaluate(GLOBALS)["ballEnd"], 60)
        finally:
            self.page.evaluate('() => { document.getElementById("game").src = "game/index.html?bot=1"; }')
            self.page.wait_for_function(READY, timeout=60000)

    def test_a_board_that_is_not_empty_is_never_cut_short_even_with_fastend_on(self):
        r = self.with_fastend({"score": 0, "balls": 40, "blocks": [[1, 360, 700, 1], [2, 150, 900, 400]]}, (240, 200))
        self.assertEqual(r["cuts"], 0); self.assertGreater(r["frames"], 500)                                                                           # a block that survives keeps the shot going to the last ball

    def test_above_2_to_the_53_hits_stop_taking_one_off_and_the_score_stops_rising(self):
        low = self.run_shot({"score": 0, "balls": 3, "blocks": [[1, 360, 700, 2 ** 53 - 3]]}); self.assertEqual(low["shot"]["damage"], 3)               # exact below the limit
        stuck = self.run_shot({"score": 0, "balls": 3, "blocks": [[1, 360, 700, 2 ** 54]]}); self.assertEqual(stuck["shot"]["damage"], 0)             # from 2^54 a hit changes nothing
        frozen = self.run_shot({"score": 2 ** 53, "balls": 3, "blocks": [[1, 360, 700, 1]]}); self.assertEqual(frozen["shot"]["destroyed"], 1); self.assertEqual(frozen["vars"]["score"], 2 ** 53)

    def test_the_editor_builds_a_puzzle_fires_a_test_shot_reads_the_board_back_and_undoes(self):
        page = self.page.context.new_page(); errors = []; page.on("pageerror", lambda e: errors.append(str(e)))
        base = f"http://127.0.0.1:{self.server.server_address[1]}/play/puzzle-dev.html"
        page.goto(base, wait_until="load"); page.wait_for_function("() => botReady", timeout=90000)
        link = page.evaluate("""() => NNEditorCore.encode({ name: "t", numbers: { score: "", balls: "12", health: "", turn: "", counter: "", pickupTimer: "" }, blocks: [{ x: 150, y: 800, hp: 6 }, { x: 570, y: 800, hp: 6 }], pickups: [{ x: 360, y: 600 }], aim: { x: 360, y: 300 } })""")
        page.goto(base + "#s=" + link, wait_until="load"); page.reload(); page.wait_for_function("() => botReady", timeout=90000)
        count = lambda kind: page.evaluate("(k) => document.querySelectorAll('#ed-things g[data-kind=' + k + ']').length", kind)
        self.assertEqual((count("block"), count("pickup")), (2, 1)); self.assertTrue(page.is_disabled("#n-timer"))                              # one pickup is on the board, so the timer is set for you
        page.click("#ed-build"); page.wait_for_function("() => /Done in|Could not/.test(document.getElementById('scene-status').textContent)", timeout=90000); self.assertIn("Done in", page.inner_text("#scene-status"))
        page.click("#ed-fire"); page.wait_for_function("() => /Shot done|Could not|The game ended|No ball|did not finish/.test(document.getElementById('scene-status').textContent)", timeout=120000)
        self.assertIn("Shot done", page.inner_text("#scene-status")); self.assertIn("+1 ball", page.inner_text("#scene-status"))                      # the aim goes straight down onto the pickup
        page.click("#ed-read"); page.wait_for_timeout(500); self.assertGreaterEqual(count("block"), 2)                                          # the board is one row higher and has its new row
        page.click("#ed-undo"); page.wait_for_timeout(300); self.assertEqual(count("block"), 2); self.assertFalse(page.is_disabled("#ed-redo"))
        self.assertEqual(errors, []); page.close()

    def test_no_page_errors(self):
        self.assertEqual(self.errors, [])


if __name__ == "__main__":
    unittest.main()
