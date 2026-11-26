"""The puzzle editor's logic (web/play/editor-core.js), tested without a page, and that the editor page is wired up to the scripts and elements it needs."""
import json, os, re, shutil, subprocess, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")
with open(ROOT + "/web/play/progression.json") as _f: DATA = json.load(_f)


@unittest.skipUnless(NODE, "node not installed")
class Core(unittest.TestCase):
    def js(self, body):
        code = (f'const E=require({json.dumps(ROOT + "/web/play/editor-core.js")}); const S=require({json.dumps(ROOT + "/web/play/scene.js")}); '
                f'const H=require({json.dumps(ROOT + "/web/play/hud.js")}); const DATA={json.dumps(DATA)}; {body}')
        p = subprocess.run([NODE, "-e", code], capture_output=True, text=True, timeout=120); self.assertEqual(p.returncode, 0, p.stderr); return json.loads(p.stdout)

    def test_snapping_and_placing_keep_a_thing_inside_the_field(self):
        r = self.js("const L=S.LIMITS; console.log(JSON.stringify([E.snap(123.46, 0), E.snap(123.46, 10), E.snap(125, 10), E.place(L, 5, 5, 0), E.place(L, 9999, 9999, 10), E.place(L, 301, 477, 60), E.place(L, 100.04, 200.06, 0)]))")
        self.assertEqual(r[0], 123.5); self.assertEqual(r[1], 120); self.assertEqual(r[2], 130)
        self.assertEqual(r[3], {"x": 60, "y": 150}); self.assertEqual(r[4], {"x": 660, "y": 1270}); self.assertEqual(r[5], {"x": 300, "y": 480}); self.assertEqual(r[6], {"x": 100, "y": 200.1})

    def test_the_rows_are_the_games_lanes_and_a_row_of_three_sits_ten_lower(self):
        r = self.js("console.log(JSON.stringify([1, 2, 3].map((n) => E.rowOf(n, 1200, S.RULES)).concat([E.rowOf(3, 1074, S.RULES)])))")
        self.assertEqual(r[0], [{"x": 360, "y": 1200}]); self.assertEqual(r[1], [{"x": 190, "y": 1200}, {"x": 480, "y": 1200}])
        self.assertEqual(r[2], [{"x": 141, "y": 1210}, {"x": 370, "y": 1210}, {"x": 584, "y": 1210}]); self.assertEqual(r[3][0]["y"], 1084)
        for row in r[:3]:                                                                                    # the row it gives is one the game could make, and a valid scene
            blocks = [[p["x"], p["y"], 3] for p in row]; self.assertNotIn("errors", self.js(f"console.log(JSON.stringify(S.validate({{ blocks: {json.dumps(blocks)} }})))"))

    def test_a_pickup_row_has_the_pickup_and_one_block_on_opposite_sides_and_is_a_valid_scene(self):
        r = self.js("console.log(JSON.stringify([E.pickupRowOf(S.RULES, true), E.pickupRowOf(S.RULES, false)]))")
        self.assertEqual(r[0], {"pickup": {"x": 180, "y": 1200}, "block": {"x": 470, "y": 1200}}); self.assertEqual(r[1], {"pickup": {"x": 470, "y": 1200}, "block": {"x": 180, "y": 1200}})
        for row in r: self.assertNotIn("errors", self.js(f"console.log(JSON.stringify(S.validate({{ blocks: [[{row['block']['x']}, {row['block']['y']}, 3]], pickups: [[{row['pickup']['x']}, {row['pickup']['y']}]] }})))"))

    def test_a_pickup_on_the_board_leaves_the_timer_box_out_of_the_scene(self):
        r = self.js('const s = E.blank(); s.numbers.pickupTimer = "3"; s.blocks = [{ x: 150, y: 420, hp: 5 }]; const a = E.toInput(s); s.pickups = [{ x: 400, y: 800 }]; console.log(JSON.stringify([a.pickupTimer, E.toInput(s).pickupTimer, S.complete(E.toInput(s), DATA).errors || null]))')
        self.assertEqual(r, [3, None, None])                                           # kept for when the pickup is taken off again, and not an error while it is there

    def test_shots_away_is_the_same_count_as_the_danger_meter(self):
        ys = [100, 119, 120, 150, 192, 245, 246, 371, 372, 497, 700, 1074, 1200, 1270]
        r = self.js(f"console.log(JSON.stringify({json.dumps(ys)}.map((y) => [E.shotsLeft(y), H.shotsLeft([[1, 360, y, 1]])])))")
        for y, (mine, hud) in zip(ys, r): self.assertEqual(mine, hud, y)
        self.assertEqual([self.js(f"console.log(E.shotsLeft({y}))") for y in (1200, 1074, 192)], [9, 8, 1])

    def test_a_tap_becomes_a_direction_from_the_launcher(self):
        r = self.js("console.log(JSON.stringify([E.aimFrom(360, 800), E.aimFrom(570, 300), E.aimFrom(150, 300), E.aimFrom(570, 190), E.aimFrom(5000, 200), E.aimFrom(360, 60), E.aimFrom(360, 100), E.aimPixel({ x: 360, y: 300 }), E.aimPixel({ x: 22, y: 300 })]))")
        self.assertEqual(r[0], {"x": 360, "y": 300})                                       # straight down stays straight down, however far down the tap is
        self.assertEqual(r[1], {"x": 570, "y": 300}); self.assertEqual(r[2], {"x": 150, "y": 300})            # 210 sideways over 210 down is 45 degrees: the same point on the band
        self.assertEqual(r[3], {"x": 698, "y": 300}); self.assertEqual(r[4], {"x": 698, "y": 300})            # a direction flatter than the band reaches is held at the band's edge
        self.assertIsNone(r[5]); self.assertIsNone(r[6])                                   # not below the launcher: no downward direction
        self.assertEqual(r[7], [240, 200]); self.assertEqual(r[8], [15, 200])              # the game's view is 480 x 853: a pixel is 1.5 play-field pixels

    def test_the_state_becomes_a_scene_input_and_back(self):
        r = self.js('''const s = E.blank(); s.name = "  Two blocks  "; s.numbers.score = "38"; s.numbers.counter = "2"; s.blocks = [{ x: 150, y: 420, hp: 30 }, { x: 480, y: 420, hp: 12 }]; s.pickups = [{ x: 300, y: 800 }];
          const input = E.toInput(s); const back = E.fromScene(S.complete(input, DATA).scene); console.log(JSON.stringify([input, back, E.toInput(E.blank())]))''')
        inp, back, empty = r
        self.assertEqual(inp, {"blocks": [[150, 420, 30], [480, 420, 12]], "pickups": [[300, 800]], "score": 38, "counter": 2, "name": "Two blocks"})          # empty boxes are left out, so they are filled in
        self.assertEqual(back["blocks"], [{"x": 150, "y": 420, "hp": 30}, {"x": 480, "y": 420, "hp": 12}]); self.assertEqual(back["pickups"], [{"x": 300, "y": 800}])      # blocks come back exactly
        self.assertEqual((back["numbers"]["score"], back["numbers"]["counter"]), ("38", "2")); self.assertNotEqual(back["numbers"]["balls"], "")                   # what you typed is kept; what you left empty is filled in
        self.assertEqual(empty, {"blocks": [], "pickups": []})
        r = self.js('const s = E.blank(); s.numbers.score = "abc"; s.numbers.balls = "2.5"; s.blocks = [{ x: 150, y: 420, hp: 5 }]; console.log(JSON.stringify(S.complete(E.toInput(s), DATA)))')
        self.assertIn("errors", r); self.assertIn("score", " ".join(r["errors"])); self.assertIn("balls", " ".join(r["errors"]))                                       # a word or a fraction is reported, never "fixed"

    def test_things_in_trouble_are_found(self):
        r = self.js('''const s = E.blank(); s.blocks = [{ x: 150, y: 420, hp: 5 }, { x: 200, y: 450, hp: 5 }, { x: 59, y: 600, hp: 5 }, { x: 400, y: 600, hp: 0 }, { x: 400, y: 800, hp: 2.5 }, { x: 500, y: 1000, hp: 10 ** 12 }];
          s.pickups = [{ x: 560, y: 1000 }, { x: 300, y: 1300 }]; console.log(JSON.stringify(E.trouble(s, S.LIMITS)))''')
        self.assertEqual(r["blocks"], [True, True, True, True, True, True])        # 1 and 2 overlap, 3 is outside, 4 and 5 have no good health, 6 is touching the pickup
        self.assertEqual(r["pickups"], [True, True])                                 # the first touches block 6, the second is below the field
        r = self.js('const s = E.blank(); s.blocks = [{ x: 150, y: 420, hp: 10 ** 15 }]; s.pickups = [{ x: 400, y: 420 }]; console.log(JSON.stringify(E.trouble(s, S.LIMITS)))')
        self.assertEqual(r, {"blocks": [False], "pickups": [False]})                 # a huge health is not trouble: there is no upper limit

    def test_undo_and_redo(self):
        r = self.js('''const h = E.history({ n: 0 }), out = []; out.push(h.canUndo(), h.canRedo()); out.push(h.push({ n: 1 }), h.push({ n: 1 }), h.push({ n: 2 }), h.push({ n: 3 }));
          out.push(h.undo(), h.undo(), h.canRedo(), h.redo(), h.push({ n: 9 }), h.canRedo(), h.undo(), h.undo(), h.undo(), h.undo(), h.canUndo()); console.log(JSON.stringify(out))''')
        self.assertEqual(r[:2], [False, False]); self.assertEqual(r[2:6], [True, False, True, True])                    # the same state again is not a step
        self.assertEqual(r[6:9], [{"n": 2}, {"n": 1}, True]); self.assertEqual(r[9], {"n": 2})                           # back, back, and forward
        self.assertEqual(r[10:12], [True, False])                                                                         # a new step clears what could be redone
        self.assertEqual(r[12:], [{"n": 2}, {"n": 1}, {"n": 0}, None, False])                                            # all the way back to the start, then nothing more

    def test_undo_keeps_only_as_many_steps_as_its_limit(self):
        r = self.js("const h = E.history({ n: 0 }, 3); for (const n of [1, 2, 3, 4]) h.push({ n }); console.log(JSON.stringify([h.undo(), h.undo(), h.undo(), h.undo(), h.canUndo()]))")
        self.assertEqual(r, [{"n": 3}, {"n": 2}, {"n": 1}, None, False])                                                 # the oldest step ({ n: 0 }) was dropped

    def test_a_share_link_round_trips_and_a_bad_one_says_why(self):
        r = self.js('''const s = E.blank(); s.name = "Zwei Blöcke ✓"; s.numbers.balls = "12"; s.blocks = [{ x: 150.5, y: 420, hp: 30 }, { x: 480, y: 420, hp: 9007199254740991 }]; s.pickups = [{ x: 300, y: 800 }]; s.aim = { x: 360, y: 300 };
          const link = E.encode(s), back = E.decode(link); const bad = []; for (const t of ["", "!!!", "e30", E.encode(E.blank()).slice(0, 5)]) { try { E.decode(t); bad.push("no error"); } catch (e) { bad.push(e.message); } }
          console.log(JSON.stringify({ same: JSON.stringify(back) === JSON.stringify(s), link, bad, small: E.encode(E.blank()) }))''')
        self.assertTrue(r["same"]); self.assertRegex(r["link"], r"^[A-Za-z0-9_-]+$")                                    # fits in a URL as it is
        self.assertTrue(all(m.startswith("That link is not a puzzle") for m in r["bad"]), r["bad"])

    def test_a_decoded_link_with_wrong_shapes_is_refused(self):
        for compact in ({"v": 2, "b": []}, {"v": 1, "b": [[1, 2]]}, {"v": 1, "b": [[1, 2, "x"]]}, {"v": 1, "b": [], "p": [[1]]}, {"v": 1, "b": [], "a": [1]}, [1, 2], None):
            text = self.js(f'const t = {json.dumps(json.dumps(compact))}; const b = Buffer.from(t, "utf8").toString("base64").replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); try {{ E.decode(b); console.log(JSON.stringify("accepted")); }} catch (e) {{ console.log(JSON.stringify(e.message)); }}')
            self.assertTrue(text.startswith("That link is not a puzzle"), (compact, text))


class Pages(unittest.TestCase):
    """The two pages wired to the scripts: every element a script looks up is there, and the pages keep the site's strict security policy (no inline scripts)."""
    def read(self, name):
        with open(ROOT + "/web/play/" + name) as f: return f.read()

    ids = staticmethod(lambda html: re.findall(r'\bid="([^"]+)"', html))
    used = staticmethod(lambda js: set(re.findall(r'\$\("([A-Za-z0-9_-]+)"\)', js)))
    scripts = staticmethod(lambda html: re.findall(r'<script src="([^"]+)"', html))

    def test_every_element_the_editor_scripts_look_up_is_on_the_editor_page(self):
        have = set(self.ids(self.read("puzzle-dev.html"))); need = self.used(self.read("editor.js")) | self.used(self.read("driver.js"))
        need |= {"mode-" + m for m in ("select", "block", "pickup", "aim")} | {"n-score", "n-balls", "n-health", "n-turn", "n-counter", "n-timer", "scene-bar", "scene-status", "scene-bar-close", "mind", "hud-turn", "hud-score", "hud-balls", "hud-danger"}
        self.assertEqual(sorted(need - have), [])

    def test_every_element_the_panel_and_the_driver_look_up_is_on_the_light_page(self):
        have = set(self.ids(self.read("puzzle.html"))); need = self.used(self.read("driver.js")) | {"scene-" + k for k in ("score", "balls", "health", "turn", "text", "fill", "another", "example", "build", "build-start", "status", "bar", "bar-close")} | {"mind", "hud-turn", "hud-score", "hud-balls"}
        self.assertEqual(sorted(need - have), [])

    def test_ids_are_unique_on_each_page(self):
        for name in ("puzzle.html", "puzzle-dev.html"):
            ids = self.ids(self.read(name)); self.assertEqual(sorted(i for i in set(ids) if ids.count(i) > 1), [], name)

    def test_no_inline_scripts_and_the_same_security_policy_as_the_watch_page(self):
        csp = re.search(r'Content-Security-Policy" content="([^"]+)"', self.read("index.html")).group(1)
        for name in ("puzzle.html", "puzzle-dev.html"):
            html = self.read(name); self.assertEqual(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>', html), [], name)         # every script is a file the policy allows
            self.assertIn(csp, html, name); self.assertNotIn("onclick=", html)

    def test_the_scripts_load_in_the_order_they_need(self):
        order = self.scripts(self.read("puzzle-dev.html"))
        for before, after in (("clock.js", "driver.js"), ("driver.js", "scene.js"), ("scene.js", "editor.js"), ("editor-core.js", "editor.js")): self.assertLess(order.index(before), order.index(after), (before, after))
        light = self.scripts(self.read("puzzle.html")); self.assertLess(light.index("driver.js"), light.index("scene.js"))

    def test_the_pages_link_to_each_other_and_are_reachable_from_the_menu(self):
        self.assertIn('href="puzzle-dev.html"', self.read("puzzle.html")); self.assertIn('href="puzzle.html"', self.read("puzzle-dev.html")); self.assertIn('href="puzzle-dev.html"', self.read("index.html"))
        self.assertIn("puzzle.html", self.read("../index.html"))

    def test_the_stylesheets_the_pages_link_exist(self):
        for name in ("puzzle.html", "puzzle-dev.html"):
            for href in re.findall(r'<link rel="stylesheet" href="([^"]+)"', self.read(name)):
                if href.startswith("."): continue
                self.assertTrue(os.path.isfile(ROOT + "/web/play/" + href), (name, href))

    def test_the_game_frame_keeps_one_column_on_wide_screens(self):
        self.assertRegex(self.read("pz.css"), r"\.pz \.stage \{ grid-template-columns:minmax\(0,1fr\); \}")      # the watch page's two-column stage would collapse the frame to 2 pixels


if __name__ == "__main__":
    unittest.main()
