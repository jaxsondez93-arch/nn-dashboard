#!/usr/bin/env python3
"""Generate a SYNTHETIC training run so the dashboard can be tried without any real data. Standard library only.

    python3 demo/make_demo_data.py demo_run          # 5 days of fake data ending now
    NN_DATA=demo_run NN_WORK=demo_run NN_DASH_NOAUTH=1 python3 server.py

Everything here is invented: a loss that decays, a laptop that heats up under load and slows down when it does, two machine stops, a validation score that wanders.
The numbers only exist so the charts have something to draw; they say nothing about any real model."""
import json, math, os, random, sys, time


def make(out, days=5.0, seed=7, now=None):
    rng = random.Random(seed)                               # seeded: the demo looks the same every time
    now = now or time.time(); start = now - days * 86400
    for d in ("logs", "ckpt"): os.makedirs(os.path.join(out, d), exist_ok=True)
    stops = [(start + days * 86400 * 0.30, 40 * 60, 53), (start + days * 86400 * 0.62, 6 * 3600, 4)]   # (begin, length in s, battery % when it comes back)
    hb, tr, ev, samples, ckpts = [], [], [], [], []
    step, bat, last_ck, last_ev, last_sm = 0, 80.0, start, start, start
    t = start
    while t < now:
        stop = next((s for s in stops if s[0] <= t < s[0] + s[1]), None)
        if stop:
            t = stop[0] + stop[1]; bat = float(stop[2]); continue                    # the machine was off: no heartbeat in this window
        load = max(0.2, 1.1 + 0.7 * math.sin(t / 5400.0) + rng.gauss(0, 0.12))
        temp = min(99.0, 62 + 17 * load + rng.gauss(0, 1.6))
        spm = max(1500.0, 4800 - 55 * max(0.0, temp - 72) + rng.gauss(0, 90))        # hotter -> throttled -> slower
        step += int(spm); bat = min(80.0, bat + 0.6) if bat < 80 else 79.0
        hb.append(dict(t=t, iso=time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(t)), ac="1", bat_pct=str(int(bat)), bat_status="Charging" if bat < 80 else "Not charging",
                       cpu_c=round(temp, 1), load=round(load, 2), step=step, boards_train=896, rows_train=87468, ckpt_age=int(t - last_ck), training=True))
        tr.append(dict(t=t, step=step, loss=round(2.30 + 0.9 * math.exp(-step / 120000.0) + rng.gauss(0, 0.004), 5), gn=round(2.0 + rng.gauss(0, 0.15), 4), lr=0.0004, rows=87468))
        if t - last_ev >= 900:
            last_ev = t; ev.append(dict(t=t, step=step, n_val=55, ver=1, hp=dict(random30=3.27, stride26=3.16, stride8=1.91, heuristic=3.42, net=round(3.1 - 0.00000015 * step + rng.gauss(0, 0.12), 4)), dev=dict(net=1.0, random=1.59, n=207)))
        if t - last_sm >= 300:
            last_sm = t; samples.append(dict(utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t)), mem=int(11000 + rng.gauss(0, 400)), swap=0, temp=round(temp), thr=int(max(0, temp - 80) * 40), mhz=int(3500 - 25 * max(0, temp - 80))))
        if t - last_ck >= 1200:
            last_ck = t; ckpts.append((step, t))
        t += 60
    with open(os.path.join(out, "logs/heartbeat.jsonl"), "w") as f: f.write("".join(json.dumps(r) + "\n" for r in hb))
    with open(os.path.join(out, "logs/train.jsonl"), "w") as f: f.write("".join(json.dumps(r) + "\n" for r in tr))
    with open(os.path.join(out, "logs/eval.jsonl"), "w") as f: f.write("".join(json.dumps(r) + "\n" for r in ev))
    for s, ts in ckpts[-10:]:
        p = os.path.join(out, "ckpt", f"ckpt_{s:010d}.npz")
        with open(p, "wb") as f: f.write(b"demo-checkpoint\0" * 256)
        os.utime(p, (ts, ts))
    with open(os.path.join(out, "best.npz"), "wb") as f: f.write(b"demo-best\0" * 256)
    json.dump(dict(dev_regret=0.74, step=2033, n_dev=207, protocol="demo"), open(os.path.join(out, "best_meta.json"), "w"))
    json.dump(dict(launch_xy=[360.0, 90.0], field_w=720.0), open(os.path.join(out, "config.json"), "w"))
    with open(os.path.join(out, "samples.tsv"), "w") as f:
        f.write("utc\tmemavail_mb\tswap_used_mb\tpkg_temp_c\tthrottle_pkg_cnt\tcpu0_mhz\n")
        f.write("".join(f"{r['utc']}\t{r['mem']}\t{r['swap']}\t{r['temp']}\t{r['thr']}\t{r['mhz']}\n" for r in samples))
    return dict(heartbeats=len(hb), train_rows=len(tr), evals=len(ev), stops=len(stops), final_step=step)


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "demo_run"
    print(make(out), "->", out)
