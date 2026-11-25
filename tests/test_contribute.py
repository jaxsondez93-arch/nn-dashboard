"""The volunteer page and its checking tools. The tests that simulate shots need Node and the engine files (NN_ENGINE_DIR); they are skipped otherwise."""
import glob, json, os, re, shutil, subprocess, sys, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE, ENGINE = shutil.which("node"), os.environ.get("NN_ENGINE_DIR")
C = os.path.join(ROOT, "web/contribute")
read = lambda *p: open(os.path.join(*p), encoding="utf-8").read()


def node(code):
    r = subprocess.run([NODE, "-e", code], capture_output=True, text=True, timeout=300)
    if r.returncode: raise AssertionError(r.stderr)
    return json.loads(r.stdout)


class Page(unittest.TestCase):
    def test_exactly_one_consent_box_and_it_says_what_happens(self):
        html = read(C, "index.html"); self.assertEqual(len(re.findall(r'type="checkbox"', html)), 1)
        for phrase in ("compute training data", "neural network", "automatically", "battery", "untick"): self.assertIn(phrase, html)

    def test_no_results_are_shown_or_editable(self):
        html, js = read(C, "index.html"), read(C, "contribute.js")
        for bad in ('id="list"', "Copy JSON", "Download them", "Submit all"): self.assertNotIn(bad, html + js)

    def test_strict_policy_and_no_inline_script(self):
        html = read(C, "index.html"); self.assertIn("default-src 'none'", html); self.assertIn("connect-src 'self' https://script.google.com https://script.googleusercontent.com", html)
        self.assertEqual(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html), [])

    def test_results_can_only_go_to_a_google_script_and_nothing_runs_without_one(self):
        js = read(C, "contribute.js"); self.assertIn(r"/^https:\/\/script\.google\.com\//.test", js); self.assertIn('$("consent").disabled = true', js)
        self.assertEqual(json.loads(read(C, "collector.json")).keys(), {"endpoint"})

    def test_boards_file_is_training_data_shaped(self):
        d = json.loads(read(C, "boards.json")); self.assertEqual(len(d["boards"]), 896)
        for b in d["boards"][:50]: self.assertEqual(set(b), {"b", "p", "n", "t", "done"}); self.assertTrue(all(len(x) == 4 for x in b["b"]))
        self.assertNotRegex(read(C, "boards.json"), r"events\.jsonl|night_")


@unittest.skipUnless(NODE, "node not installed")
class Tasks(unittest.TestCase):
    def test_units_cover_every_unlabelled_aim_exactly_once(self):
        got = node(f'''const T=require({json.dumps(C + "/tasks.js")}); const boards=[{{done:[0,1,2]}},{{done:Array.from({{length:781}},(_,i)=>i)}},{{done:[5]}}]; const u=T.listUnits(boards), seen=boards.map(()=>[]);
            u.forEach(([k,s])=>seen[k].push(...T.aimsOf(boards[k],s))); console.log(JSON.stringify({{units:u.length, per:seen.map(a=>[a.length,new Set(a).size]), max:Math.max(...u.map(([k,s])=>T.aimsOf(boards[k],s).length))}}))''')
        self.assertEqual(got["per"], [[778, 778], [0, 0], [780, 780]]); self.assertEqual(got["max"], 40); self.assertEqual(got["units"], 40)

    def test_real_task_list_size(self):
        got = node(f'const T=require({json.dumps(C + "/tasks.js")}); const d=require({json.dumps(C + "/boards.json")}); const u=T.listUnits(d.boards); console.log(JSON.stringify([u.length, u.reduce((a,[k,s])=>a+T.aimsOf(d.boards[k],s).length,0)]))')
        self.assertEqual(got[1], 612308); self.assertGreater(got[0], 15000)


@unittest.skipUnless(NODE and ENGINE and os.path.isfile(os.path.join(ENGINE or "", "box2d.js")), "needs node and NN_ENGINE_DIR")
class Checking(unittest.TestCase):
    def test_good_results_are_accepted_altered_ones_rejected_and_imported(self):
        made = node(f'''const T=require({json.dumps(C + "/tasks.js")}), S=require({json.dumps(ROOT + "/web/play/best/sim.js")}), E={json.dumps(ENGINE)};
            const sim=S.createSimulator(require(E+"/box2d.js"), require(E+"/engine_constants.json")), d=require({json.dumps(C + "/boards.json")}), px=require({json.dumps(ROOT + "/web/play/pixels781.json")}).pixels, u=T.listUnits(d.boards);
            const one=u.findIndex(([k])=>d.boards[k].n===1&&!d.boards[k].p.length), two=u.findIndex(([k],i)=>i>one+40&&d.boards[k].n===1&&!d.boards[k].p.length);
            const run=(i)=>{{const [k,s]=u[i], r=T.aimsOf(d.boards[k],s).map(a=>T.simulateAim(sim,d.boards[k],px[a])); return {{u:i,d:r.map(x=>x[0]),m:r.map(x=>x[1])}}}}; console.log(JSON.stringify([run(one),run(two)]))''')
        good, other = made; bad = dict(other, d=[x + 1 for x in other["d"]]); t = tempfile.mkdtemp()
        csv = '"2026-01-01","' + json.dumps(good).replace('"', '""') + '"\n' + json.dumps(bad) + "\n" + json.dumps(good) + "\n{not json}\n"
        open(t + "/r.csv", "w").write(csv); r = subprocess.run([NODE, ROOT + "/tools/check_results.js", t + "/r.csv", "--sample", "0", "--out", t + "/v.jsonl"], capture_output=True, text=True, timeout=300)
        self.assertEqual(r.returncode, 0, r.stderr); self.assertIn("received 4: accepted 1 units (40 shots), rejected 2, repeats 1", r.stdout)
        json.dump([f"board-{i}" for i in range(896)], open(t + "/map.json", "w"))
        p = subprocess.run([sys.executable, "-B", ROOT + "/tools/import_labels.py", t + "/v.jsonl", t + "/map.json", t + "/labels"], capture_output=True, text=True, timeout=60); self.assertEqual(p.returncode, 0, p.stderr)
        import numpy as np
        z = np.load(glob.glob(t + "/labels/*.npz")[0]); self.assertEqual(len(z["aim_idx"]), 40); self.assertEqual(z["hp"].tolist(), [float(x) for x in good["d"]])


if __name__ == "__main__":
    unittest.main()
