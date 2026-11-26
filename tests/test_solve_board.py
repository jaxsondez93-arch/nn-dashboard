"""tools/solve_board.js: brute force over the 781 aims with the shot simulator. Needs node and the physics engine (NN_ENGINE_DIR); skipped without them."""
import json, os, shutil, subprocess, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE, ENGINE = shutil.which("node"), os.environ.get("NN_ENGINE_DIR")
READY = bool(NODE and ENGINE and os.path.isfile(os.path.join(ENGINE or "", "box2d.js")))
OPENING = {"balls": 1, "blocks": [[570, 1032, 1], [83, 963, 1], [236, 753, 1], [502, 792, 1], [627, 588, 1], [628, 718, 1]]}       # the fixed opening board of the game


@unittest.skipUnless(READY, "needs node and NN_ENGINE_DIR")
class Solver(unittest.TestCase):
    def js(self, body):
        code = (f'const path=require("path"),fs=require("fs"); const S=require({json.dumps(ROOT + "/web/play/best/sim.js")}), T=require({json.dumps(ROOT + "/tools/solve_board.js")}), N=require({json.dumps(ROOT + "/web/play/best/search.js")}); '
                f'const dir={json.dumps(ENGINE)}, sim=S.createSimulator(require(dir+"/box2d.js"), require(dir+"/engine_constants.json")), pixels=JSON.parse(fs.readFileSync({json.dumps(ROOT + "/web/play/pixels781.json")},"utf8")).pixels; {body}')
        p = subprocess.run([NODE, "-e", code], capture_output=True, text=True, timeout=300); self.assertEqual(p.returncode, 0, p.stderr); return json.loads(p.stdout)

    def test_a_lone_weak_block_is_either_hit_or_missed_so_there_are_two_outcomes(self):
        r = self.js('const b = T.loadBoard({ balls: 1, blocks: [[360, 700, 1]] }); console.log(JSON.stringify(T.summarise(b, T.solve(sim, b, pixels, 8))))')
        self.assertTrue(r["best"]["cleared"]); self.assertEqual((r["distinctOutcomes"], r["totalHealth"], r["blocks"]), (2, 1, 1)); self.assertEqual(r["aimsTried"], 98)
        self.assertGreater(r["clearingAims"], 0); self.assertLess(r["clearingAims"], r["aimsTried"])                                          # some aims hit it, most miss

    def test_the_solver_agrees_with_the_searchs_own_outcome_function_on_every_aim(self):
        r = self.js('''const raw = { balls: 2, blocks: [[200, 600, 2], [500, 700, 3], [350, 900, 1]] }, b = T.loadBoard(raw), rows = T.solve(sim, b, pixels, 37), bad = [];
          for (const x of rows) { const o = N.outcome(sim, { blocks: b.blocks, pickups: b.pickups, balls: b.balls }, pixels[x.aim]); if (o.damage !== x.damage || o.got !== x.got || o.completed !== x.completed) bad.push([x.aim, x.damage, o.damage]); } console.log(JSON.stringify({ n: rows.length, bad }))''')
        self.assertEqual((r["n"] > 15, r["bad"]), (True, []))

    def test_a_logged_turn_and_a_scene_describe_the_same_board_the_same_way(self):
        r = self.js('''const a = T.loadBoard({ balls: 3, blocks: [[200, 600, 2], [500, 700, 3]] }), b = T.loadBoard({ board: { balls: 3, blocks: [[9, 200, 600, 2], [4, 500, 700, 3]], pickups: [] } });
          console.log(JSON.stringify([a.blocks.length, b.blocks.length, a.balls, b.balls, b.blocks.map((k) => k[3])]))''')
        self.assertEqual(r[:4], [2, 2, 3, 3]); self.assertEqual(r[4], [3, 2])                                                                   # a logged board is ordered by its own uids: 4 before 9

    def test_the_opening_board_can_be_cleared_by_one_ball_and_only_a_few_aims_do_it(self):
        r = self.js('const b = T.loadBoard(' + json.dumps(OPENING) + '); console.log(JSON.stringify(T.summarise(b, T.solve(sim, b, pixels, 1))))')
        self.assertEqual((r["totalHealth"], r["aimsTried"], r["simulationsThatHitTheStepLimit"]), (6, 781, 0))
        self.assertTrue(r["best"]["cleared"]); self.assertEqual(r["clearingAims"], 4); self.assertIn([354, 296], r["best"]["examples"])             # one of them is the aim the bot played on its first shot
        self.assertEqual(r["distinctOutcomes"], 37)                                                                                                # 781 aims collapse into 37 different results


if __name__ == "__main__":
    unittest.main()
