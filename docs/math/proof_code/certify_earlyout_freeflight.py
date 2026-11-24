# Reference copy for reading (see README.md in this folder). It cannot run on its own: it imports helper modules (reconstruct_toi, compute_angle_windows, test_la_lb_sim)
# that are not part of this repository. Set BALLZ_PROOF_MODULES to a folder containing them, and BALLZ_PROOF_OUT for where result files are written.
"""Source-exact no-contact certificate for free flight, based on the CollidePolygons early-out.

Why a new certificate (31 Oct 2026)
-----------------------------------
`corridor_level_a_proof.py` used tol_toi = 0.00125 m (0.25*linearSlop, from later C++ Box2D) and the
threshold 0.0075 + 0.00125 = 0.00875 m. In this runtime TimeOfImpact receives
`tolerance = b2_linearSlop = 0.005` (c2runtime.js L31466), so the outer-loop acceptance
(L28427) is separation < target + 0.5*tolerance = 0.0100 m. 0.00875 m has no basis in the source.

Sufficient condition used here (c2runtime.js L26948 ff., L27049 ff.)
---------------------------------------------------------------------
A Box2D polygon contact is "touching" (and hence fires BeginContact / Construct 'On collision', and is
accepted by SolveTOI) only if CollidePolygons produces pointCount >= 1. CollidePolygons returns early
with pointCount = 0 when FindMaxSeparation(polyA, polyB) > totalRadius (0.0100 m) OR
FindMaxSeparation(polyB, polyA) > totalRadius. FindMaxSeparation is a *hill climb*: it starts at the
edge whose normal has the largest dot product with the centroid offset and only moves to strictly
better edges, so its return value is >= EdgeSeparation(start edge). Therefore:

  if, for one of the two polygon orders, EVERY possible start edge e has EdgeSeparation(e) > 0.0100 m,
  then CollidePolygons returns no points, whichever fixture the engine treats as A.

This avoids assuming that the hill climb returns the global SAT maximum. We certify this for every
step k, every alpha in [0, 1] (all configurations the discrete and TOI pathways can evaluate), every
target polygon in range, and every theta in each certified sub-interval, in outward-rounded IEEE-754
interval arithmetic. EdgeSeparation for a fixed edge is a minimum of functions affine in alpha, hence
concave in alpha, so its minimum over an alpha-interval is attained at an endpoint.

Free-flight model: identical to certify_interval_arithmetic.py (validated: Proposition 3 window
endpoints agree with the float engine port to 2e-7 deg). A position pad of 1e-9 m and a rotation pad
of 1e-12 cover accumulated binary64 rounding in the engine (<~1e-12 m over 150 steps).
"""
import json
import os
import math
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get("BALLZ_PROOF_MODULES", "."))

import certify_interval_arithmetic as cia
from compute_angle_windows import BLOCKS_SEED3000, proxyA, proxyB, proxyWall
from reconstruct_toi import PolygonProxy

IV = cia.IV
down, up = cia.down, cia.up
R_TOTAL = 0.0100
POS_PAD = 1e-9
ROT_PAD = 1e-12
BALL_R = 0.4851 + 0.005  # max vertex radius + skin (upper bound)


def ex(v):
    return IV.exact(v)


class Target:
    def __init__(self, name, proxy, bx, by, is_block):
        self.name = name
        self.is_block = is_block
        self.bx, self.by = ex(bx), ex(by)
        self.v = [(ex(x), ex(y)) for x, y in proxy.m_vertices]
        self.n = [(ex(x), ex(y)) for x, y in proxy.m_normals]
        self.c = (ex(proxy.m_centroid[0]), ex(proxy.m_centroid[1]))
        self.rad = max(math.hypot(x, y) for x, y in proxy.m_vertices) + 0.005
        self.vw = [(self.bx + x, self.by + y) for x, y in self.v]  # world vertices (angle 0)
        self.cw = (self.bx + self.c[0], self.by + self.c[1])
        self.xmin = min(bx + x for x, y in proxy.m_vertices)
        self.xmax = max(bx + x for x, y in proxy.m_vertices)
        self.ymin = min(by + y for x, y in proxy.m_vertices)
        self.ymax = max(by + y for x, y in proxy.m_vertices)


VA = [(ex(x), ex(y)) for x, y in proxyA.m_vertices]
NA = [(ex(x), ex(y)) for x, y in proxyA.m_normals]
CA = (ex(proxyA.m_centroid[0]), ex(proxyA.m_centroid[1]))
VA_DOT_NA = [VA[i][0] * NA[i][0] + VA[i][1] * NA[i][1] for i in range(8)]

# Top wall t15#21 exactly as in test_la_lb_sim.py
_ang21 = 1.570796370506287
_c21, _s21 = math.cos(_ang21), math.sin(_ang21)
_raw21 = [(-0.32, -7.2), (0.32, -7.2), (0.32, 7.2), (-0.32, 7.2)]
proxyTop = PolygonProxy([(_c21 * x - _s21 * y, _s21 * x + _c21 * y) for x, y in _raw21])

WALLS = [
    Target("t15#19 (Left Wall)", proxyWall, -0.32, 12.8, False),
    Target("t15#20 (Right Wall)", proxyWall, 14.72, 12.8, False),
    Target("t15#21 (Top Wall)", proxyTop, 7.199999986012362, 0.31999968527798844, False),
]


def widen(iv, pad):
    return IV(down(iv.lo - pad), up(iv.hi + pad))


def trig(th_deg):
    th = th_deg * cia.DEG2RAD
    return widen(IV.cos(th), ROT_PAD), widen(IV.sin(th), ROT_PAD)


def pose(k, al, c, s):
    """Body-origin position at step k, fraction al (IV), launch trig c, s (IV)."""
    t = IV(k - 1) + al
    grav = IV(0.5 * (k - 1) * k) + al * IV(k)
    x = IV(7.2) + t * cia.V0_DT_IV * c
    y = IV(1.8) + t * cia.V0_DT_IV * s + grav * cia.G_DT2_IV
    return widen(x, POS_PAD), widen(y, POS_PAD)


def rot(k, c, s):
    return (IV(1.0), IV(0.0)) if k == 1 else (c, s)


def candidates(dots):
    m = max(d.lo for d in dots)
    return [i for i, d in enumerate(dots) if d.hi >= m]


def order1_lb(tgt, x, y, rc, rs):
    """Ball faces as reference (poly1 = ball). Returns per-edge EdgeSeparation lower bound list."""
    out = []
    for i in range(8):
        nwx = rc * NA[i][0] - rs * NA[i][1]
        nwy = rs * NA[i][0] + rc * NA[i][1]
        vals = [(vx - x) * nwx + (vy - y) * nwy for vx, vy in tgt.vw]
        out.append(IV.min_list(vals).lo - VA_DOT_NA[i].hi)
    return out


def order2_lb(tgt, x, y, rc, rs):
    """Target faces as reference (poly1 = target, angle 0)."""
    # min_m (R vA_m) . n  for each target normal n
    out = []
    for j in range(len(tgt.n)):
        nx, ny = tgt.n[j]
        # R^T n
        lx = rc * nx + rs * ny
        ly = -rs * nx + rc * ny
        mn = IV.min_list([vx * lx + vy * ly for vx, vy in VA])
        base = (x - tgt.vw[j][0]) * nx + (y - tgt.vw[j][1]) * ny
        out.append((base + mn).lo)
    return out


def start_dots(tgt, x, y, rc, rs):
    caw_x = x + rc * CA[0] - rs * CA[1]
    caw_y = y + rs * CA[0] + rc * CA[1]
    dx = tgt.cw[0] - caw_x
    dy = tgt.cw[1] - caw_y
    # order 1: d in ball-local frame
    lx = rc * dx + rs * dy
    ly = -rs * dx + rc * dy
    d1 = [NA[i][0] * lx + NA[i][1] * ly for i in range(8)]
    # order 2: -d in target frame (angle 0)
    d2 = [tgt.n[j][0] * (-dx) + tgt.n[j][1] * (-dy) for j in range(len(tgt.n))]
    return d1, d2


def box_ok(tgt, k, a0, a1, c, s):
    """True if CollidePolygons is certified to early-out for all alpha in [a0, a1], theta in (c, s)."""
    rc, rs = rot(k, c, s)
    xa, ya = pose(k, IV(a0), c, s)
    xb, yb = pose(k, IV(a1), c, s)
    xi, yi = pose(k, IV(a0, a1), c, s)
    d1, d2 = start_dots(tgt, xi, yi, rc, rs)
    c1, c2 = candidates(d1), candidates(d2)
    e1a, e1b = order1_lb(tgt, xa, ya, rc, rs), order1_lb(tgt, xb, yb, rc, rs)
    lb1 = min(min(e1a[i], e1b[i]) for i in c1)
    if lb1 > R_TOTAL:
        return True, lb1
    e2a, e2b = order2_lb(tgt, xa, ya, rc, rs), order2_lb(tgt, xb, yb, rc, rs)
    lb2 = min(min(e2a[j], e2b[j]) for j in c2)
    return lb2 > R_TOTAL, max(lb1, lb2)


def far(tgt, k, c, s):
    """Cheap broadphase exclusion over the whole step."""
    xi, yi = pose(k, IV(0.0, 1.0), c, s)
    m = BALL_R + 0.02
    return xi.hi < tgt.xmin - m or xi.lo > tgt.xmax + m or yi.hi < tgt.ymin - m or yi.lo > tgt.ymax + m


def step_ok(tgt, k, c, s, max_split=64):
    if far(tgt, k, c, s):
        return True, None
    n = 1
    worst = None
    while n <= max_split:
        allok = True
        worst = math.inf
        for i in range(n):
            ok, lb = box_ok(tgt, k, i / n, (i + 1) / n, c, s)
            worst = min(worst, lb)
            if not ok:
                allok = False
                break
        if allok:
            return True, worst
        n *= 2
    return False, worst


def theta_interval_ok(lo, hi, targets, k_max_fn, stats):
    th = IV(down(lo), up(hi))
    c, s = trig(th)
    kmax = k_max_fn(c, s)
    if kmax is None:
        return False
    for k in range(1, kmax + 1):
        for tgt in targets:
            ok, lb = step_ok(tgt, k, c, s)
            if not ok:
                return False
            if lb is not None:
                key = tgt.name
                stats[key] = min(stats.get(key, math.inf), lb)
    return True


def certify_range(lo, hi, targets, k_max_fn, min_width=1e-7, init_pieces=64):
    """Adaptive bisection. Returns (certified sub-intervals, uncertified leaves, stats)."""
    stats = {}
    good, bad = [], []
    stack = [(lo + (hi - lo) * i / init_pieces, lo + (hi - lo) * (i + 1) / init_pieces) for i in range(init_pieces)][::-1]
    while stack:
        a, b = stack.pop()
        if theta_interval_ok(a, b, targets, k_max_fn, stats):
            if good and good[-1][1] == a:
                good[-1] = (good[-1][0], b)
            else:
                good.append((a, b))
        elif b - a > min_width:
            m = 0.5 * (a + b)
            stack.append((m, b))
            stack.append((a, m))
        else:
            bad.append((a, b))
    return good, bad, stats


def theta_interval_first_fail(lo, hi, targets, k_max_fn):
    """Return None if certified, else (k, target name) of the first failing (step, target)."""
    th = IV(down(lo), up(hi))
    c, s = trig(th)
    kmax = k_max_fn(c, s)
    if kmax is None:
        return (None, "kmax")
    for k in range(1, kmax + 1):
        for tgt in targets:
            ok, _ = step_ok(tgt, k, c, s)
            if not ok:
                return (k, tgt.name)
    return None


def certify_range_classified(lo, hi, targets, k_max_fn, block_min_width=1e-5, wall_min_width=0.05, init_pieces=256):
    """Like certify_range, but stops bisecting leaves whose first failure is a wall (those angles reach a
    wall before passing below the block, so free flight cannot certify them)."""
    good, wall_leaves, block_leaves = [], [], []
    stack = [(lo + (hi - lo) * i / init_pieces, lo + (hi - lo) * (i + 1) / init_pieces) for i in range(init_pieces)][::-1]
    while stack:
        a, b = stack.pop()
        ff = theta_interval_first_fail(a, b, targets, k_max_fn)
        if ff is None:
            good.append((a, b))
            continue
        is_wall = "Wall" in ff[1]
        if (is_wall and b - a <= wall_min_width) or ((not is_wall) and b - a <= block_min_width):
            (wall_leaves if is_wall else block_leaves).append((a, b, ff[0], ff[1]))
            continue
        m = 0.5 * (a + b)
        stack.append((m, b))
        stack.append((a, m))
    return merge(good), wall_leaves, block_leaves


def kmax_below(y_stop):
    """Number of steps until the ball's lowest possible top is below y_stop for all theta in the box."""
    def fn(c, s):
        for k in range(1, 400):
            _, y0 = pose(k, IV(0.0), c, s)
            if y0.lo - BALL_R > y_stop:
                return k
        return None
    return fn


def merge(iv_list):
    out = []
    for a, b in sorted(iv_list):
        if out and b <= out[-1][1] + 1e-15 or (out and a <= out[-1][1]):
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--which", choices=["corridor", "la4", "la4v2", "all"], default="all")
    args = ap.parse_args()
    t0 = time.time()
    result = {
        "method": __doc__,
        "source_refs": {"toi_tolerance": "c2runtime.js L31466 (tolerance = b2_linearSlop = 0.005)",
                        "toi_outer_acceptance": "L28427 (separation - target < 0.5*tolerance)",
                        "toi_inner_root": "L28456 (|f - target| < 0.025*tolerance)",
                        "find_max_separation_hill_climb": "L26948",
                        "collide_polygons_early_out": "L27049 ff."},
        "r_total_m": R_TOTAL,
    }
    if args.which in ("corridor", "all"):
        TH_LO, TH_HI = 85.29666640, 94.94268989  # unoccluded corridor endpoints (Prop. 4 item 6)
        blocks = [Target(f"t11#{b['uid']}", proxyB, b["bx"], b["by"], True) for b in BLOCKS_SEED3000]
        targets = blocks + WALLS
        y_stop = 28.5  # below every block (max bottom 21.77 m) and below the 25.6 m layout
        rec = {}
        for guard in [0.011, 0.0105, 0.010]:
            lo, hi = TH_LO + guard, TH_HI - guard
            good, bad, stats = certify_range(lo, hi, targets, kmax_below(y_stop), min_width=1e-6)
            g = merge(good)
            rec[f"guard_{guard}"] = {
                "interval_deg": [lo, hi], "certified": g, "uncertified_leaves": bad[:50],
                "n_uncertified_leaves": len(bad),
                "fully_certified": len(bad) == 0 and len(g) == 1 and g[0][0] == lo and g[0][1] == hi,
                "min_start_edge_separation_lb_by_target_m": stats,
                "elapsed_s": time.time() - t0,
            }
            print(f"corridor guard={guard}: fully={rec[f'guard_{guard}']['fully_certified']} "
                  f"bad={len(bad)} minsep={min(stats.values()) if stats else None} t={time.time()-t0:.0f}s", flush=True)
            if len(bad) > 0:
                break
        result["corridor"] = {"theta_lo_deg": TH_LO, "theta_hi_deg": TH_HI, "y_stop_m": y_stop, "runs": rec}

    if args.which == "la4v2":
        from test_la_lb_sim import make_block
        b1 = make_block(1, 360, 220, 4)
        T1 = Target("b1(360,220)", proxyB, b1["bx"], b1["by"], True)
        y_stop = T1.ymax + 0.02   # ball's top below b1's bottom vertex + margin
        segs = {}
        for a, b in [(0.0001, 51.5120), (137.2790, 179.9999)]:
            good, wl, bl = certify_range_classified(a, b, [T1] + WALLS, kmax_below(y_stop))
            segs[f"{a}-{b}"] = {
                "certified_no_contact_until_below_b1": good,
                "certified_width_deg": sum(q - p for p, q in good),
                "wall_reached_first_leaves_merged": merge([(p, q) for p, q, _, _ in wl]),
                "wall_reached_first_width_deg": sum(q - p for p, q, _, _ in wl),
                "b1_grazing_uncertified_leaves_merged": merge([(p, q) for p, q, _, _ in bl]),
                "b1_grazing_uncertified_width_deg": sum(q - p for p, q, _, _ in bl),
            }
            print(f"la4v2 [{a},{b}]: certified {segs[f'{a}-{b}']['certified_width_deg']:.4f} deg, wall-first "
                  f"{segs[f'{a}-{b}']['wall_reached_first_width_deg']:.4f} deg, b1-grazing uncertified "
                  f"{segs[f'{a}-{b}']['b1_grazing_uncertified_width_deg']:.6f} deg, t={time.time()-t0:.0f}s", flush=True)
        result["la4"] = {"b1_body": [b1["bx"], b1["by"]], "y_stop_m": y_stop, "segments": segs,
                         "meaning": "certified: no contact with b1 or any wall until the ball is entirely below b1. "
                                    "wall-first: the ball can reach a side wall before passing below b1; free flight "
                                    "cannot certify these angles (post-wall dynamics not analysed)."}
        args.which = "la4"
    elif args.which in ("la4", "all"):
        from test_la_lb_sim import make_block
        b1 = make_block(1, 360, 220, 4)
        T1 = Target("b1(360,220)", proxyB, b1["bx"], b1["by"], True)
        # (i) strict: no contact with b1 OR any wall until the ball is below y = 28.5 m
        # (ii) b1-only: no contact with b1 and no wall contact while the ball can still reach b1
        #      (until its top is below b1's bottom skin); later wall contacts are not analysed.
        out = {}
        for label, targets, y_stop in [("strict_all_walls_to_28p5m", [T1] + WALLS, 28.5),
                                        ("b1_and_walls_until_below_b1", [T1] + WALLS, T1.ymax + 0.02)]:
            segs = {}
            for a, b in [(0.0001, 51.5120), (137.2790, 179.9999)]:
                good, bad, stats = certify_range(a, b, targets, kmax_below(y_stop), min_width=1e-4, init_pieces=256)
                segs[f"{a}-{b}"] = {"certified": merge(good), "n_uncertified_leaves": len(bad),
                                     "uncertified_leaves_merged": merge(bad),
                                     "certified_width_deg": sum(q - p for p, q in merge(good)),
                                     "min_start_edge_separation_lb_by_target_m": stats}
                print(f"la4 {label} [{a},{b}]: certified width {segs[f'{a}-{b}']['certified_width_deg']:.4f} deg, "
                      f"uncertified leaves {len(bad)} t={time.time()-t0:.0f}s", flush=True)
            out[label] = {"y_stop_m": y_stop, "segments": segs}
        result["la4"] = {"b1_body": [b1["bx"], b1["by"]], "runs": out}
    result["elapsed_s"] = time.time() - t0
    path = os.path.join(os.environ.get("BALLZ_PROOF_OUT", "."), f"earlyout_freeflight_certification_{args.which}.json")
    with open(path, "w") as f:
        json.dump(result, f, indent=2)
    print("wrote", path)
