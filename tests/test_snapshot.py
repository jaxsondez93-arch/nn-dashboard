"""Unit tests for run selection and JSON assembly (snapshot.py)."""
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import snapshot
from settings import Settings, settings


class PickRun(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(); self.saved = (settings.data_dir, settings.train_unit, settings.runs, snapshot.unit)
        self.a, self.b = self.tmp + "/a", self.tmp + "/b"
        for d in (self.a, self.b): os.makedirs(d + "/logs"); open(d + "/logs/heartbeat.jsonl", "w").write("{}\n")
        os.utime(self.a + "/logs/heartbeat.jsonl", (1000, 1000)); os.utime(self.b + "/logs/heartbeat.jsonl", (2000, 2000))        # b is fresher
        settings.data_dir, settings.train_unit = "/start", "start.service"

    def tearDown(self):
        settings.data_dir, settings.train_unit, settings.runs, snapshot.unit = self.saved

    def fake_units(self, active):
        snapshot.unit = lambda name: {"ActiveState": "active" if name in active else "inactive"}

    def test_an_active_trainer_beats_a_fresher_heartbeat(self):
        settings.runs = [(self.a, "a.service"), (self.b, "b.service")]; self.fake_units({"a.service"}); snapshot.pick_run()
        self.assertEqual((settings.data_dir, settings.train_unit), (self.a, "a.service"))

    def test_without_an_active_trainer_the_freshest_heartbeat_wins(self):
        settings.runs = [(self.a, "a.service"), (self.b, "b.service")]; self.fake_units(set()); snapshot.pick_run()
        self.assertEqual(settings.data_dir, self.b)

    def test_no_configured_runs_changes_nothing(self):
        settings.runs = []; snapshot.pick_run(); self.assertEqual((settings.data_dir, settings.train_unit), ("/start", "start.service"))

    def test_a_run_without_a_heartbeat_file_is_skipped(self):
        settings.runs = [(self.tmp + "/missing", "m.service"), (self.a, "a.service")]; self.fake_units({"m.service"}); snapshot.pick_run()
        self.assertEqual(settings.data_dir, self.a)


class Settings_(unittest.TestCase):
    def test_defaults_and_overrides(self):
        s = Settings(); s.reload({}); self.assertEqual((s.port, s.bind, s.demo, s.noauth, s.runs), (8765, "127.0.0.1", False, False, []))
        s.reload({"NN_DASH_PORT": "9000", "NN_RUNS": "x=u1;y=u2;bad", "NN_DASH_DEMO": "1"}); self.assertEqual((s.port, s.runs, s.demo), (9000, [("x", "u1"), ("y", "u2")], True))

    def test_no_auth_is_never_honoured_off_loopback(self):
        s = Settings(); s.reload({"NN_DASH_NOAUTH": "1"}); self.assertTrue(s.noauth)
        s.reload({"NN_DASH_NOAUTH": "1", "NN_DASH_BIND": "0.0.0.0"}); self.assertFalse(s.noauth)


class BuildOnEmptyData(unittest.TestCase):
    def test_an_empty_data_directory_gives_a_valid_answer(self):
        saved = (settings.data_dir, settings.work_dir, settings.demo); settings.data_dir = settings.work_dir = tempfile.mkdtemp(); settings.demo = True
        try:
            d = snapshot.build("run")
            self.assertEqual(d["aligned"], []); self.assertEqual(d["n_gaps"], 0); self.assertIsNone(d["heartbeat_age_s"]); self.assertFalse(d["config"]["exists"]); self.assertEqual(d["checkpoints"], [])
        finally: settings.data_dir, settings.work_dir, settings.demo = saved

    def test_an_unknown_range_falls_back_to_run(self):
        saved = (settings.data_dir, settings.work_dir, settings.demo); settings.data_dir = settings.work_dir = tempfile.mkdtemp(); settings.demo = True
        try: self.assertEqual(snapshot.build("nonsense")["range"], "run")
        finally: settings.data_dir, settings.work_dir, settings.demo = saved


if __name__ == "__main__":
    unittest.main()
