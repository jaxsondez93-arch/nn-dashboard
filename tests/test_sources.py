"""Unit tests for the readers (sources.py): they must fail soft, never raise."""
import os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import sources


class Readers(unittest.TestCase):
    def tmpfile(self, text):
        d = tempfile.mkdtemp(); p = os.path.join(d, "f"); open(p, "w").write(text); return p

    def test_jsonl_skips_bad_lines(self):
        self.assertEqual(sources.jsonl(self.tmpfile('{"a": 1}\nnot json\n\n{"b": 2}\n')), [{"a": 1}, {"b": 2}])

    def test_jsonl_missing_file_is_empty(self):
        self.assertEqual(sources.jsonl("/definitely/not/here.jsonl"), [])

    def test_rd_strips_and_fails_soft(self):
        self.assertEqual(sources.rd(self.tmpfile("  hello \n")), "hello"); self.assertIsNone(sources.rd("/definitely/not/here"))

    def test_iso_to_epoch(self):
        self.assertEqual(sources.iso_to_epoch("1970-01-01T00:01:40Z"), 100.0); self.assertIsNone(sources.iso_to_epoch("garbage")); self.assertIsNone(sources.iso_to_epoch("2026-11-23 20:00:00"))

    def test_sh_returns_empty_text_when_the_command_is_missing(self):
        self.assertEqual(sources.sh(["definitely-not-a-command-xyz"]), "")

    def test_unit_parses_key_value_lines(self):
        real = sources.sh; sources.sh = lambda args, t=3: "ActiveState=active\nSubState=running\nignored line\nNRestarts=2\n"
        try: self.assertEqual(sources.unit("x"), {"ActiveState": "active", "SubState": "running", "NRestarts": "2"})
        finally: sources.sh = real

    def test_unit_without_systemd_is_empty(self):
        real = sources.sh; sources.sh = lambda args, t=3: ""
        try: self.assertEqual(sources.unit("x"), {})
        finally: sources.sh = real

    def test_host_never_raises_and_reports_disk(self):
        h = sources.host(tempfile.mkdtemp()); self.assertIn("disk_free_gb", h); self.assertIn("mem_total_mb", h)

    def test_demo_host_follows_the_heartbeat_and_hides_the_real_machine(self):
        h = sources.demo_host({"cpu_c": 88.0, "load": 1.5, "bat_pct": "42"})
        self.assertEqual((h["pkg_temp_c"], h["load1"], h["bat_pct"]), (88, 1.5, "42")); self.assertEqual(h["mem_total_mb"], 16000)
        self.assertEqual(sources.demo_host(None)["pkg_temp_c"], 70)


if __name__ == "__main__":
    unittest.main()
