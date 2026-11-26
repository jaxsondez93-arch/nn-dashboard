"""The "Build a puzzle" panel: the scene checks and the fill-in-the-rest rule (pure code, so tested without a page), and that the page wires the panel up."""
import json, math, os, shutil, subprocess, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")
with open(ROOT + "/web/play/progression.json") as _f: DATA = json.load(_f)
FIT = DATA["fit"]


def turn_from_score(s): return (s - FIT["score_intercept"]) / FIT["score_slope"]
def turn_from_balls(b): return FIT["ball_start_turn"] + FIT["ball_period"] * (b - 1)
def turn_from_health(h): return 3 * (h - 1) + 1
def js_round(x): return math.floor(x + 0.5)                       # JavaScript rounds .5 up; Python rounds it to the even number


@unittest.skipUnless(NODE, "node not installed")
class Base(unittest.TestCase):
    def js(self, body):
        code = f'const S=require({json.dumps(ROOT + "/web/play/scene.js")}); const DATA={json.dumps(DATA)}; {body}'
        p = subprocess.run([NODE, "-e", code], capture_output=True, text=True, timeout=120); self.assertEqual(p.returncode, 0, p.stderr); return json.loads(p.stdout)

    def check(self, scene):
        return self.js(f"console.log(JSON.stringify(S.validate({json.dumps(scene)})))")

    def complete(self, partial, data=True):
        return self.js(f"console.log(JSON.stringify(S.complete({json.dumps(partial)}, {'DATA' if data else 'null'})))")


class Validate(Base):
    def test_the_example_is_valid_and_comes_back_in_one_shape(self):
        r = self.js("console.log(JSON.stringify(S.parse(S.EXAMPLE_TEXT)))")
        self.assertNotIn("errors", r); s = r["scene"]
        self.assertEqual((s["balls"], s["score"], len(s["blocks"]), s["pickups"]), (12, 0, 5, [])); self.assertEqual(s["blocks"][0], [1, 150, 420, 30])      # [id, x, y, health]

    def test_three_four_and_named_block_forms_all_work(self):
        r = self.check({"balls": 3, "blocks": [[150, 420, 5], [9, 400, 420, 6], {"x": 280, "y": 700, "hp": 7}]})
        self.assertEqual([b[1:] for b in r["scene"]["blocks"]], [[150, 420, 5], [400, 420, 6], [280, 700, 7]])

    def test_a_scene_checked_on_its_own_defaults_balls_and_score(self):
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
        for bad in ({"balls": 2.5, "blocks": [[150, 420, 5]]}, {"score": 1.5, "blocks": [[150, 420, 5]]}, {"blocks": [[150, 420, 2.5]]}, {"blocks": [[150, "420", 5]]}, {"health": 0, "blocks": [[150, 420, 5]]}):
            self.assertIn("errors", self.check(bad), bad)
        self.assertNotIn("errors", self.check({"blocks": [[150.5, 420.25, 5]]}))            # positions may be fractional

    def test_the_score_has_no_upper_limit_but_must_be_a_whole_number(self):
        for score in (38, 10**9, 10**9 + 1, 10**15, 10**21, 10**30):
            r = self.check({"score": score, "blocks": [[150, 420, 5]]}); self.assertNotIn("errors", r, score); self.assertEqual(float(r["scene"]["score"]), float(score))
        for bad in (1.5, -1, float("inf"), float("nan"), "12", True):
            self.assertIn("errors", self.check({"score": bad, "blocks": [[150, 420, 5]]}), bad)

    def test_overlapping_blocks_are_refused_and_named(self):
        r = self.check({"blocks": [[150, 420, 5], [200, 420, 5]]}); self.assertIn("blocks 1 and 2 overlap", r["errors"][0])
        self.assertNotIn("errors", self.check({"blocks": [[260, 420, 5], [360, 420, 5]]}))     # exactly 100 apart: the game's own two-block rows can be this close
        self.assertIn("errors", self.check({"blocks": [[260, 420, 5], [359, 420, 5]]}))

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

    def test_turn_health_and_name_are_checked_and_trimmed(self):
        s = self.check({"blocks": [[150, 420, 5]], "turn": 30, "health": 11, "name": "x" * 200})["scene"]; self.assertEqual((s["turn"], s["health"], len(s["name"])), (30, 11, 80))
        self.assertIn("errors", self.check({"blocks": [[150, 420, 5]], "turn": 0}))


class FillInTheRest(Base):
    """The rule: whatever is entered is kept exactly; only empty things are filled; several numbers entered -> the empty ones follow the average of what each points to."""

    def test_nothing_you_enter_is_ever_changed(self):
        entered = {"score": 1000, "balls": 1, "health": 2, "turn": 29}            # deliberately inconsistent with one another
        for k in range(1, 5):
            for combo in __import__("itertools").combinations(entered, k):
                partial = {key: entered[key] for key in combo}; r = self.complete(partial)
                self.assertNotIn("errors", r, partial)
                for key in combo: self.assertEqual(r["scene"][key], entered[key], (partial, key))
                self.assertEqual(sorted(r["kept"]), sorted(combo))
                self.assertEqual(sorted(x["field"] for x in r["filled"]), sorted({"turn", "score", "balls", "health", "blocks"} - set(combo)))      # exactly the empty ones were filled

    def test_a_very_high_score_is_kept_and_what_is_filled_in_stops_at_the_limits(self):
        for score in (10**7, 10**15, 10**21):
            r = self.complete({"score": score}); self.assertNotIn("errors", r, score); s = r["scene"]
            self.assertEqual(float(s["score"]), float(score))                                                       # the score you typed is never capped
            self.assertEqual((s["balls"], s["health"]), (1000, 99999))                                              # what a game that far in would have is more than can be built
            self.assertEqual(sorted(x["field"] for x in r["filled"] if x.get("limited")), ["balls", "health"])      # and the page says it was capped
            self.assertTrue(all(1 <= b[3] <= 99999 for b in s["blocks"]))
        r = self.complete({"score": 10**7, "balls": 5}); self.assertEqual((r["scene"]["balls"], r["scene"]["health"]), (5, 99999))     # your own ball count is kept
        r = self.complete({"score": 3824}); self.assertFalse(any(x.get("limited") for x in r["filled"])); self.assertLess(r["scene"]["balls"], 1000)   # an ordinary late game is not capped

    def test_blocks_you_enter_are_kept_exactly_and_the_numbers_still_get_filled(self):
        blocks = [[1, 150, 420, 30], [2, 480, 420, 12], [3, 320, 640, 60]]
        r = self.complete({"blocks": blocks}); self.assertEqual(r["scene"]["blocks"], blocks)
        self.assertEqual([x["field"] for x in r["filled"] if x["field"] != "blocks"][:1], ["turn"]); self.assertNotIn("blocks", [x["field"] for x in r["filled"]])

    def test_one_number_fills_the_rest_from_that_numbers_own_turn(self):
        for score in (38, 5, 400, 3824):
            T = max(1, turn_from_score(score)); r = self.complete({"score": score}); s = r["scene"]
            self.assertEqual(s["score"], score); self.assertEqual(s["turn"], js_round(T))
            self.assertEqual(s["balls"], max(1, js_round(1 + max(0, T - FIT["ball_start_turn"]) / FIT["ball_period"])))
            self.assertEqual(s["health"], 1 + js_round(T) // 3)
            self.assertEqual(len(r["estimates"]), 1)

    def test_a_ball_count_or_a_health_alone_works_the_same_way(self):
        r = self.complete({"balls": 5}); self.assertEqual(r["scene"]["turn"], js_round(turn_from_balls(5)))
        r = self.complete({"health": 13}); self.assertEqual(r["scene"]["turn"], js_round(turn_from_health(13))); self.assertEqual(r["scene"]["health"], 13)
        r = self.complete({"turn": 100}); self.assertEqual(r["scene"]["turn"], 100); self.assertEqual(r["scene"]["health"], 34)

    def test_two_numbers_make_the_empty_ones_follow_their_average(self):
        r = self.complete({"score": 38, "health": 13}); s = r["scene"]
        T = (turn_from_score(38) + turn_from_health(13)) / 2
        self.assertEqual((s["score"], s["health"]), (38, 13))                                  # yours, untouched
        self.assertEqual(s["turn"], js_round(T))
        self.assertEqual(s["balls"], max(1, js_round(1 + max(0, T - FIT["ball_start_turn"]) / FIT["ball_period"])))
        self.assertEqual(len(r["estimates"]), 2); self.assertAlmostEqual(r["turn"], T, places=6)
        alone = self.complete({"score": 38})["scene"]["balls"]; self.assertGreater(s["balls"], alone)       # health 13 points to a later turn than score 38, so the balls follow it up

    def test_three_numbers_average_all_three(self):
        r = self.complete({"score": 38, "balls": 5, "health": 13})
        T = (turn_from_score(38) + turn_from_balls(5) + turn_from_health(13)) / 3
        self.assertAlmostEqual(r["turn"], T, places=6); self.assertEqual(r["scene"]["turn"], js_round(T))

    def test_the_strongest_block_stands_in_for_a_number_only_when_none_was_entered(self):
        r = self.complete({"blocks": [[150, 420, 30], [480, 420, 12]]}); self.assertEqual([e["field"] for e in r["estimates"]], ["the strongest block"])
        self.assertAlmostEqual(r["turn"], turn_from_health(30), places=6)
        r = self.complete({"blocks": [[150, 420, 30]], "health": 4}); self.assertEqual([e["field"] for e in r["estimates"]], ["health"])      # a number you typed decides; the blocks do not dilute it
        r = self.complete({"blocks": [[150, 420, 5]], "balls": 12}); self.assertEqual([e["field"] for e in r["estimates"]], ["balls"])

    def test_a_thousand_balls_gives_the_score_of_a_game_that_far_in_however_it_is_entered(self):
        T = turn_from_balls(1000); want = js_round(FIT["score_slope"] * T + FIT["score_intercept"]); self.assertGreater(want, 7000)         # about 13,000: 1000 balls is turn 7100
        weak_block = {"balls": 1000, "blocks": [[150, 420, 5]]}                                                  # a weak block must not drag the score down
        example_with_1000 = dict(self.js("console.log(JSON.stringify(S.EXAMPLE))"), balls=1000)     # the example, with its balls changed
        for partial in ({"balls": 1000}, weak_block, example_with_1000):
            self.assertEqual(self.complete(partial)["scene"]["score"], want, partial)

    def test_the_example_leaves_the_score_to_be_filled_in_and_a_typed_zero_is_still_kept(self):
        example = self.js("console.log(JSON.stringify(JSON.parse(S.EXAMPLE_TEXT)))"); self.assertNotIn("score", example)          # a written score would count as entered, and be kept
        r = self.complete(example); self.assertGreater(r["scene"]["score"], 0); self.assertIn("score", [x["field"] for x in r["filled"]])     # so the score follows the balls
        self.assertEqual(r["scene"]["balls"], 12); self.assertEqual([b[1:] for b in r["scene"]["blocks"]], [b for b in example["blocks"]])        # the blocks you wrote are kept exactly
        self.assertEqual(self.complete({"score": 0, "balls": 1000})["scene"]["score"], 0)                          # but a zero you type yourself is yours

    def test_nothing_to_go_on_is_an_error(self):
        self.assertIn("at least one", " ".join(self.complete({})["errors"])); self.assertIn("at least one", " ".join(self.complete({"name": "x", "score": ""})["errors"]))
        self.assertIn("at least one", " ".join(self.complete({"score": None, "balls": ""})["errors"]))               # empty means empty, not zero

    def test_wrong_kinds_of_value_are_reported_not_fixed(self):
        for bad in ({"score": 3.5}, {"balls": 0}, {"health": 0}, {"turn": -3}, {"balls": "abc"}, {"score": -1}):
            r = self.complete(bad); self.assertIn("errors", r, bad)

    def test_the_numbers_a_game_has_still_loading_is_said_plainly(self):
        self.assertIn("loading", " ".join(self.complete({"score": 38}, data=False)["errors"]))
        self.assertNotIn("errors", self.complete({"balls": 2, "blocks": [[150, 420, 5]]}, data=False))             # a scene that is already complete needs no data

    def test_the_same_input_gives_the_same_board_and_another_seed_a_different_one(self):
        a, b = self.complete({"score": 200}), self.complete({"score": 200}); self.assertEqual(a["scene"]["blocks"], b["scene"]["blocks"])
        c = self.complete({"score": 200, "seed": a["scene"]["seed"] + 1}); self.assertNotEqual(a["scene"]["blocks"], c["scene"]["blocks"])
        self.assertEqual((a["scene"]["score"], a["scene"]["balls"], a["scene"]["health"]), (c["scene"]["score"], c["scene"]["balls"], c["scene"]["health"]))      # only the layout changes

    def test_turn_one_is_the_games_fixed_opening_board(self):
        s = self.complete({"turn": 1})["scene"]; self.assertEqual([b[1:3] for b in s["blocks"]], sorted([[b[0], b[1]] for b in [[570, 1032], [83, 963], [236, 753], [502, 792], [627, 588], [628, 718]]], key=lambda p: (-p[1], p[0])))
        self.assertTrue(all(b[3] == 1 for b in s["blocks"]))


class GeneratedBoards(Base):
    """The boards are made from the game's own rules (where blocks appear, how health grows) and from how real play thins and wears blocks."""

    def boards(self, turn, seeds, **extra):
        base = json.dumps({"turn": turn, **extra})
        return self.js(f"const out=[]; for (let seed=1; seed<={seeds}; seed++) {{ const r=S.complete(Object.assign({base}, {{seed}}), DATA); out.push(r.scene || r); }} console.log(JSON.stringify(out));")

    def test_every_generated_board_passes_the_scene_checks(self):
        for turn in (2, 3, 9, 30, 100, 400):
            for s in self.boards(turn, 60): self.assertNotIn("errors", s, (turn, s)); self.assertGreaterEqual(len(s["blocks"]), 1)

    def test_blocks_sit_where_the_rules_put_new_blocks(self):
        for s in self.boards(80, 100):
            for _, x, y, hp in s["blocks"]:
                self.assertIn(round((y - 66) % 126), (0, 10, 126), (x, y))                        # rows appear at 1200 or 1210 and rise 126 a turn: y mod 126 is 66 or 76
                self.assertTrue(65 <= x <= 657, x); self.assertGreaterEqual(hp, 1)

    def test_the_newest_row_is_undamaged_at_exactly_the_health_level(self):
        for s in self.boards(60, 100):
            newest = [b for b in s["blocks"] if b[2] >= 1195]; self.assertTrue(newest); self.assertTrue(all(b[3] == s["health"] for b in newest), s)
        self.assertEqual({b[3] for s in self.boards(60, 5, health=40) for b in s["blocks"] if b[2] >= 1195}, {40})              # the level you enter is the level used

    def test_row_sizes_follow_the_rules_in_the_long_run(self):
        sizes = {1: 0, 2: 0, 3: 0}
        for s in self.boards(60, 800):
            n = len([b for b in s["blocks"] if b[2] >= 1195]); sizes[n] += 1
        total = sum(sizes.values()); shares = [sizes[n] / total for n in (1, 2, 3)]
        for got, want in zip(shares, DATA["check"]["row_shares"]["code"]): self.assertAlmostEqual(got, want, delta=0.05)    # 3/7, 2/7, 2/7

    def test_older_blocks_are_fewer_and_weaker(self):
        by_age, left = {k: 0 for k in range(6)}, {k: [] for k in range(6)}
        for s in self.boards(100, 400):
            for _, x, y, hp in s["blocks"]:
                for k in range(6):
                    if round(1200 - 126 * k - y) in (0, -10, 10):
                        by_age[k] += 1; left[k].append(hp / s["health"] if s["health"] else 1)
        self.assertTrue(all(by_age[k] > by_age[k + 1] for k in range(5)), by_age)
        self.assertGreater(sum(left[0]) / len(left[0]), sum(left[3]) / len(left[3]))


class ProgressionFile(unittest.TestCase):
    def test_the_measured_numbers_agree_with_the_games_rules(self):
        c = DATA["check"]
        for got, want in zip(c["row_shares"]["data"], c["row_shares"]["code"]): self.assertAlmostEqual(got, want, delta=0.02)
        self.assertAlmostEqual(c["blocks_per_turn"]["data"], 13 / 7, delta=0.03); self.assertAlmostEqual(FIT["score_slope"], 13 / 7, places=5)
        self.assertGreaterEqual(FIT["ball_period"], 7.0); self.assertLess(FIT["ball_period"], 7.5)                    # 7 is the best the rules allow; the bot is a little slower
        hit, total = map(int, c["health_rule_1_plus_turn_div_3"]["data"].split("/")); self.assertGreater(hit / total, 0.98)
        self.assertGreaterEqual(DATA["provenance"]["games"], 8); self.assertGreater(DATA["provenance"]["turns"], 4000)

    def test_the_wear_tables_are_well_formed(self):
        b = DATA["board"]; self.assertEqual(len(b["alive_per_row"]), b["max_age"] + 1); self.assertEqual(len(b["health_left"]), b["max_age"] + 1)
        self.assertTrue(all(b["alive_per_row"][i] >= b["alive_per_row"][i + 1] for i in range(b["max_age"])))        # fewer blocks survive the older the row
        for q in b["health_left"]:
            self.assertEqual(len(q), len(b["quantile_points"])); self.assertTrue(all(q[i] <= q[i + 1] for i in range(len(q) - 1))); self.assertTrue(all(0 <= v <= 1 for v in q))
        self.assertAlmostEqual(b["alive_per_row"][0], 13 / 7, delta=0.05)                                              # the newest row is whole


class Page(unittest.TestCase):
    def test_the_panel_and_script_are_on_the_watch_page(self):
        with open(ROOT + "/web/play/index.html") as f: html = f.read()
        for ident in ("scene-text", "scene-score", "scene-balls", "scene-health", "scene-turn", "scene-fill", "scene-another", "scene-example", "scene-build", "scene-build-start", "scene-status"): self.assertIn(f'id="{ident}"', html)
        self.assertRegex(html, r'<script src="driver\.js"></script><script src="scene\.js"></script>')          # after driver.js, whose tapAt it uses
        self.assertRegex(html, r'id="scene-status"[^>]*aria-live="polite"')                                       # the result is announced, not only shown
        self.assertIn('placeholder="auto"', html)                                                                  # an empty number box says it will be filled in

    def test_the_page_part_writes_every_variable_the_game_needs(self):
        with open(ROOT + "/web/play/scene.js") as f: js = f.read()
        for name in ("ballStart", "ballEnd", "TotalBall", "score", "num", "hp", "color", "jump", "power"): self.assertIn(f'"{name}"', js)    # setting TotalBall alone launches ONE ball
        self.assertIn("pinObject", js)                                                                             # blocks are processed through their pinned label
        self.assertIn("instance_vars[1]", js); self.assertIn("instance_vars[2]", js)
        self.assertIn("progression.json", js)


if __name__ == "__main__":
    unittest.main()
