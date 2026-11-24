#!/usr/bin/env python3
"""READ-ONLY training dashboard. stdlib only. Binds to 127.0.0.1 by default. GET stats endpoints require a paired-device session (see auth.py).
Serves index.html and /api/stats?range=<live|run|1h|6h|24h|7d|all> (JSON built from ~/nn_data/logs/*.jsonl, ckpt/, labels/,
systemd status, /proc, /sys). Never writes anything, never touches the services. GET only; fixed routes only."""
import auth, datetime, glob, http.server, json, math, os, socketserver, subprocess, threading, time, urllib.parse

HOME = os.path.expanduser("~")
D = os.environ.get("NN_DATA", HOME + "/nn_data")          # training data dir (logs/, ckpt/, labels/)
W = os.environ.get("NN_WORK", HOME + "/nn_overnight")      # sampler/watchdog output dir
CFG = os.environ.get("NN_DASH_CONFIG", HOME + "/.config/nn-dashboard")
TRAIN_UNIT = os.environ.get("NN_TRAIN_UNIT", "nn-train.service")
# Optional automatic run selection: NN_RUNS="dir=unit;dir=unit" (e.g. a newer run first). The run whose trainer unit is active wins, else the freshest heartbeat. Unset = fixed NN_DATA / NN_TRAIN_UNIT.
RUNS = [tuple(x.split("=", 1)) for x in os.environ.get("NN_RUNS", "").split(";") if "=" in x]


def pick_run():
    global D, TRAIN_UNIT
    best = None
    for d, u in RUNS:
        d = os.path.expanduser(d)
        try:
            m = os.path.getmtime(d + "/logs/heartbeat.jsonl")
        except OSError:
            continue
        key = (unit(u).get("ActiveState") == "active", m)
        if best is None or key > best[0]:
            best = (key, d, u)
    if best:
        D, TRAIN_UNIT = best[1], best[2]
HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("NN_DASH_PORT", "8765"))
MAXPTS = 700
GAP_S = 180                                    # heartbeat gap that counts as a stop
RANGES = {"live": 1800, "1h": 3600, "6h": 6 * 3600, "24h": 86400, "7d": 7 * 86400, "all": None, "run": "run"}
_cache = {}
_lock = threading.Lock()


def jsonl(path):
    out = []
    try:
        with open(path) as f:
            for line in f:
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        pass
    return out


def down(rows, n=MAXPTS, avg=()):
    """Bucket-downsample to <= n rows; numeric keys in `avg` are averaged, everything else takes the bucket's last row."""
    if len(rows) <= n:
        return rows
    k = len(rows) / n
    out = []
    for i in range(n):
        b = rows[int(i * k): max(int((i + 1) * k), int(i * k) + 1)]
        r = dict(b[-1])
        for key in avg:
            v = [x[key] for x in b if isinstance(x.get(key), (int, float))]
            if v:
                r[key] = sum(v) / len(v)
        out.append(r)
    return out


def sh(args, t=3):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=t).stdout
    except Exception:
        return ""


def unit(name):
    d = {}
    for line in sh(["systemctl", "--user", "show", name, "-p", "MainPID", "-p", "ActiveState", "-p", "SubState",
                    "-p", "NRestarts", "-p", "ActiveEnterTimestamp", "-p", "MemoryCurrent"]).splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            d[k] = v
    return d


def rd(p):
    try:
        with open(p) as _f:
            return _f.read().strip()
    except OSError:
        return None


def host():
    h = {}
    up = rd("/proc/uptime")
    h["uptime_s"] = float(up.split()[0]) if up else None
    mi = {}
    for line in (rd("/proc/meminfo") or "").splitlines():
        a = line.split()
        if len(a) >= 2:
            mi[a[0].rstrip(":")] = int(a[1])
    h["mem_avail_mb"] = mi.get("MemAvailable", 0) // 1024
    h["mem_total_mb"] = mi.get("MemTotal", 0) // 1024
    h["swap_used_mb"] = (mi.get("SwapTotal", 0) - mi.get("SwapFree", 0)) // 1024
    h["load1"] = float((rd("/proc/loadavg") or "0").split()[0])
    for nm in ("cpu", "memory", "io"):
        for line in (rd(f"/proc/pressure/{nm}") or "").splitlines():
            if line.startswith("some"):
                h[f"psi_{nm}60"] = float(line.split("avg60=")[1].split()[0])
    for hw in glob.glob("/sys/class/hwmon/hwmon*"):
        if rd(hw + "/name") == "coretemp" and rd(hw + "/temp1_input"):
            h["pkg_temp_c"] = int(rd(hw + "/temp1_input")) // 1000
    h["throttle_count"] = int(rd("/sys/devices/system/cpu/cpu0/thermal_throttle/package_throttle_count") or 0)
    h["cpu_mhz"] = int(rd("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq") or 0) // 1000
    h["ac"] = rd("/sys/class/power_supply/AC/online")
    h["bat_pct"] = rd("/sys/class/power_supply/BAT0/capacity")
    h["bat_status"] = rd("/sys/class/power_supply/BAT0/status")
    st = os.statvfs(D)
    h["disk_free_gb"] = round(st.f_bavail * st.f_frsize / 2**30, 1)
    return h


def iso_to_epoch(s):
    try:
        return datetime.datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc).timestamp()
    except ValueError:
        return None


def summarize(hb, tr, since, now, gaps_in):
    """Numbers for the selected period only."""
    pairs = list(zip(hb, hb[1:]))
    run_s = sum(b["t"] - a["t"] for a, b in pairs if b["t"] - a["t"] <= GAP_S)
    steps = sum(max(0, b["step"] - a["step"]) for a, b in pairs
                if b["t"] - a["t"] <= GAP_S and isinstance(a.get("step"), int) and isinstance(b.get("step"), int))
    losses = [r["loss"] for r in tr if isinstance(r.get("loss"), (int, float))]
    k = max(3, len(losses) // 10)
    temps = [h["cpu_c"] for h in hb if isinstance(h.get("cpu_c"), (int, float))]
    period = max(now - since, 1)
    stopped = sum(max(0.0, min(g["end"], now) - max(g["start"], since)) for g in gaps_in)
    return dict(
        period_s=period, running_s=run_s, steps=steps, spm=(steps / (run_s / 60)) if run_s > 60 else None,
        stops=len(gaps_in), stopped_s=stopped, availability=min(1.0, run_s / period),
        loss_first=(sum(losses[:k]) / k) if len(losses) >= 2 * k else None,
        loss_last=(sum(losses[-k:]) / k) if len(losses) >= 2 * k else None,
        loss_min=min(losses) if losses else None,
        temp_min=min(temps) if temps else None, temp_max=max(temps) if temps else None,
        temp_mean=(sum(temps) / len(temps)) if temps else None,
        temp_hot_share=(sum(t >= 90 for t in temps) / len(temps)) if temps else None,
    )


def aligned(hb, tr, rate, samples):
    """Put every metric on one time grid (bin = at least 60 s, ~240 bins max) so Pearson correlations compare like with like.
    Only bins in which the machine was actually running (a heartbeat exists) are kept; each value is the mean inside its bin.
    thr = CPU package throttle events per second (difference of the cumulative counter between consecutive samples)."""
    if not hb:
        return [], 60
    t0, t1 = hb[0]["t"], hb[-1]["t"]
    binw = max(60, math.ceil(max(t1 - t0, 60) / 240 / 60) * 60)
    acc = {}

    def add(t, key, v):
        try:
            v = float(v)
        except (TypeError, ValueError):
            return
        if v != v:
            return
        acc.setdefault(int((t - t0) // binw), {}).setdefault(key, []).append(v)

    for h in hb:
        add(h["t"], "temp", h.get("cpu_c")); add(h["t"], "load", h.get("load"))
    for r in tr:
        add(r["t"], "loss", r.get("loss")); add(r["t"], "gn", r.get("gn"))
    for r in rate:
        add(r["t"], "spm", r.get("spm"))
    prev = None
    for s in sorted(samples, key=lambda x: x["t"]):
        add(s["t"], "mem", s.get("mem")); add(s["t"], "mhz", s.get("mhz"))
        try:
            c = float(s.get("thr"))
        except (TypeError, ValueError):
            c = None
        if prev is not None and c is not None and 0 < s["t"] - prev[0] <= 900 and c >= prev[1]:
            add(s["t"], "thr", (c - prev[1]) / (s["t"] - prev[0]))      # a reset (reboot) makes c < prev: skipped
        prev = (s["t"], c) if c is not None else prev
    live = {int((h["t"] - t0) // binw) for h in hb}
    out = []
    for k in sorted(acc):
        if k not in live:
            continue
        row = {"t": t0 + k * binw + binw / 2}
        for key, vals in acc[k].items():
            row[key] = sum(vals) / len(vals)
        out.append(row)
    return out, binw


def build(range_key):
    now = time.time()
    hb_all = jsonl(D + "/logs/heartbeat.jsonl")
    gaps_all = []
    for a, b in zip(hb_all, hb_all[1:]):
        if b["t"] - a["t"] > GAP_S:
            gaps_all.append(dict(start=a["t"], end=b["t"], hours=round((b["t"] - a["t"]) / 3600, 2), bat_before=a.get("bat_pct"),
                                 bat_after=b.get("bat_pct"), temp_before=a.get("cpu_c")))
    run_start = gaps_all[-1]["end"] if gaps_all else (hb_all[0]["t"] if hb_all else now)
    spec = RANGES.get(range_key, "run")
    since = run_start if spec == "run" else (0 if spec is None else now - spec)
    inr = lambda r: r.get("t", 0) >= since
    hb = [h for h in hb_all if inr(h)]
    tr = [r for r in jsonl(D + "/logs/train.jsonl") if inr(r)]
    ev = [e for e in jsonl(D + "/logs/eval.jsonl") if inr(e) and isinstance(e.get("hp"), dict) and "net" in e["hp"]]
    gaps = [g for g in gaps_all if g["end"] > since]       # strictly: the stop that ended AT the run start is not "in" the run
    rate = []
    for a, b in zip(hb, hb[1:]):
        dt = b["t"] - a["t"]
        if 30 < dt <= GAP_S and isinstance(a.get("step"), int) and isinstance(b.get("step"), int) and b["step"] >= a["step"]:
            rate.append(dict(t=b["t"], spm=(b["step"] - a["step"]) / dt * 60))
    hbd = [dict(t=h["t"], cpu_c=h.get("cpu_c"), bat=h.get("bat_pct"), ac=h.get("ac"), step=h.get("step"), load=h.get("load")) for h in hb]
    ck = sorted(glob.glob(D + "/ckpt/ckpt_*.npz"))
    ckinfo = [dict(name=os.path.basename(p), size=os.path.getsize(p), mtime=os.path.getmtime(p)) for p in ck[-4:]]
    best = None
    try:
        best = json.load(open(D + "/best_meta.json"))
        best["mtime"] = os.path.getmtime(D + "/best.npz")
    except (OSError, ValueError):
        pass
    try:
        labels = len([f for f in os.listdir(D + "/labels") if f.endswith(".npz")])
        manifest = sum(1 for _ in open(D + "/labels/MANIFEST.sha256"))
        boards = sum(1 for _ in open(D + "/boards.jsonl"))
    except OSError:
        labels = manifest = boards = None
    cfg = None
    try:
        cfg = json.load(open(D + "/config.json"))
    except (OSError, ValueError):
        pass
    samples = []
    try:
        lines = open(W + "/samples.tsv").read().splitlines()
        hdr = lines[0].split("\t")
        for line in lines[1:]:
            f = line.split("\t")
            if len(f) == len(hdr):
                r = dict(zip(hdr, f))
                t = iso_to_epoch(r["utc"])
                if t is not None and t >= since:
                    samples.append(dict(t=t, mem=r["memavail_mb"], swap=r["swap_used_mb"], temp=r["pkg_temp_c"],
                                        thr=r["throttle_pkg_cnt"], mhz=r["cpu0_mhz"]))
    except OSError:
        pass
    last_hb = hb_all[-1] if hb_all else None
    al, bin_s = aligned(hb, tr, rate, samples)
    return dict(
        aligned=al, bin_s=bin_s,
        now=now, range=range_key if range_key in RANGES else "run", since=since, run_start=run_start,
        summary=summarize(hb, tr, since if since else (hb_all[0]["t"] if hb_all else now), now, gaps),
        services=dict(train=unit(TRAIN_UNIT), label=unit("nn-label.service")),
        host=host(),
        heartbeat_age_s=(now - last_hb["t"]) if last_hb else None,
        last_heartbeat=last_hb,
        train=down(tr, avg=("loss", "gn")),
        train_last=(tr[-1] if tr else (jsonl(D + "/logs/train.jsonl") or [None])[-1]),
        eval=ev,
        hb=down(hbd, avg=("cpu_c", "load")),
        rate=down(rate, avg=("spm",)),
        gaps=gaps[-12:],
        n_gaps=len(gaps_all),
        n_gaps_in_range=len(gaps),
        checkpoints=ckinfo,
        best=best,
        dataset=dict(labels=labels, manifest=manifest, boards=boards),
        config=dict(exists=cfg is not None, launch_xy=(cfg or {}).get("launch_xy"), rays_on=bool(cfg and cfg.get("launch_xy"))),
        samples=down(samples, avg=("mem",)),
    )


def stats(range_key):
    key = range_key if range_key in RANGES else "run"
    with _lock:
        c = _cache.get(key)
        if c is None or time.time() - c[0] > 8:
            pick_run()
            _cache[key] = (time.time(), json.dumps(build(key)).encode())
        return _cache[key][1]


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
        if NOAUTH:
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

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == "/auth/challenge":
            return self._send(200, json.dumps({"nonce": AUTH.challenge()}).encode(), "application/json")
        if u.path in ("/", "/index.html") and NOAUTH:
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


NOAUTH = os.environ.get("NN_DASH_NOAUTH") == "1"      # only honoured when bound to loopback
BIND = os.environ.get("NN_DASH_BIND", "127.0.0.1")
AUTH = None

if __name__ == "__main__":
    import sys
    if BIND not in ("127.0.0.1", "::1"):
        NOAUTH = False                                  # never serve unauthenticated off-loopback
    AUTH = auth.Auth(CFG)
    if "--pair" in sys.argv:                            # prints a single-use 5-minute pairing token; run on the machine itself
        print(f"pairing token (single use, 5 min): {AUTH.new_pairing_token()}")
        sys.exit(0)
    S((BIND, PORT), H).serve_forever()
