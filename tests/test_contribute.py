"""The volunteer-computing core (web/contribute/core.js) and its tools, run through Node. Skipped if Node is not installed."""
import json, os, shutil, subprocess, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


def node(code, stdin=None, args=()):
    return subprocess.run([NODE, "-e", code, *args] if code else [NODE, *args], input=stdin, capture_output=True, text=True, timeout=120)


def run_tool(tool, *args, stdin=None):
    return subprocess.run([NODE, os.path.join(ROOT, "tools", tool), *args], input=stdin, capture_output=True, text=True, timeout=120)


PIN = {"v": 1, "cell": 20, "block": 3, "boards": 100, "sums": {"random": 199, "even": 102, "c2f": 112, "hunch": 30}, "check": "6f1cccf1"}


@unittest.skipUnless(NODE, "node not installed")
class Core(unittest.TestCase):
    def test_bundle_round_trip(self):
        got = self.js("(()=>{const r=C.makeResult(C.unitFor(20,3),C.runUnit(C.unitFor(20,3)));const b=C.makeBundle([r]);return [b, C.expandBundle(b)[0]]})()")
        self.assertEqual(got[0], {"v": 2, "units": [[20, 3, 199, 102, 112, 30]]}); self.assertEqual(got[1], PIN)

    def js(self, expr):
        r = node(f'const C=require({json.dumps(os.path.join(ROOT, "web/contribute/core.js"))}); console.log(JSON.stringify({expr}))'); self.assertEqual(r.returncode, 0, r.stderr); return json.loads(r.stdout)

    def test_known_unit_gives_exactly_the_pinned_result(self):
        self.assertEqual(self.js("C.makeResult(C.unitFor(20,3), C.runUnit(C.unitFor(20,3)))"), PIN)

    def test_a_unit_is_reproducible(self):
        self.assertTrue(self.js("(()=>{const u=C.unitFor(7,11);return JSON.stringify(C.runUnit(u))===JSON.stringify(C.runUnit(u))})()"))

    def test_the_grid_is_what_the_docs_say(self):
        g = self.js("({cells:C.KS.length*C.QS.length, blocks:C.BLOCKS, count:C.COUNT})"); self.assertEqual(g, {"cells": 48, "blocks": 500, "count": 100})

    def test_units_use_distinct_seed_ranges(self):
        seeds = self.js("(()=>{const s=new Set();for(let c=0;c<48;c++)for(const b of [0,1,499])s.add(C.unitFor(c,b).seedStart);return [s.size]})()"); self.assertEqual(seeds, [144])

    def test_regret_is_never_negative_and_hunch_beats_random_with_a_decent_guess(self):
        s = self.js("C.runUnit({K:30,q:0.8,seedStart:777000,count:60})"); self.assertTrue(all(v >= 0 for v in s.values())); self.assertLess(s["hunch"], s["random"])

    def test_a_useless_hunch_is_worse_than_a_good_one(self):
        a, b = self.js("C.runUnit({K:30,q:0,seedStart:777000,count:60})"), self.js("C.runUnit({K:30,q:1,seedStart:777000,count:60})"); self.assertGreater(a["hunch"], b["hunch"])

    def test_verify_accepts_the_pin_and_rejects_every_kind_of_tampering(self):
        bad = []
        for mut in ('r.sums.hunch+=1', 'r.cell=21', 'r.block=4', 'r.check="00000000"', 'r.boards=99', 'r.sums.random=-1', 'r.v=2', 'delete r.sums'):
            code = f'const C=require({json.dumps(os.path.join(ROOT, "web/contribute/core.js"))}); const r=JSON.parse(process.argv[1]); {mut}; console.log(C.verify(r).ok)'
            out = subprocess.run([NODE, "-e", code, json.dumps(PIN)], capture_output=True, text=True).stdout.strip(); bad.append((mut, out))
        self.assertTrue(all(o == "false" for _, o in bad), bad)
        self.assertEqual(self.js(f"C.verify({json.dumps(PIN)}).ok"), True)


@unittest.skipUnless(NODE, "node not installed")
class Tools(unittest.TestCase):
    def test_verify_cli_exit_codes(self):
        self.assertEqual(run_tool("verify_unit.js", "-", stdin=json.dumps(PIN)).returncode, 0)
        bad = dict(PIN, sums=dict(PIN["sums"], hunch=31)); self.assertEqual(run_tool("verify_unit.js", "-", stdin=json.dumps(bad)).returncode, 1)
        self.assertEqual(run_tool("verify_unit.js", "-", stdin="not json").returncode, 1)

    def test_aggregator_counts_dedupes_and_rejects(self):
        d = tempfile.mkdtemp(); out = d + "/out.json"
        results = {"a": PIN, "b_duplicate": PIN, "c_tampered": dict(PIN, sums=dict(PIN["sums"], even=0)), "d_garbage": {"hello": 1}}
        for name, r in results.items(): open(f"{d}/{name}.json", "w").write(json.dumps(r))
        r = run_tool("aggregate_results.js", d, "--out", out); self.assertEqual(r.returncode, 0, r.stderr)
        o = json.load(open(out)); self.assertEqual((o["total_units"], o["total_confirmations"], o["rejected"], o["submitted"]), (1, 1, 2, 4))
        cell = o["cells"][20]; self.assertEqual((cell["units"], cell["boards"]), (1, 100)); self.assertAlmostEqual(cell["mean"]["hunch"], 0.30); self.assertEqual(sum(c["units"] for c in o["cells"]), 1)

    def test_a_bundle_counts_every_unit_and_rejects_bad_ones(self):
        d = tempfile.mkdtemp(); row = [20, 3, 199, 102, 112, 30]; bad = [20, 3, 199, 102, 112, 31]
        bundle = {"v": 2, "units": [row, row, bad, [1, 2], [999, 0, 1, 1, 1, 1]]}
        issues = [{"title": "Work unit result bundle (5 units)", "body": "```json\n" + json.dumps(bundle) + "\n```"}]
        open(d + "/issues.json", "w").write(json.dumps(issues)); out = d + "/o.json"; r = run_tool("aggregate_results.js", d + "/issues.json", "--out", out); self.assertEqual(r.returncode, 0, r.stderr)
        o = json.load(open(out)); self.assertEqual((o["submitted"], o["total_units"], o["total_confirmations"], o["rejected"]), (5, 1, 1, 3))

    def test_aggregator_reads_a_github_issues_dump(self):
        d = tempfile.mkdtemp(); issues = [{"title": "Work unit result 20-3", "body": "text\n```json\n" + json.dumps(PIN) + "\n```\nmore"}, {"title": "Work unit result 1-1", "body": "no result here"}, {"title": "Work unit result 2-2", "body": "```json\n{broken\n```"}, {"title": "Unrelated question", "body": "```json\n" + json.dumps(PIN) + "\n```"}]
        open(d + "/issues.json", "w").write(json.dumps(issues)); out = d + "/o.json"; r = run_tool("aggregate_results.js", d + "/issues.json", "--out", out); self.assertEqual(r.returncode, 0, r.stderr)
        o = json.load(open(out)); self.assertEqual((o["total_units"], o["rejected"]), (1, 2))


class Page(unittest.TestCase):
    def test_contribute_page_has_a_strict_policy_and_no_inline_script(self):
        html = open(os.path.join(ROOT, "web/contribute/index.html"), encoding="utf-8").read()
        self.assertIn("Content-Security-Policy", html); self.assertIn("connect-src 'self'", html); self.assertIn("default-src 'none'", html)
        import re
        self.assertEqual([m for m in re.findall(r"<script(?![^>]*\bsrc=)[^>]*>", html)], [], "no inline scripts allowed under script-src 'self'")

    def test_worker_and_page_never_use_the_network_except_the_community_file(self):
        for f in ("worker.js", "contribute.js", "core.js"):
            text = open(os.path.join(ROOT, "web/contribute", f), encoding="utf-8").read()
            for bad in ("XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "importScripts(\"http"): self.assertNotIn(bad, text, f)
        self.assertEqual(open(os.path.join(ROOT, "web/contribute/contribute.js"), encoding="utf-8").read().count("fetch("), 1)      # only the community results file


if __name__ == "__main__":
    unittest.main()
