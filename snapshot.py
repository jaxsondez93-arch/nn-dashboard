"""Assemble the JSON the page draws (`build`) and cache it for a few seconds (`stats`)."""
import glob, json, os, threading, time

from analysis import GAP_S, RANGES, aligned, down, summarize
from settings import settings
from sources import demo_host, demo_unit, host, iso_to_epoch, jsonl, rd, unit

_cache = {}
_lock = threading.Lock()


def pick_run():
    """Follow the current run automatically. Among the configured runs (NN_RUNS), the one whose trainer unit is active wins; otherwise the one with the freshest heartbeat."""
    best = None
    for d, u in settings.runs:
        d = os.path.expanduser(d)
        try:
            m = os.path.getmtime(d + "/logs/heartbeat.jsonl")
        except OSError:
            continue
        key = (unit(u).get("ActiveState") == "active", m)
        if best is None or key > best[0]:
            best = (key, d, u)
    if best:
        settings.data_dir, settings.train_unit = best[1], best[2]


def build(range_key):
    D, W = settings.data_dir, settings.work_dir
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
        services=dict(train=demo_unit(), label=demo_unit()) if settings.demo else dict(train=unit(settings.train_unit), label=unit("nn-label.service")),
        host=demo_host(last_hb) if settings.demo else host(D),
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

