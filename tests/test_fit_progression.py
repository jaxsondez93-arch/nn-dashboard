"""tools/fit_progression.py, checked on made-up games built from the game's rules, whose true values are therefore known."""
import importlib.util, json, os, random, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("fit_progression", ROOT + "/tools/fit_progression.py"); fp = importlib.util.module_from_spec(spec); spec.loader.exec_module(fp)

OPENING = [(570, 1032), (83, 963), (236, 753), (502, 792), (627, 588), (628, 718)]
ROWS = {1: (1200, [(120, 600)]), 2: (1200, [(120, 260), (360, 600)]), 3: (1210, [(65, 217), (340, 400), (510, 657)])}


def synthetic_game(seed, turns, first_turn=1):
    """A game by the rules: an ordinary turn adds 1, 2 or 3 blocks, every 7th adds a pickup row with 1 block (and the pickup is collected at once, so a ball every 7 turns);
    new blocks have health 1 + floor(turn / 3); the player destroys 40% of the blocks each turn and wears the rest down (so 60% survive each turn)."""
    rng = random.Random(seed); blocks = [[x, y, 1] for x, y in OPENING]; balls, score, rows = 1, 0, []
    for t in range(1, turns + 1):
        rows.append({"game": 1, "turn": t + first_turn - 1, "score": score, "balls": balls,
                     "board": {"blocks": [[i + 1, round(b[0], 1), b[1], b[2]] for i, b in enumerate(blocks)], "pickups": [], "balls": balls, "turn": t}})
        kept = []
        for b in blocks:                                                     # each turn a block is destroyed with probability 0.4, otherwise it keeps a random 50-100% of its health
            if rng.random() < 0.4: score += 1
            else: b[2] = max(1, round(b[2] * rng.uniform(0.5, 1.0))); kept.append(b)
        blocks = kept
        for b in blocks: b[1] -= 126
        hp = 1 + (t + 1) // 3
        if (t + 1) % 7 == 0: balls += 1; blocks.append([rng.uniform(340, 600), 1200, hp])
        else:
            y, lanes = ROWS[rng.choice([1, 2, 3])]
            for lo, hi in lanes: blocks.append([rng.uniform(lo, hi), y, hp])
    return rows


def write(path, rows, extra=""):
    with open(path, "w") as f: f.write("".join(json.dumps(r) + "\n" for r in rows) + extra)


class Fit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(); cls.paths = []
        for k, turns in enumerate((600, 500, 40)):
            path = os.path.join(cls.dir, f"run-{k}.jsonl"); write(path, synthetic_game(k + 1, turns)); cls.paths.append(path)
        cls.games = fp.load_games(cls.paths, 20); cls.result = fp.fit(cls.games)

    def test_the_known_row_shares_come_back(self):
        got = self.result["check"]["row_shares"]["data"]
        for g, want in zip(got, (3 / 7, 2 / 7, 2 / 7)): self.assertAlmostEqual(g, want, delta=0.04)
        self.assertAlmostEqual(self.result["check"]["blocks_per_turn"]["data"], 13 / 7, delta=0.06)

    def test_the_health_rule_is_found_exact_and_the_positions_inside_their_ranges(self):
        hit, total = map(int, self.result["check"]["health_rule_1_plus_turn_div_3"]["data"].split("/")); self.assertEqual(hit, total)
        self.assertEqual(self.result["check"]["health_rule_1_plus_turn_div_3"]["games_needing_a_log_offset"], 0)
        for n, share in self.result["check"]["blocks_inside_the_rules_x_ranges"]["data"].items(): a, b = map(int, share.split("/")); self.assertEqual(a, b, n)
        a, b = map(int, self.result["check"]["three_block_rows_at_1210"]["data"].split("/")); self.assertEqual(a, b)

    def test_a_ball_every_seven_turns_is_measured_as_seven(self):
        self.assertAlmostEqual(self.result["fit"]["ball_period"], 7, delta=0.4)

    def test_the_known_survival_and_wear_come_back(self):
        b = self.result["board"]; alive = b["alive_per_row"]
        self.assertAlmostEqual(alive[0], 13 / 7, delta=0.15); self.assertEqual(b["health_left"][0], [1.0] * len(b["quantile_points"]))        # the newest row is whole
        for k in (1, 2, 3): self.assertAlmostEqual(alive[k] / alive[0], 0.6 ** k, delta=0.07)                                                   # 60% survive each turn
        middle = b["health_left"][1][b["quantile_points"].index(0.5)]; self.assertAlmostEqual(middle, 0.75, delta=0.12)                          # a survivor keeps 50-100%, median 75%
        self.assertTrue(all(alive[i] >= alive[i + 1] for i in range(len(alive) - 1)))

    def test_a_game_stored_twice_counts_once(self):
        copy = os.path.join(self.dir, "copy-of-run-0.jsonl"); write(copy, synthetic_game(1, 600))
        self.assertEqual(len(fp.load_games(self.paths + [copy], 20)), len(self.games))

    def test_games_below_the_minimum_are_left_out(self):
        self.assertEqual(len(self.games), 3); self.assertEqual(len(fp.load_games(self.paths, 100)), 2)       # the 40-turn game is dropped when 100 turns are asked for

    def test_a_half_written_last_line_is_ignored(self):
        path = os.path.join(self.dir, "partial.jsonl"); write(path, synthetic_game(9, 60), extra='{"game": 1, "turn": 61, "sco')
        g = fp.load_games([path], 20); self.assertEqual(len(g), 1); self.assertEqual(len(g[0]), 60)

    def test_a_log_numbered_one_turn_ahead_is_reported_not_hidden(self):
        path = os.path.join(self.dir, "offset.jsonl"); write(path, synthetic_game(5, 300, first_turn=2))     # its turn numbers run one ahead of the game's own
        r = fp.fit(fp.load_games([path], 20)); h = r["check"]["health_rule_1_plus_turn_div_3"]
        self.assertEqual(h["games_needing_a_log_offset"], 1); self.assertEqual(h["offsets"], [-1]); hit, total = map(int, h["data"].split("/")); self.assertEqual(hit, total)


if __name__ == "__main__":
    unittest.main()
