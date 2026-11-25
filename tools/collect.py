#!/usr/bin/env python3
"""Pick up volunteers' results from the relay channel and append them to a local file. Standard library only. Stores only the results and the time received.
Usage: python3 tools/collect.py web/contribute/collector.json results.jsonl [--once]   (check the results afterwards with tools/check_results.js)"""
import base64, json, os, re, sys, time, urllib.request, zlib

MAX_RAW = 200_000                                    # the most a compressed message may expand to
MAX_UNITS = 250                                      # the most results taken from one message
MAX_REPLY = 20_000_000                               # the most read from the relay in one go
MAX_FILE = 500_000_000                               # stop storing here, so a flood cannot fill the disk
ID = re.compile(r"[A-Za-z0-9_-]{1,64}")              # relay message ids; anything else is never put into an address


def good(r):
    return isinstance(r, dict) and isinstance(r.get("u"), int) and r["u"] >= 0 and isinstance(r.get("d"), list) and isinstance(r.get("m"), list) and 0 < len(r["d"]) == len(r["m"]) <= 40 and all(isinstance(x, int) and x >= 0 for x in r["d"]) and ("k" not in r or isinstance(r["k"], list) and len(r["k"]) == len(r["d"]) and all(isinstance(x, int) and x >= 0 for x in r["k"]))


def unpack(z):
    """The compressed form (version 4: gzip, then base64). The channel is public, so expansion is capped and anything odd is ignored."""
    try:
        d = zlib.decompressobj(31); raw = d.decompress(base64.b64decode(z, validate=True), MAX_RAW)
        return json.loads(raw) if d.eof else None
    except (ValueError, TypeError, RecursionError, zlib.error):
        return None


def results_in(message):
    try:
        data = json.loads(message)
    except (ValueError, RecursionError):
        return []
    if isinstance(data, dict) and data.get("v") == 4:
        data = unpack(data.get("z"))
    return [{key: r[key] for key in ("u", "d", "m", "k") if key in r} for r in data.get("results", [])[:MAX_UNITS] if good(r)] if isinstance(data, dict) and data.get("v") == 3 and isinstance(data.get("results"), list) else []


def poll(url, since):
    req = urllib.request.Request(f"{url}/json?poll=1&since={since}", headers={"User-Agent": "nn-collector"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read(MAX_REPLY + 1)
    if len(raw) > MAX_REPLY:
        raw = raw[:raw.rfind(b"\n") + 1]              # keep whole lines; the rest comes on the next poll
    return [json.loads(line) for line in raw.decode("utf-8", "replace").splitlines() if line.strip()]


def main(config, out, once):
    url = json.load(open(config))["endpoint"]; since = "all"; state = out + ".since"
    if not url.startswith("https://"):
        sys.exit("the relay address must start with https://")
    try:
        saved = open(state).read().strip(); since = saved if ID.fullmatch(saved) else "all"
    except OSError:
        pass
    while True:
        try:
            for ev in poll(url, since):
                if ev.get("event") != "message" or not ID.fullmatch(str(ev.get("id", ""))):
                    continue
                got = results_in(ev.get("message", ""))
                if os.path.exists(out) and os.path.getsize(out) > MAX_FILE:
                    print(f"results file is over {MAX_FILE:,} bytes: not storing more until it is moved", flush=True); got = []
                with open(out, "a") as f:
                    for r in got:
                        f.write(json.dumps(dict(r, received=ev.get("time") if isinstance(ev.get("time"), int) else None)) + "\n")
                since = ev["id"]; open(state, "w").write(since)
                print(f"{time.strftime('%F %T')} message: {len(got)} units, {sum(len(r['d']) for r in got)} shots", flush=True)
        except Exception as e:                      # offline or relay trouble: try again
            print(f"{time.strftime('%F %T')} poll failed: {type(e).__name__}", flush=True)
        if once:
            return
        time.sleep(15)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], "--once" in sys.argv)
