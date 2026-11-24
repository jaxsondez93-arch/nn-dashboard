"""Pairing + login for the dashboard. stdlib only.

Randomness: key material comes ONLY from Python's `secrets` module (the OS getrandom source). No `random` module, no custom entropy mixing.
Secrets are never printed or logged. Files are 0600 in a 0700 directory.

Flow: master key (32 bytes, created once on first run, O_EXCL) -> one-time pairing token (128 bit, 5 min, single use, stored hashed) ->
per-device key = HMAC-SHA256(master, "device|"+id) shown ONCE -> login by challenge-response (fresh 16-byte nonce, single use, 60 s) -> in-memory session token (1 h).
"""
import hashlib, hmac, json, os, secrets, stat, threading, time

PAIR_TTL, NONCE_TTL, SESSION_TTL = 300, 60, 3600
FAIL_LIMIT, FAIL_WINDOW = 5, 60


def _fsync_dir(d):
    fd = os.open(d, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _atomic_write(path, data: bytes):
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)
    _fsync_dir(os.path.dirname(path))


def ensure_dir(d):
    os.makedirs(d, mode=0o700, exist_ok=True)
    if stat.S_IMODE(os.stat(d).st_mode) != 0o700:
        raise PermissionError(f"{d} must be mode 0700")


def load_or_create_master(path):
    """Create the master key on first run (O_CREAT|O_EXCL, 0600). Refuse to start if an existing file is wrong."""
    ensure_dir(os.path.dirname(path))
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        st = os.stat(path)
        if stat.S_IMODE(st.st_mode) != 0o600:
            raise PermissionError(f"{path} must be mode 0600")
        with open(path, "rb") as f:
            key = f.read()
        if len(key) != 32 or key == bytes(32):
            raise ValueError(f"{path} must be exactly 32 non-zero bytes")
        return key
    key = secrets.token_bytes(32)
    try:
        os.write(fd, key)
        os.fsync(fd)
    finally:
        os.close(fd)
    _fsync_dir(os.path.dirname(path))
    return key


def check_master_file(path):
    """File-level checks only (cannot and does not judge randomness). Returns a list of problems, never the bytes."""
    p = []
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return ["missing"]
    if stat.S_IMODE(st.st_mode) != 0o600:
        p.append("mode is not 0600")
    with open(path, "rb") as f:
        k = f.read()
    if len(k) != 32:
        p.append("length is not 32 bytes")
    if k == bytes(32):
        p.append("all zeros")
    return p


class Auth:
    def __init__(self, cfg_dir):
        self.dir = cfg_dir
        ensure_dir(cfg_dir)
        self.master = load_or_create_master(os.path.join(cfg_dir, "pair.secret"))
        self.dev_path = os.path.join(cfg_dir, "devices.json")
        self.pair_path = os.path.join(cfg_dir, "pairing.json")
        self.lock = threading.Lock()
        self.nonces, self.sessions, self.fails = {}, {}, {}

    # ---- devices (persisted; revocation = delete the id) ----
    def _devices(self):
        try:
            with open(self.dev_path) as f:
                return json.load(f)
        except FileNotFoundError:
            return {}

    def device_key(self, device_id):
        return hmac.new(self.master, b"device|" + device_id.encode(), hashlib.sha256).digest()

    def revoke(self, device_id):
        with self.lock:
            d = self._devices()
            d.pop(device_id, None)
            _atomic_write(self.dev_path, json.dumps(d).encode())
            self.sessions = {t: v for t, v in self.sessions.items() if v[0] != device_id}

    # ---- pairing token (stored as sha256, single use, 5 min) ----
    def _pairs(self):
        try:
            with open(self.pair_path) as f:
                return json.load(f)
        except FileNotFoundError:
            return []

    def new_pairing_token(self):
        tok = secrets.token_urlsafe(16)                      # 128 random bits
        with self.lock:
            rows = self._pairs()
            now = time.time()
            rows = [r for r in rows if r["exp"] > now]
            rows.append({"h": hashlib.sha256(tok.encode()).hexdigest(), "exp": now + PAIR_TTL})
            _atomic_write(self.pair_path, json.dumps(rows).encode())
        return tok

    def redeem(self, tok, name="device"):
        h, now = hashlib.sha256(tok.encode()).hexdigest(), time.time()
        with self.lock:
            rows = self._pairs()
            hit = [r for r in rows if hmac.compare_digest(r["h"], h) and r["exp"] > now]
            if not hit:
                return None
            rows = [r for r in rows if r["h"] != h and r["exp"] > now]
            _atomic_write(self.pair_path, json.dumps(rows).encode())          # burn BEFORE issuing the key: single use even on a crash
            did = secrets.token_hex(8)
            d = self._devices()
            d[did] = {"name": str(name)[:40], "created": now}
            _atomic_write(self.dev_path, json.dumps(d).encode())
            return did, self.device_key(did).hex()

    # ---- login ----
    def rate_limited(self, ip):
        now = time.time()
        f = [t for t in self.fails.get(ip, []) if now - t < FAIL_WINDOW]
        self.fails[ip] = f
        return len(f) >= FAIL_LIMIT

    def _fail(self, ip):
        self.fails.setdefault(ip, []).append(time.time())

    def challenge(self):
        n = secrets.token_bytes(16)
        with self.lock:
            now = time.time()
            self.nonces = {k: v for k, v in self.nonces.items() if v > now}
            self.nonces[n.hex()] = now + NONCE_TTL
        return n.hex()

    def login(self, ip, device_id, nonce_hex, response_hex):
        with self.lock:
            if self.rate_limited(ip):
                return None
            exp = self.nonces.pop(nonce_hex, None)                          # consumed even on failure: a nonce is never reused
            ok = exp is not None and exp > time.time() and device_id in self._devices()
            if ok:
                try:
                    want = hmac.new(self.device_key(device_id), bytes.fromhex(nonce_hex), hashlib.sha256).digest()
                    ok = hmac.compare_digest(want, bytes.fromhex(response_hex))
                except ValueError:
                    ok = False
            if not ok:
                self._fail(ip)
                return None
            s = secrets.token_urlsafe(32)
            self.sessions[s] = (device_id, time.time() + SESSION_TTL)
            return s

    def session_ok(self, token):
        with self.lock:
            v = self.sessions.get(token or "")
            if not v:
                return False
            if v[1] < time.time():
                self.sessions.pop(token, None)
                return False
            return v[0] in self._devices()

    @staticmethod
    def respond(device_key_hex, nonce_hex):
        """What the phone computes."""
        return hmac.new(bytes.fromhex(device_key_hex), bytes.fromhex(nonce_hex), hashlib.sha256).hexdigest()
