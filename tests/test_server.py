"""End-to-end test on SYNTHETIC data: builds the stats JSON and drives the real HTTP server through the paired-device login flow."""
import importlib, json, os, sys, tempfile, threading, unittest, urllib.error, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT); sys.path.insert(0, os.path.join(ROOT, "demo"))
import make_demo_data


class T(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(); cls.info = make_demo_data.make(cls.tmp + "/run", days=2.0, seed=3)
        os.environ.update(NN_DATA=cls.tmp + "/run", NN_WORK=cls.tmp + "/run", NN_DASH_CONFIG=cls.tmp + "/cfg", NN_TRAIN_UNIT="nn-train-demo.service"); os.environ.pop("NN_DASH_NOAUTH", None)
        import server; cls.server = importlib.reload(server)
        cls.server.AUTH = cls.server.auth.Auth(cls.tmp + "/cfg")
        cls.httpd = cls.server.S(("127.0.0.1", 0), cls.server.H); cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close()

    def call(self, path, body=None, token=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=None if body is None else json.dumps(body).encode(), headers={"Authorization": f"Bearer {token}"} if token else {})
        try:
            with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e: return e.code, {}

    def test_demo_generator_shape(self):
        self.assertGreater(self.info["heartbeats"], 1000); self.assertEqual(self.info["stops"], 2); self.assertGreater(self.info["final_step"], 1_000_000)

    def test_build_all(self):
        d = self.server.build("all")
        self.assertEqual(d["n_gaps"], 2, "the two synthetic machine stops should be detected as gaps")
        self.assertGreater(len(d["aligned"]), 10); self.assertGreater(len(d["eval"]), 10); self.assertTrue(d["config"]["rays_on"]); self.assertEqual(len(d["checkpoints"]), 4)
        self.assertGreater(d["summary"]["steps"] if "steps" in d["summary"] else 1, 0)

    def test_build_ranges_do_not_crash(self):
        for r in ("live", "run", "1h", "6h", "24h", "7d", "all", "not-a-range"): self.assertIn("summary", self.server.build(r))

    def test_unauthenticated_is_refused(self):
        self.assertEqual(self.call("/api/stats?range=all")[0], 401)

    def test_full_login_flow_then_stats(self):
        tok = self.server.AUTH.new_pairing_token()
        st, r = self.call("/auth/redeem", {"token": tok, "name": "test"}); self.assertEqual(st, 200)
        st, _ = self.call("/auth/redeem", {"token": tok}); self.assertEqual(st, 403, "a pairing token works once")
        n = self.call("/auth/challenge")[1]["nonce"]
        resp = self.server.auth.Auth.respond(r["device_key"], n)
        st, s = self.call("/auth/login", {"device_id": r["device_id"], "nonce": n, "response": resp}); self.assertEqual(st, 200)
        st, d = self.call("/api/stats?range=24h", token=s["session"]); self.assertEqual(st, 200); self.assertIn("aligned", d)
        self.assertEqual(self.call("/auth/login", {"device_id": r["device_id"], "nonce": n, "response": resp})[0], 403, "a nonce works once")


if __name__ == "__main__":
    unittest.main()
