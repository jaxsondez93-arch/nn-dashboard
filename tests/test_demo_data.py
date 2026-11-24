"""The demo generator is seeded: same seed, same data; and the stops really are gaps."""
import hashlib, json, os, sys, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "demo"))
import make_demo_data


def digest(d):
    return hashlib.sha256(open(d + "/logs/heartbeat.jsonl", "rb").read() + open(d + "/logs/eval.jsonl", "rb").read()).hexdigest()


class Demo(unittest.TestCase):
    def test_same_seed_same_data(self):
        a, b = tempfile.mkdtemp(), tempfile.mkdtemp(); make_demo_data.make(a, days=1.0, seed=5, now=1_800_000_000.0); make_demo_data.make(b, days=1.0, seed=5, now=1_800_000_000.0)
        self.assertEqual(digest(a), digest(b))

    def test_different_seed_different_data(self):
        a, b = tempfile.mkdtemp(), tempfile.mkdtemp(); make_demo_data.make(a, days=1.0, seed=5, now=1_800_000_000.0); make_demo_data.make(b, days=1.0, seed=6, now=1_800_000_000.0)
        self.assertNotEqual(digest(a), digest(b))

    def test_stops_are_heartbeat_gaps_and_steps_never_go_backwards(self):
        d = tempfile.mkdtemp(); make_demo_data.make(d, days=3.0, seed=2, now=1_800_000_000.0)
        hb = [json.loads(l) for l in open(d + "/logs/heartbeat.jsonl")]
        gaps = [b["t"] - a["t"] for a, b in zip(hb, hb[1:]) if b["t"] - a["t"] > 180]
        self.assertEqual(len(gaps), 2); self.assertTrue(all(b["step"] >= a["step"] for a, b in zip(hb, hb[1:])))

    def test_validation_scores_stay_sensible(self):
        d = tempfile.mkdtemp(); make_demo_data.make(d, days=2.0, seed=2, now=1_800_000_000.0)
        nets = [json.loads(l)["hp"]["net"] for l in open(d + "/logs/eval.jsonl")]; self.assertTrue(all(1.0 < v < 3.6 for v in nets))


if __name__ == "__main__":
    unittest.main()
