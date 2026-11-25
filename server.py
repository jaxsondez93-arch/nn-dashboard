#!/usr/bin/env python3
"""START HERE. The web layer of a small, read-only training dashboard (standard library only).

How the pieces fit (read in this order, each file is short):
  settings.py   configuration from environment variables
  sources.py    reading logs, systemd, /proc and /sys (nothing here writes)
  analysis.py   pure statistics helpers (easy to test)
  snapshot.py   builds the JSON the page draws, cached for a few seconds
  server.py     this file: fixed routes, the paired-device login, main()
  auth.py       pairing tokens and challenge-response login
  index.html    the page (plus static/dashboard.css and static/dashboard.js)

Routes (all GET unless noted): /api/stats?range=live|1h|6h|24h|7d|all|run (needs a login session), /auth/challenge, POST /auth/redeem, POST /auth/login,
and / (the page) only when started with NN_DASH_NOAUTH=1 on loopback. It binds to 127.0.0.1 by default. It never writes to the training data."""
import http.server, json, os, socketserver, sys, urllib.parse

import auth
from settings import settings
from snapshot import stats

HERE = os.path.dirname(os.path.abspath(__file__))
AUTH = None        # set in main(); tests set it directly


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        if settings.noauth:
            return True
        h = self.headers.get("Authorization", "")
        return h.startswith("Bearer ") and AUTH.session_ok(h[7:])

    def _json_body(self):
        n = int(self.headers.get("Content-Length", "0"))
        if n > 4096:
            raise ValueError("too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        ip = self.client_address[0]
        try:
            b = self._json_body()
            if u.path == "/auth/redeem":
                with AUTH.lock:
                    limited = AUTH.rate_limited(ip)
                    if limited or not isinstance(b.get("token"), str):
                        AUTH._fail(ip)
                        return self._send(429 if limited else 400, b"{}", "application/json")
                r = AUTH.redeem(b["token"], b.get("name", "device"))
                if not r:
                    with AUTH.lock:
                        AUTH._fail(ip)
                    return self._send(403, b"{}", "application/json")
                return self._send(200, json.dumps({"device_id": r[0], "device_key": r[1]}).encode(), "application/json")
            if u.path == "/auth/login":
                s = AUTH.login(ip, str(b.get("device_id", "")), str(b.get("nonce", "")), str(b.get("response", "")))
                return self._send(200 if s else 403, json.dumps({"session": s} if s else {}).encode(), "application/json")
        except (ValueError, KeyError, TypeError):
            return self._send(400, b"{}", "application/json")
        self._send(404, b"not found", "text/plain")

    def _local_name(self):
        """Without a login, the request must be addressed to this machine by name; otherwise a web page could point its own name here and read the data (DNS rebinding)."""
        return self.headers.get("Host", "") in [f"{h}:{self.server.server_port}" for h in ("127.0.0.1", "localhost", "[::1]")]

    def do_GET(self):
        if settings.noauth and not self._local_name():
            return self._send(403, b"forbidden", "text/plain")
        u = urllib.parse.urlparse(self.path)
        if u.path == "/auth/challenge":
            return self._send(200, json.dumps({"nonce": AUTH.challenge()}).encode(), "application/json")
        if u.path in ("/", "/index.html") and settings.noauth:
            self._send(200, open(HERE + "/index.html", "rb").read(), "text/html; charset=utf-8")
        elif u.path == "/api/stats":
            if not self._authed():
                return self._send(401, b"{}", "application/json")
            rng = urllib.parse.parse_qs(u.query).get("range", ["run"])[0]
            try:
                self._send(200, stats(rng), "application/json")
            except Exception as e:                                   # never crash the server on a bad log line
                self._send(500, json.dumps({"error": str(e)}).encode(), "application/json")
        else:
            self._send(404, b"not found", "text/plain")


class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    global AUTH
    AUTH = auth.Auth(settings.config_dir)
    if "--pair" in sys.argv:                            # print a single-use 5-minute pairing token; run on the machine itself
        print(f"pairing token (single use, 5 min): {AUTH.new_pairing_token()}")
        return
    S((settings.bind, settings.port), H).serve_forever()


if __name__ == "__main__":
    main()
