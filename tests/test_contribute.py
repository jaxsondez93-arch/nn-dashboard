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
class GameClock(unittest.TestCase):
    def test_frames_owed_follow_the_speed_and_do_not_pile_up(self):
        got = node(f'const C=require({json.dumps(ROOT + "/web/play/clock.js")}); const S=C.STEP; console.log(JSON.stringify([C.due(0,S,1)/S, C.due(0,S,8)/S, C.due(S/2,S,2)/S, C.due(0,10000,4)/S, C.due(0,S,"max")===Infinity]))')
        for a, b in zip(got[:4], [1, 8, 2.5, 16]): self.assertAlmostEqual(a, b)
        self.assertTrue(got[4])


class CollectorLimits(unittest.TestCase):
    def test_a_message_cannot_deliver_an_unlimited_number_of_results(self):
        many = json.dumps({"v": 3, "results": [{"u": i, "d": [1], "m": [1]} for i in range(1000)]})
        self.assertEqual(len(collect.results_in(many)), collect.MAX_UNITS)

    def test_message_ids_that_could_alter_the_address_are_refused(self):
        for bad in ("", "a&since=all", "../x", "a b", "x" * 65): self.assertIsNone(collect.ID.fullmatch(bad), bad)
        self.assertTrue(collect.ID.fullmatch("X8kfpSG2sX7t"))

    def test_the_relay_must_be_https(self):
        with tempfile.TemporaryDirectory() as t:
            open(t + "/c.json", "w").write('{"endpoint": "http://example.invalid/x"}')
            self.assertRaises(SystemExit, collect.main, t + "/c.json", t + "/out", True)


class Pickups(unittest.TestCase):
    def test_collector_keeps_pickup_counts_and_still_accepts_old_results(self):
        old = {"u": 1, "d": [1, 2], "m": [3, 4]}; new = dict(old, u=2, k=[0, 1]); bad = [dict(old, k=[0]), dict(old, k=[0, -1]), dict(old, k="01")]
        self.assertEqual(collect.results_in(json.dumps({"v": 3, "results": [old, new] + bad})), [old, new])


@unittest.skipUnless(NODE, "node not installed")
class BestBotPriority(unittest.TestCase):
    """The choice order, checked with a made-up simulator: aim i is pixel [i, 0]; each aim's outcome is given by the test."""
    def choose(self, table, extra, pickups=True):
        js = f"""const S=require({json.dumps(ROOT + "/web/play/best/search.js")}), T={json.dumps(table)};
        const px=Array.from({{length:781}},(_,i)=>[i,0]), board={{blocks:[[1,100,900,50]],pickups:{"[[300,500]]" if pickups else "[]"},balls:1,turn:1}};
        const sim={{simulate:(b,p)=>{{const o=T[p[0]]||{{}}; return {{hits:{{1:o.dmg||1}},completed:true,pickups_left:o.got?[]:board.pickups}}}}}};
        const scorer={{scoreAll:()=>px.map((_,i)=>-i), pickupOrder:()=>Array.from({{length:780}},(_,i)=>(i+500)%780)}};
        console.log(JSON.stringify(S.chooseAim(sim,scorer,px,board,{{n1:3,rho:10,refine:1,budget:6,extra:{extra}}})))"""
        return node(js)

    def test_the_ball_beats_more_damage(self):
        r = self.choose({"0": {"dmg": 40}, "10": {"dmg": 2, "got": True}}, 0)
        self.assertEqual((r["index"], r["collects"]), (10, 1))

    def test_among_shots_that_get_the_ball_the_most_damage_wins(self):
        r = self.choose({"0": {"dmg": 2, "got": True}, "10": {"dmg": 9, "got": True}, "20": {"dmg": 40}}, 0)
        self.assertEqual((r["index"], r["predicted"]), (10, 9))

    def test_extra_tests_find_a_ball_the_first_shots_missed(self):
        r = self.choose({"506": {"dmg": 1, "got": True}}, 20)
        self.assertEqual((r["index"], r["collects"]), (506, 1)); self.assertLessEqual(r["sims"], 6 + 20)

    def test_when_every_first_shot_loses_it_searches_until_one_survives(self):
        js = f"""const S=require({json.dumps(ROOT + "/web/play/best/search.js")});
        const px=Array.from({{length:781}},(_,i)=>[i,0]), board={{blocks:[[1,100,900,50],[2,300,200,1]],pickups:[],balls:1,turn:1}};
        const sim={{simulate:(b,p)=>({{hits:p[0]===613?{{1:1,2:1}}:{{1:30}},completed:true,pickups_left:[]}})}}, scorer={{scoreAll:()=>px.map((_,i)=>-i)}};
        const r=S.chooseAim(sim,scorer,px,board,{{n1:3,rho:10,refine:1,budget:6}}), none=S.chooseAim({{simulate:()=>({{hits:{{1:3}},completed:true,pickups_left:[]}})}},scorer,px,board,{{n1:3,rho:10,refine:1,budget:6}});
        console.log(JSON.stringify([r,none]))"""
        found, hopeless = node(js)
        self.assertEqual((found["index"], found["losing"], found["rescued"]), (613, False, True))
        self.assertEqual((hopeless["losing"], hopeless["sims"], hopeless["searched_all"]), (True, 781, True))

    def test_more_tests_never_make_the_choice_worse(self):
        js = f"""const S=require({json.dumps(ROOT + "/web/play/best/search.js")});
        let a=5; const rng=()=>(a=(Math.imul(a,48271)>>>0)%2147483647)/2147483647, px=Array.from({{length:781}},(_,i)=>[i,0]), board={{blocks:[[1,100,900,50],[2,300,200,1]],pickups:[[300,500]],balls:1,turn:1}};
        let worse=0;
        for(let t=0;t<600;t++){{ const pl=rng(), pg=rng()**3, base=Math.floor(rng()*781), T=px.map(()=>({{lost:rng()<pl,got:rng()<pg,dmg:Math.floor(rng()*20)}}));
          const sim={{simulate:(b,p)=>{{const o=T[p[0]],h={{1:o.dmg}}; if(!o.lost) h[2]=1; return {{hits:h,completed:true,pickups_left:o.got?[]:board.pickups}}}}}}, sc={{scoreAll:()=>px.map((_,i)=>-Math.abs(i-base)),aimsToward:()=>[],pickupOrder:()=>Array.from({{length:780}},(_,i)=>(i*37+t)%780)}};
          const rank=(e)=>{{const c=S.chooseAim(sim,sc,px,board,{{n1:12,rho:16,refine:5,budget:30,extra:e}}),o=S.outcome(sim,board,px[c.index]); return (o.lost?0:1)*1e6+o.got*1e3+o.damage}};      // survive, ball, damage as one number
          if(rank(5)<rank(0)||rank(20)<rank(5)||rank(60)<rank(20)) worse++; }}
        console.log(worse)"""
        self.assertEqual(node(js), 0)

    def test_no_extra_work_without_a_pickup(self):
        self.assertLessEqual(self.choose({}, 40, pickups=False)["sims"], 6)


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
