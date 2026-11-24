"""The reference proof scripts: they must compile, contain no personal paths, and be described in their README."""
import glob, os, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = sorted(glob.glob(os.path.join(ROOT, "docs/math/proof_code/*.py")))


class ProofCode(unittest.TestCase):
    def test_there_are_five_files(self):
        self.assertEqual(len(FILES), 5)

    def test_every_file_compiles(self):
        for f in FILES: compile(open(f, encoding="utf-8").read(), f, "exec")

    def test_no_personal_paths(self):
        home, user = os.path.expanduser("~"), os.path.basename(os.path.expanduser("~"))
        for f in FILES:
            text = open(f, encoding="utf-8").read()
            for bad in (home, "/home/", user): self.assertNotIn(bad, text, f)

    def test_each_file_has_the_reference_header_and_env_paths(self):
        for f in FILES:
            text = open(f, encoding="utf-8").read(); self.assertIn("Reference copy for reading", text); self.assertIn("BALLZ_PROOF_MODULES", text)

    def test_readme_describes_every_file(self):
        readme = open(os.path.join(ROOT, "docs/math/proof_code/README.md"), encoding="utf-8").read()
        for f in FILES: self.assertIn(os.path.basename(f), readme)


if __name__ == "__main__":
    unittest.main()
