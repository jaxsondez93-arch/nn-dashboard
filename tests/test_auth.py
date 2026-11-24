import json, os, stat, sys, tempfile, time, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import auth


class T(unittest.TestCase):
    def setUp(self):
        self.d = os.path.join(tempfile.mkdtemp(), "cfg")           # throwaway dir, never a real key
        self.a = auth.Auth(self.d)

    def test_files_private(self):
        self.assertEqual(stat.S_IMODE(os.stat(self.d).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(self.d + "/pair.secret").st_mode), 0o600)
        self.assertEqual(auth.check_master_file(self.d + "/pair.secret"), [])

    def test_existing_bad_mode_refused(self):
        os.chmod(self.d + "/pair.secret", 0o644)
        with self.assertRaises(PermissionError):
            auth.Auth(self.d)

    def test_existing_key_reused_not_overwritten(self):
        k = self.a.master
        self.assertEqual(auth.Auth(self.d).master, k)

    def test_zero_key_refused(self):
        with open(self.d + "/pair.secret", "wb") as f:
            f.write(bytes(32))
        with self.assertRaises(ValueError):
            auth.Auth(self.d)

    def pair(self):
        return self.a.redeem(self.a.new_pairing_token())

    def test_token_single_use_and_stored_hashed(self):
        t = self.a.new_pairing_token()
        with open(self.d + "/pairing.json") as f:
            self.assertNotIn(t, f.read())
        self.assertIsNotNone(self.a.redeem(t))
        self.assertIsNone(self.a.redeem(t))

    def test_token_expires(self):
        t = self.a.new_pairing_token()
        with open(self.d + "/pairing.json") as f:
            rows = json.load(f)
        rows[0]["exp"] = time.time() - 1
        with open(self.d + "/pairing.json", "w") as f:
            json.dump(rows, f)
        self.assertIsNone(self.a.redeem(t))

    def test_login_flow_and_nonce_single_use(self):
        did, key = self.pair(); n = self.a.challenge()
        s = self.a.login("1.1.1.1", did, n, auth.Auth.respond(key, n))
        self.assertTrue(self.a.session_ok(s))
        self.assertIsNone(self.a.login("1.1.1.1", did, n, auth.Auth.respond(key, n)))     # replay

    def test_wrong_key_and_rate_limit(self):
        did, key = self.pair()
        for _ in range(5):
            n = self.a.challenge(); self.assertIsNone(self.a.login("9.9.9.9", did, n, "00" * 32))
        n = self.a.challenge()
        self.assertIsNone(self.a.login("9.9.9.9", did, n, auth.Auth.respond(key, n)))     # locked out even with the right answer
        n = self.a.challenge()
        self.assertIsNotNone(self.a.login("2.2.2.2", did, n, auth.Auth.respond(key, n)))  # other client unaffected

    def test_revocation(self):
        did, key = self.pair(); n = self.a.challenge()
        s = self.a.login("1.1.1.1", did, n, auth.Auth.respond(key, n)); self.a.revoke(did)
        self.assertFalse(self.a.session_ok(s))
        n = self.a.challenge(); self.assertIsNone(self.a.login("1.1.1.1", did, n, auth.Auth.respond(key, n)))

    def test_device_keys_differ(self):
        (d1, k1), (d2, k2) = self.pair(), self.pair()
        self.assertNotEqual(k1, k2)

    def test_bad_input_does_not_crash(self):
        did, key = self.pair()
        self.assertIsNone(self.a.login("3.3.3.3", did, "zz", "zz")); self.assertIsNone(self.a.login("3.3.3.3", "nope", self.a.challenge(), ""))


if __name__ == "__main__":
    unittest.main()
