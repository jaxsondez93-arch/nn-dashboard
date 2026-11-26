"""The "Build a puzzle" panel: the scene checks (pure code, so tested without a page), and that the page wires the panel up."""
import json, os, re, shutil, subprocess, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


@unittest.skipUnless(NODE, "node not installed")
class Validate(unittest.TestCase):
    def js(self, body):
        code = f'const S=require({json.dumps(ROOT + "/web/play/scene.js")}); {body}'
        p = subprocess.run([NODE, "-e", code], capture_output=True, text=True, timeout=60); self.assertEqual(p.returncode, 0, p.stderr); return json.loads(p.stdout)

    def check(self, scene):
        return self.js(f"console.log(JSON.stringify(S.validate({json.dumps(scene)})))")

    def test_the_example_is_valid_and_comes_back_in_one_shape(self):
        r = self.js("console.log(JSON.stringify(S.parse(S.EXAMPLE_TEXT)))")
        self.assertNotIn("errors", r); s = r["scene"]
        self.assertEqual((s["balls"], s["score"], len(s["blocks"]), s["pickups"]), (12, 0, 5, [])); self.assertEqual(s["blocks"][0], [1, 150, 420, 30])      # [id, x, y, health]

    def test_three_four_and_named_block_forms_all_work(self):
        r = self.check({"balls": 3, "blocks": [[150, 420, 5], [9, 400, 420, 6], {"x": 280, "y": 700, "hp": 7}]})
        self.assertEqual([b[1:] for b in r["scene"]["blocks"]], [[150, 420, 5], [400, 420, 6], [280, 700, 7]])

    def test_balls_and_score_have_sensible_defaults(self):
        s = self.check({"blocks": [[150, 420, 5]]})["scene"]; self.assertEqual((s["balls"], s["score"]), (1, 0))

    def test_every_problem_is_reported_at_once(self):
        r = self.check({"balls": 0, "score": -4, "blocks": [[10, 420, 5], [150, 99999, 5], [300, 600, 0]]})
        self.assertEqual(len(r["errors"]), 5, r["errors"])                                   # balls, score, x of block 1, y of block 2, health of block 3
        text = " ".join(r["errors"]); [self.assertIn(w, text) for w in ("balls", "score", "block 1", "block 2", "block 3")]

    def test_the_limits_are_inclusive_and_exact(self):
        self.assertNotIn("errors", self.check({"balls": 1000, "blocks": [[60, 150, 1], [660, 1270, 99999]]}))
        for bad in ({"balls": 1001, "blocks": [[150, 420, 5]]}, {"blocks": [[59, 420, 5]]}, {"blocks": [[661, 420, 5]]}, {"blocks": [[150, 149, 5]]}, {"blocks": [[150, 1271, 5]]}, {"blocks": [[150, 420, 100000]]}):
            self.assertIn("errors", self.check(bad), bad)

    def test_whole_numbers_are_required_where_they_matter(self):
        for bad in ({"balls": 2.5, "blocks": [[150, 420, 5]]}, {"score": 1.5, "blocks": [[150, 420, 5]]}, {"blocks": [[150, 420, 2.5]]}, {"blocks": [[150, "420", 5]]}):
            self.assertIn("errors", self.check(bad), bad)
        self.assertNotIn("errors", self.check({"blocks": [[150.5, 420.25, 5]]}))            # positions may be fractional

    def test_overlapping_blocks_are_refused_and_named(self):
        r = self.check({"blocks": [[150, 420, 5], [200, 420, 5]]}); self.assertIn("blocks 1 and 2 overlap", r["errors"][0])
        self.assertNotIn("errors", self.check({"blocks": [[150, 420, 5], [265, 420, 5]]}))     # exactly 115 apart is allowed

    def test_empty_and_oversized_block_lists(self):
        self.assertIn("errors", self.check({"blocks": []})); self.assertIn("errors", self.check({"balls": 3}))
        many = [[60 + 120 * (i % 5), 200 + 130 * (i // 5), 1] for i in range(41)]
        self.assertIn("at most 40", " ".join(self.check({"blocks": many})["errors"]))

    def test_pickups_are_not_accepted_until_they_are_tested(self):
        self.assertIn("pickups", " ".join(self.check({"blocks": [[150, 420, 5]], "pickups": [[300, 500]]})["errors"]))
        self.assertNotIn("errors", self.check({"blocks": [[150, 420, 5]], "pickups": []}))

    def test_not_json_and_not_an_object(self):
        self.assertIn("not valid JSON", self.js("console.log(JSON.stringify(S.parse('{ balls: 3')))")["errors"][0])
        for bad in ("[]", "5", "null"): self.assertIn("errors", self.js(f"console.log(JSON.stringify(S.parse({json.dumps(bad)})))"))

    def test_turn_and_name_are_checked_and_trimmed(self):
        self.assertEqual(self.check({"blocks": [[150, 420, 5]], "turn": 30, "name": "x" * 200})["scene"]["turn"], 30)
        self.assertEqual(len(self.check({"blocks": [[150, 420, 5]], "name": "x" * 200})["scene"]["name"]), 80)
        self.assertIn("errors", self.check({"blocks": [[150, 420, 5]], "turn": 0}))


class Page(unittest.TestCase):
    def test_the_panel_and_script_are_on_the_watch_page(self):
        html = open(ROOT + "/web/play/index.html").read()
        for ident in ("scene-text", "scene-example", "scene-build", "scene-build-start", "scene-status"): self.assertIn(f'id="{ident}"', html)
        self.assertRegex(html, r'<script src="driver\.js"></script><script src="scene\.js"></script>')          # after driver.js, whose tapAt it uses
        self.assertRegex(html, r'id="scene-status"[^>]*aria-live="polite"')                                       # the result is announced, not only shown

    def test_the_page_part_writes_every_variable_the_game_needs(self):
        js = open(ROOT + "/web/play/scene.js").read()
        for name in ("ballStart", "ballEnd", "TotalBall", "score", "num", "hp"): self.assertIn(f'"{name}"', js)       # setting TotalBall alone launches ONE ball
        self.assertIn("pinObject", js)                                                                             # blocks are processed through their pinned label
        self.assertIn("instance_vars[1]", js); self.assertIn("instance_vars[2]", js)


if __name__ == "__main__":
    unittest.main()
