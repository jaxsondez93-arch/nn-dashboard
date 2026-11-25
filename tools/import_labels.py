#!/usr/bin/env python3
"""Turn verified volunteer results into extra label files for training (private step; writes into a NEW folder, never over existing labels).
Usage: python3 tools/import_labels.py verified.jsonl board_map.json OUT_DIR     (board_map.json: list mapping the public board number to the private board id)"""
import hashlib, json, os, re, sys
import numpy as np


def main(verified, board_map, out):
    ids = json.load(open(board_map)); os.makedirs(out, exist_ok=True); per = {}
    for line in open(verified):
        if line.strip():
            r = json.loads(line); b = per.setdefault(r["board"], {}); b.update({a: (d, m, g) for a, d, m, g in zip(r["aims"], r["d"], r["m"], r.get("k") or [-1] * len(r["d"]))})
    for k, got in per.items():
        bid = ids[k]; aims = sorted(got); safe = re.sub(r"[^A-Za-z0-9_.-]", "_", bid)[:80]; h = int(hashlib.sha256(bid.encode()).hexdigest()[:8], 16)
        np.savez(os.path.join(out, f"{safe}_{h:08x}.npz"), board_id=np.array(bid), aim_idx=np.array(aims, np.int32), hp=np.array([got[a][0] for a in aims], np.float32),
                 slack=np.array([np.nan if got[a][1] is None else got[a][1] / 100 for a in aims], np.float32), lost=np.array([got[a][1] is not None and got[a][1] <= 0 for a in aims]),
                 pickups=np.array([got[a][2] for a in aims], np.int8))      # pickups collected; -1 = not recorded
    print(f"wrote {len(per)} board files with {sum(len(v) for v in per.values())} new labelled shots into {out}")


if __name__ == "__main__":
    if len(sys.argv) != 4: sys.exit(__doc__)
    main(*sys.argv[1:])
