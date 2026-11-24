"""Unit tests for the pure statistics helpers (analysis.py). Expected values are worked out by hand in the comments."""
import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from analysis import GAP_S, aligned, down, summarize


class Down(unittest.TestCase):
    def test_short_lists_are_untouched(self):
        rows = [{"x": i} for i in range(5)]
        self.assertEqual(down(rows, n=10), rows)

    def test_output_is_at_most_n_and_in_order(self):
        out = down([{"i": i} for i in range(1000)], n=100)
        self.assertEqual(len(out), 100); self.assertEqual([r["i"] for r in out], sorted(r["i"] for r in out)); self.assertEqual(out[-1]["i"], 999)

    def test_listed_keys_are_averaged_and_others_take_the_last_row(self):
        rows = [{"v": 0.0, "tag": "a"}, {"v": 10.0, "tag": "b"}, {"v": 20.0, "tag": "c"}, {"v": 30.0, "tag": "d"}]
        out = down(rows, n=2, avg=("v",))
        self.assertEqual([r["v"] for r in out], [5.0, 25.0]); self.assertEqual([r["tag"] for r in out], ["b", "d"])

    def test_non_numeric_values_do_not_break_averaging(self):
        out = down([{"v": "x"}, {"v": 4.0}, {"v": None}, {"v": 8.0}], n=2, avg=("v",))
        self.assertEqual(out[1]["v"], 8.0)


class Summarize(unittest.TestCase):
    # hb: 0->60 s adds 100 steps, 60->120 s adds 150, then a 880 s silence (> GAP_S) that must not count as running time
    hb = [{"t": 0, "step": 0, "cpu_c": 70}, {"t": 60, "step": 100, "cpu_c": 95}, {"t": 120, "step": 250, "cpu_c": 95}, {"t": 1000, "step": 300, "cpu_c": 60}]

    def test_steps_and_speed_ignore_gaps(self):
        s = summarize(self.hb, [], 0, 1000, [{"start": 120, "end": 1000}])
        self.assertEqual(s["steps"], 250); self.assertEqual(s["running_s"], 120); self.assertAlmostEqual(s["spm"], 125.0)     # 250 steps / 2 minutes

    def test_stops_and_availability(self):
        s = summarize(self.hb, [], 0, 1000, [{"start": 120, "end": 1000}])
        self.assertEqual(s["stops"], 1); self.assertEqual(s["stopped_s"], 880); self.assertAlmostEqual(s["availability"], 0.12)   # 120 s running of 1000 s

    def test_temperatures(self):
        s = summarize(self.hb, [], 0, 1000, [])
        self.assertEqual((s["temp_min"], s["temp_max"]), (60, 95)); self.assertAlmostEqual(s["temp_mean"], 80.0); self.assertAlmostEqual(s["temp_hot_share"], 0.5)   # 95 and 95 are >= 90

    def test_loss_first_and_last_use_the_edges_of_the_run(self):
        s = summarize(self.hb, [{"loss": v} for v in (3, 3, 3, 1, 1, 1)], 0, 1000, [])
        self.assertEqual((s["loss_first"], s["loss_last"], s["loss_min"]), (3.0, 1.0, 1))

    def test_too_few_losses_give_no_first_last(self):
        s = summarize(self.hb, [{"loss": 2.0}, {"loss": 1.0}], 0, 1000, [])
        self.assertIsNone(s["loss_first"]); self.assertEqual(s["loss_min"], 1.0)

    def test_empty_inputs_do_not_crash(self):
        s = summarize([], [], 0, 10, [])
        self.assertEqual(s["steps"], 0); self.assertIsNone(s["temp_mean"]); self.assertIsNone(s["spm"])

    def test_gap_threshold_is_three_minutes(self):
        self.assertEqual(GAP_S, 180)


T0 = 1000.0


class Aligned(unittest.TestCase):
    T0 = T0
    hb = [{"t": T0 + 60 * i, "cpu_c": 70.0 + i, "load": 1.0} for i in range(16)]

    def test_no_heartbeats_means_nothing_to_align(self):
        self.assertEqual(aligned([], [], [], []), ([], 60))

    def test_bin_width_is_at_least_a_minute(self):
        rows, binw = aligned(self.hb, [], [], []); self.assertEqual(binw, 60); self.assertEqual(len(rows), 16)

    def test_long_runs_get_wider_bins(self):
        hb = [{"t": 60.0 * i, "cpu_c": 70.0, "load": 1.0} for i in range(0, 60 * 24 * 5, 30)]       # five days
        _, binw = aligned(hb, [], [], []); self.assertGreater(binw, 60); self.assertEqual(binw % 60, 0)

    def test_values_are_averaged_inside_a_bin(self):
        tr = [{"t": self.T0 + 5, "loss": 2.0}, {"t": self.T0 + 30, "loss": 4.0}]
        rows, _ = aligned(self.hb, tr, [], []); self.assertAlmostEqual(rows[0]["loss"], 3.0)

    def test_only_bins_with_a_heartbeat_are_kept(self):
        tr = [{"t": self.T0 + 60 * 40, "loss": 9.0}]                                                    # far after the last heartbeat
        rows, _ = aligned(self.hb, tr, [], []); self.assertTrue(all("loss" not in r for r in rows))

    def test_non_numeric_and_nan_values_are_ignored(self):
        rows, _ = aligned([{"t": self.T0, "cpu_c": "hot", "load": float("nan")}, {"t": self.T0 + 60, "cpu_c": 80.0, "load": 2.0}], [], [], [])
        self.assertEqual(len(rows), 1, "a bin with no valid values is left out")         # the first heartbeat had a text temperature and a NaN load
        self.assertEqual((rows[0]["temp"], rows[0]["load"]), (80.0, 2.0))

    def test_throttle_rate_is_a_counter_difference_and_resets_are_skipped(self):
        # counter 0 -> 600 over 300 s = 2 events/s; then the counter drops (reboot) and that interval is skipped
        s = [{"t": self.T0, "thr": 0}, {"t": self.T0 + 300, "thr": 600}, {"t": self.T0 + 600, "thr": 10}]
        rows, _ = aligned(self.hb, [], [], s)
        thr = {r["t"]: r["thr"] for r in rows if "thr" in r}
        self.assertEqual(len(thr), 1); self.assertAlmostEqual(list(thr.values())[0], 2.0)


if __name__ == "__main__":
    unittest.main()
