"""Builds the whole static site and checks it: required files, no broken relative links, no leftover Markdown links, valid data, filled-in service worker."""
import json, os, re, sys, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_pages


class Site(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.out = build_pages.build(tempfile.mkdtemp() + "/site")

    def p(self, rel): return os.path.join(self.out, rel)

    def test_required_files_exist(self):
        for f in ("index.html", "site.css", "sw.js", "manifest.webmanifest", ".nojekyll", "icon-192.png", "icon-512.png", "demo/index.html", "demo/static/dashboard.js", "demo/static/dashboard.css", "playground/index.html", "playground/playground.js", "docs/PLAIN_ENGLISH.html", "docs/math/README.html", "docs/images/dashboard_v2.3.png"):
            self.assertTrue(os.path.exists(self.p(f)), f)

    def test_every_relative_link_and_image_resolves(self):
        bad = []
        for dp, _, files in os.walk(self.out):
            for f in files:
                if not f.endswith(".html"): continue
                text = open(os.path.join(dp, f), encoding="utf-8").read()
                for u in re.findall(r'(?:href|src)="([^"]+)"', text):
                    if u.startswith(("http", "#", "mailto:", "data:")) or u.startswith(("game/", "../play/game/")): continue        # play/game/ is optional (added only when NN_GAME_DIR is set)
                    path = os.path.normpath(os.path.join(dp, u.split("#")[0].split("?")[0]))
                    if u.split("#")[0] and not os.path.exists(path): bad.append((os.path.relpath(os.path.join(dp, f), self.out), u))
        self.assertEqual(bad, [])

    def test_no_markdown_links_survive(self):
        for dp, _, files in os.walk(self.out + "/docs"):
            for f in files:
                if f.endswith(".html"): self.assertNotRegex(open(os.path.join(dp, f), encoding="utf-8").read(), r'href="[^"]*\.md[#"]', f)

    def test_demo_is_static_and_data_is_valid(self):
        page = open(self.p("demo/index.html"), encoding="utf-8").read(); self.assertIn("window.NN_STATIC = true", page); self.assertIn("synthetic data", page)
        for r in ("live", "run", "1h", "6h", "24h", "7d", "all"):
            d = json.load(open(self.p(f"demo/data/{r}.json"))); self.assertIn("aligned", d); self.assertEqual(d["services"]["train"]["ActiveState"], "active")

    def test_demo_contains_no_real_machine_data(self):
        text = open(self.p("demo/data/all.json")).read(); self.assertNotIn(os.path.expanduser("~"), text); self.assertNotIn(os.uname().nodename, text)

    def test_service_worker_is_filled_in(self):
        sw = open(self.p("sw.js")).read(); self.assertNotIn("@@", sw); self.assertIn("./demo/data/all.json", sw)

    def test_manifest_icons_exist(self):
        m = json.load(open(self.p("manifest.webmanifest")))
        for i in m["icons"]: self.assertGreater(os.path.getsize(self.p(i["src"])), 100)


if __name__ == "__main__":
    unittest.main()
