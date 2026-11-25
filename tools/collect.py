#!/usr/bin/env python3
"""Pick up volunteers' results from the relay channel and append them to a local file. Standard library only. Stores only the results and the time received.
Usage: python3 tools/collect.py web/contribute/collector.json results.jsonl [--once]   (check the results afterwards with tools/check_results.js)"""
import base64, json, sys, time, urllib.request, zlib

MAX_RAW = 200_000                                    # the most a compressed message may expand to


def good(r):
    return isinstance(r, dict) and isinstance(r.get("u"), int) and r["u"] >= 0 and isinstance(r.get("d"), list) and isinstance(r.get("m"), list) and 0 < len(r["d"]) == len(r["m"]) <= 40 and all(isinstance(x, int) and x >= 0 for x in r["d"])


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
    return [{"u": r["u"], "d": r["d"], "m": r["m"]} for r in data.get("results", []) if good(r)] if isinstance(data, dict) and data.get("v") == 3 and isinstance(data.get("results"), list) else []


def poll(url, since):
    req = urllib.request.Request(f"{url}/json?poll=1&since={since}", headers={"User-Agent": "nn-collector"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return [json.loads(line) for line in resp.read().decode().splitlines() if line.strip()]


def main(config, out, once):
    url = json.load(open(config))["endpoint"]; since = "all"; state = out + ".since"
    try:
        since = open(state).read().strip() or "all"
    except OSError:
        pass
    while True:
        try:
            for ev in poll(url, since):
                if ev.get("event") != "message":
                    continue
                got = results_in(ev.get("message", ""))
                with open(out, "a") as f:
                    for r in got:
                        f.write(json.dumps(dict(r, received=ev.get("time"))) + "\n")
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
