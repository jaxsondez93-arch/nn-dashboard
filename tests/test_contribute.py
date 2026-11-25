"""The volunteer page and its checking tools. The tests that simulate shots need Node and the engine files (NN_ENGINE_DIR); they are skipped otherwise."""
import base64, gzip
import glob, json, os, re, shutil, subprocess, sys, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE, ENGINE = shutil.which("node"), os.environ.get("NN_ENGINE_DIR")
C = os.path.join(ROOT, "web/contribute")
sys.path.insert(0, os.path.join(ROOT, "tools"))
import collect
read = lambda *p: open(os.path.join(*p), encoding="utf-8").read()


def node(code):
    r = subprocess.run([NODE, "-e", code], capture_output=True, text=True, timeout=300)
    if r.returncode: raise AssertionError(r.stderr)
    return json.loads(r.stdout)


class Page(unittest.TestCase):
    def test_exactly_one_consent_box_and_it_says_what_happens(self):
        html = read(C, "index.html"); self.assertEqual(len(re.findall(r'id="consent"', html)), 1); self.assertNotRegex(html, r'id="consent"[^>]*checked')
        self.assertEqual(len(re.findall(r'type="checkbox"', html)), 5, "one consent box plus four safety switches")
        for phrase in ("compute training data", "neural network", "automatically", "battery", "untick"): self.assertIn(phrase, html)

    def test_no_results_are_shown_or_editable(self):
        html, js = read(C, "index.html"), read(C, "contribute.js")
        for bad in ('id="list"', "Copy JSON", "Download them", "Submit all"): self.assertNotIn(bad, html + js)

    def test_strict_policy_and_no_inline_script(self):
        html = read(C, "index.html"); self.assertIn("default-src 'none'", html); self.assertIn("connect-src 'self' https://ntfy.sh https://script.google.com https://script.googleusercontent.com", html)
        self.assertEqual(re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html), [])

    def test_results_can_only_go_to_the_allowed_receivers_and_nothing_runs_without_one(self):
        js = read(C, "contribute.js"); self.assertIn(r"ntfy\.sh\/[A-Za-z0-9_-]{10,}$|script\.google\.com", js); self.assertIn('$("consent").disabled = true', js)
        self.assertRegex(json.loads(read(C, "collector.json"))["endpoint"], r"^(https://ntfy\.sh/[A-Za-z0-9_-]{10,}|https://script\.google\.com/.*|)$")
        self.assertIn("ntfy.sh", read(C, "index.html"), "the page must name the relay the results go through")
        self.assertEqual(json.loads(read(C, "collector.json")).keys(), {"endpoint"})

    def test_boards_file_is_training_data_shaped(self):
        d = json.loads(read(C, "boards.json")); self.assertEqual(len(d["boards"]), 896)
        for b in d["boards"][:50]: self.assertEqual(set(b), {"b", "p", "n", "t", "done"}); self.assertTrue(all(len(x) == 4 for x in b["b"]))
        self.assertNotRegex(read(C, "boards.json"), r"events\.jsonl|night_")


class Collector(unittest.TestCase):
    def test_only_well_formed_results_are_kept(self):
        ok = {"u": 3, "d": [1, 2], "m": [100, None]}
        msg = json.dumps({"v": 3, "results": [ok, {"u": -1, "d": [1], "m": [1]}, {"u": 1, "d": [1, 2], "m": [1]}, {"u": 1, "d": ["x"], "m": [1]}, "junk"], "extra": 1})
        self.assertEqual(collect.results_in(msg), [ok])
        for bad in ("", "not json", "[]", json.dumps({"v": 2, "results": [ok]}), json.dumps({"v": 3, "results": "x"})): self.assertEqual(collect.results_in(bad), [])


@unittest.skipUnless(NODE, "node not installed")
class Outbox(unittest.TestCase):
    def js(self, body):
        return node(f'const O=require({json.dumps(C + "/outbox.js")}); (async()=>{{ {body} }})()')

    QUEUE = "const q=Array.from({length:300},(_,i)=>({u:i*7,d:Array.from({length:40},(_,k)=>(i*k)%23),m:Array.from({length:40},(_,k)=>k%5?100+(i+k*37)%900:null)}));"

    def test_compressed_message_fits_and_the_collector_reads_it_back_exactly(self):
        got = self.js(self.QUEUE + "const a=await O.pack(q,true); console.log(JSON.stringify({count:a.count,body:a.body,sent:q.slice(0,a.count),plain:(await O.pack(q,false)).count}))")
        self.assertLessEqual(len(got["body"]), 3800); self.assertEqual(collect.results_in(got["body"]), got["sent"]); self.assertGreater(got["count"], 2 * got["plain"])

    def test_uncompressed_form_still_works(self):
        got = self.js(self.QUEUE + "const a=await O.pack(q,false); console.log(JSON.stringify({body:a.body,sent:q.slice(0,a.count)}))")
        self.assertLessEqual(len(got["body"]), 3800); self.assertEqual(collect.results_in(got["body"]), got["sent"])

    def test_a_single_waiting_task_is_sent(self):
        self.assertEqual(self.js("console.log((await O.pack([{u:1,d:[2],m:[3]}],true)).count)"), 1)

    def test_when_the_next_message_may_go(self):
        got = self.js("const s=(o)=>O.due(Object.assign({queued:1,now:1e6,lastTry:0,lastSend:0,blockedUntil:0},o)); console.log(JSON.stringify([s({}), s({queued:0}), s({lastTry:1e6-19000}), s({lastTry:1e6-30000,lastSend:1e6-30000}), s({queued:80,lastTry:1e6-21000,lastSend:1e6-21000}), s({lastTry:1e6-46000,lastSend:1e6-46000}), s({blockedUntil:1e6+1})]))")
        self.assertEqual(got, [True, False, False, False, True, True, False])

    def test_work_pauses_on_a_full_backlog_and_resumes_when_it_drains(self):
        got = self.js("console.log(JSON.stringify([O.hold(false,599), O.hold(false,600), O.hold(true,301), O.hold(true,300)]))")
        self.assertEqual(got, [False, True, True, False])

    def test_the_whole_backlog_is_saved(self):
        self.assertIn("JSON.stringify(queue));", read(C, "contribute.js")); self.assertNotIn("queue.slice(-", read(C, "contribute.js"))


class Compressed(unittest.TestCase):
    def pack(self, data):
        return json.dumps({"v": 4, "z": base64.b64encode(gzip.compress(data)).decode()})

    def test_good_message(self):
        ok = {"u": 5, "d": [1, 2], "m": [3, None]}
        self.assertEqual(collect.results_in(self.pack(json.dumps({"v": 3, "results": [ok]}).encode())), [ok])

    def test_hostile_or_broken_messages_are_ignored(self):
        bomb = self.pack(b'{"v":3,"results":[],"x":"' + b"a" * 1_000_000 + b'"}'); deep = self.pack(b"[" * 100_000)
        for bad in (bomb, deep, self.pack(b"not json"), json.dumps({"v": 4}), json.dumps({"v": 4, "z": "@@@"}), json.dumps({"v": 4, "z": base64.b64encode(b"plain").decode()}), "[" * 4000):
            self.assertEqual(collect.results_in(bad), [])


@unittest.skipUnless(NODE, "node not installed")
class Power(unittest.TestCase):
    def plan(self, pct, cores, **o):
        return node(f'const P=require({json.dumps(C + "/power.js")}); console.log(JSON.stringify(P.plan({pct}, {cores}, {json.dumps(o)})))')

    def test_safety_switches_start_on_and_slider_runs_1_to_100(self):
        html = read(C, "index.html")
        for i in ("g-heat", "g-stable", "g-battery", "g-time"): self.assertRegex(html, f'id="{i}" checked')
        self.assertRegex(html, r'id="power" min="1" max="100"'); self.assertIn("window.confirm", read(C, "contribute.js"))

    def test_one_percent_is_one_barely_busy_worker(self):
        p = self.plan(1, 8); self.assertEqual(p["workers"], 1); self.assertAlmostEqual(p["duty"], 0.08); self.assertAlmostEqual(p["percent"], 1)

    def test_share_is_across_all_cores(self):
        p = self.plan(50, 8); self.assertEqual((p["workers"], p["duty"]), (4, 1)); p = self.plan(35, 8); self.assertEqual(p["workers"], 3); self.assertAlmostEqual(p["workers"] * p["duty"], 2.8)

    def test_heat_protection_caps_at_half(self):
        p = self.plan(100, 8); self.assertAlmostEqual(p["percent"], 50); self.assertTrue(any("heat" in w for w in p["why"]))

    def test_everything_off_uses_every_core_fully(self):
        p = self.plan(100, 8, heat=False, stability=False); self.assertEqual((p["workers"], p["duty"], p["percent"], p["why"]), (8, 1, 100, []))

    def test_stability_keeps_a_core_free_and_limits_phones(self):
        self.assertEqual(self.plan(100, 4, heat=False)["workers"], 3); self.assertEqual(self.plan(100, 12, heat=False, phone=True)["workers"], 4); self.assertEqual(self.plan(100, 32, heat=False)["workers"], 8); self.assertEqual(self.plan(100, 1, heat=False)["workers"], 1)

    def test_easing_only_acts_with_heat_protection(self):
        self.assertAlmostEqual(self.plan(40, 10, ease=0.5)["percent"], 20); self.assertAlmostEqual(self.plan(40, 10, ease=0.5, heat=False)["percent"], 40); self.assertAlmostEqual(self.plan(40, 10, ease=0.01)["percent"], 10)

    def test_odd_inputs_are_clamped(self):
        self.assertEqual(self.plan(0, 4)["asked"], 1); self.assertEqual(self.plan(500, 4)["asked"], 100); self.assertEqual(self.plan(50, 0)["cores"], 2)

    def test_heat_signal(self):
        got = node(f'const P=require({json.dumps(C + "/power.js")}); const a=(v,n=150)=>Array(n).fill(v); console.log(JSON.stringify([P.easing(a(20),a(30),1), P.easing(a(20),a(21),0.5), P.easing(a(20),a(25),0.8), P.easing(a(20),a(60,10),1)]))')
        self.assertAlmostEqual(got[0], 0.75); self.assertAlmostEqual(got[1], 0.575); self.assertAlmostEqual(got[2], 0.8); self.assertEqual(got[3], 1)


@unittest.skipUnless(NODE, "node not installed")
class Monitor(unittest.TestCase):
    def js(self, expr):
        return node(f'const M=require({json.dumps(C + "/monitor.js")}); console.log(JSON.stringify({expr}))')

    def test_median(self):
        self.assertEqual(self.js("[M.median([]), M.median([3,1,2]), M.median([4,1,3,2])]"), [None, 2, 2.5])

    def test_trend_finds_the_line(self):
        t = self.js("(()=>{const r=M.trend([0,1,2,3,4],[1,3,5,7,9]); return [r.slope, r.intercept, r.r2, r.ci]})()")
        self.assertAlmostEqual(t[0], 2); self.assertAlmostEqual(t[1], 1); self.assertAlmostEqual(t[2], 1); self.assertAlmostEqual(t[3], 0)

    def test_trend_needs_enough_points(self):
        self.assertIsNone(self.js("M.trend([0,1,2],[1,2,3])")); self.assertIsNone(self.js("M.trend([1,1,1,1],[1,2,3,4])"))

    def test_verdicts(self):
        x = "[0,1,2,3,4,5,6,7]"
        self.assertEqual(self.js(f"M.verdict({x},[20,19,18,17,16,15,14,13]).word"), "slowing")
        self.assertEqual(self.js(f"M.verdict({x},[10,11,12,13,14,15,16,17]).word"), "faster")
        self.assertEqual(self.js(f"M.verdict({x},[15,16,14,15,16,14,15,15]).word"), "steady")
        self.assertEqual(self.js("M.verdict([0,1],[5,4]).word"), "measuring")

    def test_a_tiny_drift_is_not_called_slowing(self):
        self.assertEqual(self.js("M.verdict([0,1,2,3,4,5,6,7],[100,99.8,99.6,99.4,99.2,99,98.8,98.6]).word"), "steady")

    def test_the_panel_never_shows_result_values(self):
        text = read(C, "monitor.js")
        for bad in ("result.d", "result.m", ".d[", "damage", "fetch(", "XMLHttpRequest", "sendBeacon"): self.assertNotIn(bad, text)


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
