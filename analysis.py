"""Pure statistics helpers: no files, no clock, no network, so they are easy to test.

down()       shrink a long list of rows to at most n points for drawing
summarize()  the "This period" numbers
aligned()    put every metric on one shared time grid so correlations compare like with like"""
import math

MAXPTS = 700        # most points sent to the page per series
GAP_S = 180         # a heartbeat gap longer than this (seconds) counts as a machine stop
RANGES = {"live": 1800, "1h": 3600, "6h": 6 * 3600, "24h": 86400, "7d": 7 * 86400, "all": None, "run": "run"}   # seconds back; None = everything; "run" = since the last stop


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

