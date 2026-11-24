#!/usr/bin/env python3
# Reference copy for reading (see README.md in this folder). It cannot run on its own: it imports helper modules (reconstruct_toi, compute_angle_windows, test_la_lb_sim)
# that are not part of this repository. Set BALLZ_PROOF_MODULES to a folder containing them, and BALLZ_PROOF_OUT for where result files are written.
"""
Rerun of both:
1. The source-exact CollidePolygons early-out corridor certificate on
   [85.30766640 deg, 94.93168989 deg] (from certify_earlyout_freeflight.py), and
2. The corridor guard-strip derivative & endpoint certificate (from
   certify_corridor_guard_derivatives.py),
with EVERY trigonometric evaluation (sin, cos, atan/atan2) widened outward by
100 ULPs on both ends (down(..., 100) and up(..., 100)).

Writes a NEW file: <BALLZ_PROOF_OUT>/earlyout_and_guard_100ulp_certification.json
"""
import json
import os
import math
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get("BALLZ_PROOF_MODULES", "."))

import certify_interval_arithmetic as cia
from certify_interval_arithmetic import IV, down, up

TRIG_ULPS = 100


def cos_100ulp(iv_rad: IV) -> IV:
    assert iv_rad.lo >= 0.0 and iv_rad.hi <= math.pi
    return IV(down(math.cos(iv_rad.hi), TRIG_ULPS), up(math.cos(iv_rad.lo), TRIG_ULPS))


def sin_100ulp(iv_rad: IV) -> IV:
    assert iv_rad.lo >= 0.0 and iv_rad.hi <= math.pi
    s_lo = math.sin(iv_rad.lo)
    s_hi = math.sin(iv_rad.hi)
    lo_val = down(min(s_lo, s_hi), TRIG_ULPS)
    if iv_rad.lo <= math.pi / 2.0 <= iv_rad.hi:
        hi_val = up(1.0, TRIG_ULPS)
    else:
        hi_val = up(max(s_lo, s_hi), TRIG_ULPS)
    return IV(lo_val, hi_val)


def atan2_100ulp(iv_y: IV, iv_x: IV) -> IV:
    corners = [
        math.atan2(iv_y.lo, iv_x.lo),
        math.atan2(iv_y.lo, iv_x.hi),
        math.atan2(iv_y.hi, iv_x.lo),
        math.atan2(iv_y.hi, iv_x.hi),
    ]
    return IV(down(min(corners), TRIG_ULPS), up(max(corners), TRIG_ULPS))


# Monkeypatch IV.cos and IV.sin in certify_interval_arithmetic so both modules use 100-ULP trig
cia.IV.cos = staticmethod(cos_100ulp)
cia.IV.sin = staticmethod(sin_100ulp)
cia.IV.atan2 = staticmethod(atan2_100ulp)

import certify_earlyout_freeflight as ceff

# Also widen the top-wall angle rotation by 100 ULPs
_ang21 = 1.570796370506287
_c21_iv = cos_100ulp(IV(down(_ang21, TRIG_ULPS), up(_ang21, TRIG_ULPS)))
_s21_iv = sin_100ulp(IV(down(_ang21, TRIG_ULPS), up(_ang21, TRIG_ULPS)))

t0 = time.time()

# 1. Run early-out corridor certification on [85.30766640, 94.93168989] with 100-ULP trig + existing POS_PAD/ROT_PAD
blocks = [ceff.Target(f"t11#{b['uid']}", ceff.proxyB, b["bx"], b["by"], True) for b in ceff.BLOCKS_SEED3000]
all_tgts = blocks + ceff.WALLS

lo_c = 85.29666639842317 + 0.011
hi_c = 94.94268989444233 - 0.011

good_with_pad, bad_with_pad, stats_with_pad = ceff.certify_range(
    lo_c, hi_c, all_tgts, ceff.kmax_below(28.5), min_width=1e-6, init_pieces=64
)

# 2. Also run early-out corridor certification with 100-ULP trig ONLY (POS_PAD = 0, ROT_PAD = 0)
orig_pos_pad, orig_rot_pad = ceff.POS_PAD, ceff.ROT_PAD
ceff.POS_PAD = 0.0
ceff.ROT_PAD = 0.0
good_pure_100ulp, bad_pure_100ulp, stats_pure_100ulp = ceff.certify_range(
    lo_c, hi_c, all_tgts, ceff.kmax_below(28.5), min_width=1e-6, init_pieces=64
)
ceff.POS_PAD, ceff.ROT_PAD = orig_pos_pad, orig_rot_pad

# 3. Run corridor guard-strip derivative certification with 100-ULP trig (inline, without touching existing JSON)
PI_IV = IV(down(math.pi), up(math.pi))
DEG_TO_RAD = PI_IV / IV(180.0)
dt_iv = cia.DT_IV
g_iv = cia.G_IV
F_iv = cia.F_IV
vertsA_iv = [(IV(vx), IV(vy)) for vx, vy in ceff.proxyA.m_vertices]
vertsB_iv = [(IV(vx), IV(vy)) for vx, vy in ceff.proxyB.m_vertices]
normsA_iv = [(IV(nx), IV(ny)) for nx, ny in ceff.proxyA.m_normals]
normsB_iv = [(IV(nx), IV(ny)) for nx, ny in ceff.proxyB.m_normals]
area_iv = IV(0.0)
for i in range(8):
    x1, y1 = vertsA_iv[i]
    x2, y2 = vertsA_iv[(i + 1) % 8]
    area_iv = area_iv + IV(0.5) * (x1 * y2 - y1 * x2)
v0_iv = (dt_iv / area_iv) * F_iv


def eval_axis_iv_100(uid, k, al_iv, th_iv, kind, idx):
    b = next(x for x in ceff.BLOCKS_SEED3000 if x["uid"] == uid)
    bx_iv, by_iv = IV(b["bx"]), IV(b["by"])
    k_iv, km1_iv = IV(float(k)), IV(float(k - 1))
    c_iv, s_iv = cos_100ulp(th_iv), sin_100ulp(th_iv)
    t_step = km1_iv + al_iv
    xk = IV(7.2) + t_step * v0_iv * dt_iv * c_iv
    yk = IV(1.8) + t_step * v0_iv * dt_iv * s_iv + (IV(0.5) * km1_iv * k_iv + al_iv * k_iv) * g_iv * dt_iv * dt_iv
    pA = [(xk + c_iv * vx - s_iv * vy, yk + s_iv * vx + c_iv * vy) for vx, vy in vertsA_iv]
    pB = [(bx_iv + vx, by_iv + vy) for vx, vy in vertsB_iv]
    if kind == "B":
        nx, ny = normsB_iv[idx]
        vBx, vBy = pB[idx]
        vals = [(px - vBx) * nx + (py - vBy) * ny for px, py in pA]
    else:
        nlx, nly = normsA_iv[idx]
        nx, ny = c_iv * nlx - s_iv * nly, s_iv * nlx + c_iv * nly
        vAx, vAy = pA[idx]
        vals = [(px - vAx) * nx + (py - vAy) * ny for px, py in pB]
    return IV(min(v.lo for v in vals), min(v.hi for v in vals))


def exact_min_max2_iv_100(uid, k, th_deg, ax1, ax2):
    th_iv = IV(th_deg) * DEG_TO_RAD
    s1_0 = eval_axis_iv_100(uid, k, IV(0.0), th_iv, *ax1)
    s1_1 = eval_axis_iv_100(uid, k, IV(1.0), th_iv, *ax1)
    s2_0 = eval_axis_iv_100(uid, k, IV(0.0), th_iv, *ax2)
    s2_1 = eval_axis_iv_100(uid, k, IV(1.0), th_iv, *ax2)
    max_0 = IV(max(s1_0.lo, s2_0.lo), max(s1_0.hi, s2_0.hi))
    max_1 = IV(max(s1_1.lo, s2_1.lo), max(s1_1.hi, s2_1.hi))
    d0 = s1_0 - s2_0
    d1 = s1_1 - s2_1
    candidates_lo = [max_0.lo, max_1.lo]
    candidates_hi = [max_0.hi, max_1.hi]
    if d0.lo * d1.hi < 0 or d0.hi * d1.lo < 0:
        denom = d0 - d1
        if denom.lo > 0.0 or denom.hi < 0.0:
            al_star = d0 / denom
            al_clamped = IV(max(0.0, min(1.0, al_star.lo)), max(0.0, min(1.0, al_star.hi)))
            val_star = s1_0 + al_clamped * (s1_1 - s1_0)
            candidates_lo.append(val_star.lo)
            candidates_hi.append(val_star.hi)
    return {
        "min_val_iv": [min(candidates_lo), min(candidates_hi)],
        "step_start_alpha0_iv": [max_0.lo, max_0.hi],
        "certified_gt_0p0100": bool(min(candidates_lo) > 0.0100 and max_0.lo > 0.0100),
    }


guard_100ulp = {
    "uid24_k31_at_85p30766640": exact_min_max2_iv_100(24, 31, 85.30766640, ("A", 1), ("B", 6)),
    "uid22_k29_at_94p93168989": exact_min_max2_iv_100(22, 29, 94.93168989, ("A", 4), ("B", 3)),
}

elapsed = time.time() - t0

out = {
    "trig_widening_ulps": TRIG_ULPS,
    "how_trig_bounds_were_originally_computed": {
        "certify_interval_arithmetic_IV_cos_sin": (
            "In certify_interval_arithmetic.py (lines 85-99), IV.cos(iv_rad) and IV.sin(iv_rad) "
            "assert 0 <= iv_rad.lo <= iv_rad.hi <= pi, evaluate math.cos / math.sin at the interval "
            "endpoints, and widen outward by 2 ULPs on each end via down(..., 2) and up(..., 2) "
            "(iterating math.nextafter toward -inf and +inf twice). Elementary operations (+, -, *, /, sqrt) "
            "widen outward by 1 ULP via down(..., 1) and up(..., 1). PI_IV is [down(math.pi, 1), up(math.pi, 1)]."
        ),
        "certify_earlyout_freeflight_trig_and_pose": (
            "In certify_earlyout_freeflight.py (lines 47-48, 91-106), trig(th_deg) converts th_deg * DEG2RAD, "
            "calls IV.cos(th) and IV.sin(th) (2 ULPs outward), and then applies widen(..., ROT_PAD) with "
            "ROT_PAD = 1e-12 (~4,500 ULPs near 1.0 and ~72,000 ULPs near |cos(85.3 deg)| = 0.082) plus "
            "1 ULP via down/up. Furthermore, pose(k, al, c, s) widens the world coordinates (x, y) by "
            "POS_PAD = 1e-9 m (~1.1e6 ULPs at x = 7.2 m) plus 1 ULP."
        ),
        "certify_corridor_guard_derivatives": (
            "In certify_corridor_guard_derivatives.py, IV.cos and IV.sin from certify_interval_arithmetic.py "
            "(2 ULPs outward) are used directly without additional ROT_PAD/POS_PAD."
        ),
    },
    "earlyout_corridor_with_100ulp_trig_and_pads": {
        "range_deg": [lo_c, hi_c],
        "fully_certified": len(bad_with_pad) == 0,
        "certified_intervals": good_with_pad,
        "uncertified_intervals": bad_with_pad,
        "min_certified_start_edge_sep_by_target_m": stats_with_pad,
        "global_min_sep_m": min(stats_with_pad.values()),
    },
    "earlyout_corridor_with_100ulp_trig_only_no_extra_pad": {
        "range_deg": [lo_c, hi_c],
        "fully_certified": len(bad_pure_100ulp) == 0,
        "certified_intervals": good_pure_100ulp,
        "uncertified_intervals": bad_pure_100ulp,
        "min_certified_start_edge_sep_by_target_m": stats_pure_100ulp,
        "global_min_sep_m": min(stats_pure_100ulp.values()),
    },
    "guard_derivative_certification_with_100ulp_trig": guard_100ulp,
    "elapsed_s": elapsed,
}

out_path = os.path.join(os.environ.get("BALLZ_PROOF_OUT", "."), "earlyout_and_guard_100ulp_certification.json")
with open(out_path, "w") as f:
    json.dump(out, f, indent=2)

print("Wrote", out_path)
print("With 100-ULP trig + pads: fully_certified =", out["earlyout_corridor_with_100ulp_trig_and_pads"]["fully_certified"],
      "global_min_sep_m =", out["earlyout_corridor_with_100ulp_trig_and_pads"]["global_min_sep_m"])
print("With 100-ULP trig only:   fully_certified =", out["earlyout_corridor_with_100ulp_trig_only_no_extra_pad"]["fully_certified"],
      "global_min_sep_m =", out["earlyout_corridor_with_100ulp_trig_only_no_extra_pad"]["global_min_sep_m"])
print("Guard derivative k=31 at_theta_lo_shrunk:", guard_100ulp["uid24_k31_at_85p30766640"]["min_val_iv"])
print("Guard derivative k=29 at_theta_hi_shrunk:", guard_100ulp["uid22_k29_at_94p93168989"]["min_val_iv"])
