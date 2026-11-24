#!/usr/bin/env python3
# Reference copy for reading (see README.md in this folder). It cannot run on its own: it imports helper modules (reconstruct_toi, compute_angle_windows, test_la_lb_sim)
# that are not part of this repository. Set BALLZ_PROOF_MODULES to a folder containing them, and BALLZ_PROOF_OUT for where result files are written.
"""
Outward-rounded IEEE-754 interval certification of:
1. The theta-derivative bounds on the active SAT axes (A1, B6, B7 on t11#24;
   A4, B2, B3 on t11#22) over the 0.011 deg guard strips
   [theta_lo, theta_lo + 0.011 deg] and [theta_hi - 0.011 deg, theta_hi],
   as well as over the shrunk corridor [theta_lo + 0.011 deg, theta_hi - 0.011 deg].
2. The exact closed-form alpha in [0, 1] minimum of max(sep_ax1, sep_ax2) AND
   the step-boundary alpha = 0 separation at the shrunk corridor endpoints
   theta_lo' = 85.30766640 deg and theta_hi' = 94.93168989 deg, proving both
   exceed the source-exact threshold 0.0100 m.
Writes a NEW file: <BALLZ_PROOF_OUT>/corridor_guard_derivative_certification.json
"""
import json
import os
import math
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get("BALLZ_PROOF_MODULES", "."))

from certify_interval_arithmetic import IV, down, up, PI_IV, DEG2RAD, DT_IV, G_IV, F_IV
from reconstruct_toi import PolygonProxy, build_c2_poly, t9_raw, t11_raw, t11_hx, t11_hy
from compute_angle_windows import BLOCKS_SEED3000

proxyA = PolygonProxy(build_c2_poly(t9_raw, 50.0, 50.0, 0.5, 0.5))
proxyB = PolygonProxy(build_c2_poly(t11_raw, 120.0, 120.0, t11_hx, t11_hy))

DEG_TO_RAD = DEG2RAD
dt_iv = DT_IV
g_iv = G_IV
F_iv = F_IV
iv_cos = IV.cos
iv_sin = IV.sin
iv_sqrt = lambda x: IV(down(math.sqrt(x.lo)), up(math.sqrt(x.hi)))

# Interval polygon vertices & normals
vertsA_iv = [(IV(vx), IV(vy)) for vx, vy in proxyA.m_vertices]
vertsB_iv = [(IV(vx), IV(vy)) for vx, vy in proxyB.m_vertices]
normsA_iv = [(IV(nx), IV(ny)) for nx, ny in proxyA.m_normals]
normsB_iv = [(IV(nx), IV(ny)) for nx, ny in proxyB.m_normals]

area_iv = IV(0.0)
for i in range(8):
    x1, y1 = vertsA_iv[i]
    x2, y2 = vertsA_iv[(i + 1) % 8]
    area_iv = area_iv + IV(0.5) * (x1 * y2 - y1 * x2)
v0_iv = (dt_iv / area_iv) * F_iv

R_A_max_iv = IV(0.0)
for vx, vy in vertsA_iv:
    r = iv_sqrt(vx * vx + vy * vy)
    R_A_max_iv = IV(max(R_A_max_iv.lo, r.lo), max(R_A_max_iv.hi, r.hi))

th_lo_deg = 85.29666639842317
th_hi_deg = 94.94268989444233
guard_deg = 0.011
th_lo_shrunk_deg = 85.30766640
th_hi_shrunk_deg = 94.93168989

THRESH_SOURCE_EXACT = 0.0100


def eval_axis_iv(uid, k, al_iv, th_iv, kind, idx):
    b = next(x for x in BLOCKS_SEED3000 if x["uid"] == uid)
    bx_iv, by_iv = IV(b["bx"]), IV(b["by"])
    k_iv = IV(float(k))
    km1_iv = IV(float(k - 1))
    c_iv = iv_cos(th_iv)
    s_iv = iv_sin(th_iv)
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
    lo = min(v.lo for v in vals)
    hi = min(v.hi for v in vals)
    return IV(lo, hi)


def exact_min_max2_iv(uid, k, th_deg, ax1, ax2):
    th_iv = IV(th_deg) * DEG_TO_RAD
    s1_0 = eval_axis_iv(uid, k, IV(0.0), th_iv, *ax1)
    s1_1 = eval_axis_iv(uid, k, IV(1.0), th_iv, *ax1)
    s2_0 = eval_axis_iv(uid, k, IV(0.0), th_iv, *ax2)
    s2_1 = eval_axis_iv(uid, k, IV(1.0), th_iv, *ax2)

    max_0 = IV(max(s1_0.lo, s2_0.lo), max(s1_0.hi, s2_0.hi))
    max_1 = IV(max(s1_1.lo, s2_1.lo), max(s1_1.hi, s2_1.hi))

    d0 = s1_0 - s2_0
    d1 = s1_1 - s2_1
    candidates_lo = [max_0.lo, max_1.lo]
    candidates_hi = [max_0.hi, max_1.hi]
    al_star_out = None
    # Check if a crossing can occur in [0, 1]
    if d0.lo * d1.hi < 0 or d0.hi * d1.lo < 0:
        denom = d0 - d1
        if denom.lo > 0.0 or denom.hi < 0.0:
            al_star = d0 / denom
            al_clamped = IV(max(0.0, min(1.0, al_star.lo)), max(0.0, min(1.0, al_star.hi)))
            val_star = s1_0 + al_clamped * (s1_1 - s1_0)
            candidates_lo.append(val_star.lo)
            candidates_hi.append(val_star.hi)
            al_star_out = [al_clamped.lo, al_clamped.hi]

    min_lo = min(candidates_lo)
    min_hi = min(candidates_hi)
    return {
        "min_val_iv": [min_lo, min_hi],
        "step_start_alpha0_iv": [max_0.lo, max_0.hi],
        "step_end_alpha1_iv": [max_1.lo, max_1.hi],
        "alpha_star_iv": al_star_out,
        "ax1": f"{ax1[0]}{ax1[1]}",
        "ax2": f"{ax2[0]}{ax2[1]}",
        "certified_gt_0p0100": bool(min_lo > THRESH_SOURCE_EXACT and max_0.lo > THRESH_SOURCE_EXACT),
    }


def certify_dsep_bounds_iv(uid, k, th_iv_deg_lo, th_iv_deg_hi):
    """
    Certify interval bounds on d(sep)/d(theta) over theta in [th_iv_deg_lo, th_iv_deg_hi]
    and alpha in [0, 1] for every block-face and ball-face axis used on step k.
    For a block-face normal n_B = (nx, ny):
      sep_{B,j}(alpha, theta) = min_m (x_k(alpha, theta) + R(theta) v_m - b_j) . n_B
      d/dtheta [(x_k + R(theta) v_m - b_j) . n_B]
        = (dx_k/dtheta) * nx + (dy_k/dtheta) * ny + (R'(theta) v_m) . n_B
    For a ball-face normal n_{A,i}(theta) = R(theta) n_{A,i}^0:
      sep_{A,i}(alpha, theta) = min_m (b_m - x_k(alpha, theta)) . n_{A,i}(theta) - v_i^0 . n_{A,i}^0
      d/dtheta [(b_m - x_k) . n_{A,i}(theta)]
        = -(dx_k/dtheta) * nx_A(theta) - (dy_k/dtheta) * ny_A(theta)
          + (b_m - x_k(alpha, theta)) . n_{A,i}^perp(theta)
    """
    b = next(x for x in BLOCKS_SEED3000 if x["uid"] == uid)
    bx_iv, by_iv = IV(b["bx"]), IV(b["by"])
    th_iv = IV(th_iv_deg_lo, th_iv_deg_hi) * DEG_TO_RAD
    c_iv = iv_cos(th_iv)
    s_iv = iv_sin(th_iv)
    al_iv = IV(0.0, 1.0)
    k_iv = IV(float(k))
    km1_iv = IV(float(k - 1))
    t_step = km1_iv + al_iv

    # Trajectory and its exact theta-derivative over (alpha in [0, 1], theta in th_iv)
    xk_iv = IV(7.2) + t_step * v0_iv * dt_iv * c_iv
    yk_iv = IV(1.8) + t_step * v0_iv * dt_iv * s_iv + (IV(0.5) * km1_iv * k_iv + al_iv * k_iv) * g_iv * dt_iv * dt_iv
    dxk_dth = -t_step * v0_iv * dt_iv * s_iv
    dyk_dth = t_step * v0_iv * dt_iv * c_iv

    if uid == 24:
        # Active axes on uid 24: B6, B7, A1
        out = {}
        for idx in [6, 7]:
            nx, ny = normsB_iv[idx]
            # R'(theta) v_m = (-s*vx - c*vy, c*vx - s*vy)
            rot_terms = [(-s_iv * vx - c_iv * vy) * nx + (c_iv * vx - s_iv * vy) * ny for vx, vy in vertsA_iv]
            rot_env = IV(min(r.lo for r in rot_terms), max(r.hi for r in rot_terms))
            dsep = dxk_dth * nx + dyk_dth * ny + rot_env
            out[f"B{idx}_dtheta_rad_iv"] = [dsep.lo, dsep.hi]
            out[f"B{idx}_dtheta_deg_iv"] = [(dsep * DEG_TO_RAD).lo, (dsep * DEG_TO_RAD).hi]
        # Axis A1
        nlx, nly = normsA_iv[1]
        nx_A = c_iv * nlx - s_iv * nly
        ny_A = s_iv * nlx + c_iv * nly
        # n_A^perp = (-ny_A, nx_A)
        lever_terms = [((bx_iv + vx) - xk_iv) * (-ny_A) + ((by_iv + vy) - yk_iv) * nx_A for vx, vy in vertsB_iv]
        lever_env = IV(min(r.lo for r in lever_terms), max(r.hi for r in lever_terms))
        dsep_A1 = (-dxk_dth) * nx_A + (-dyk_dth) * ny_A + lever_env
        out["A1_dtheta_rad_iv"] = [dsep_A1.lo, dsep_A1.hi]
        out["A1_dtheta_deg_iv"] = [(dsep_A1 * DEG_TO_RAD).lo, (dsep_A1 * DEG_TO_RAD).hi]
        return out
    else:
        # Active axes on uid 22: B2, B3, A4
        out = {}
        for idx in [2, 3]:
            nx, ny = normsB_iv[idx]
            rot_terms = [(-s_iv * vx - c_iv * vy) * nx + (c_iv * vx - s_iv * vy) * ny for vx, vy in vertsA_iv]
            rot_env = IV(min(r.lo for r in rot_terms), max(r.hi for r in rot_terms))
            dsep = dxk_dth * nx + dyk_dth * ny + rot_env
            out[f"B{idx}_dtheta_rad_iv"] = [dsep.lo, dsep.hi]
            out[f"B{idx}_dtheta_deg_iv"] = [(dsep * DEG_TO_RAD).lo, (dsep * DEG_TO_RAD).hi]
        # Axis A4
        nlx, nly = normsA_iv[4]
        nx_A = c_iv * nlx - s_iv * nly
        ny_A = s_iv * nlx + c_iv * nly
        lever_terms = [((bx_iv + vx) - xk_iv) * (-ny_A) + ((by_iv + vy) - yk_iv) * nx_A for vx, vy in vertsB_iv]
        lever_env = IV(min(r.lo for r in lever_terms), max(r.hi for r in lever_terms))
        dsep_A4 = (-dxk_dth) * nx_A + (-dyk_dth) * ny_A + lever_env
        out["A4_dtheta_rad_iv"] = [dsep_A4.lo, dsep_A4.hi]
        out["A4_dtheta_deg_iv"] = [(dsep_A4 * DEG_TO_RAD).lo, (dsep_A4 * DEG_TO_RAD).hi]
        return out


results = {
    "description": (
        "Outward-rounded IEEE-754 interval certification of the SAT separation derivative bounds "
        "over the 0.011 deg guard strips [85.29666640 deg, 85.30766640 deg] and "
        "[94.93168989 deg, 94.94268989 deg] and across the shrunk interior "
        "[85.30766640 deg, 94.93168989 deg], certified against the source-exact threshold 0.0100 m."
    ),
    "source_exact_threshold_m": THRESH_SOURCE_EXACT,
    "corridor_endpoints_deg": {
        "theta_lo_raw": th_lo_deg,
        "theta_hi_raw": th_hi_deg,
        "guard_width_deg": guard_deg,
        "theta_lo_shrunk": th_lo_shrunk_deg,
        "theta_hi_shrunk": th_hi_shrunk_deg,
        "shrunk_width_deg": th_hi_shrunk_deg - th_lo_shrunk_deg,
    },
    "uid24_left_boundary": {"steps": {}},
    "uid22_right_boundary": {"steps": {}},
}

all_shrunk_certified = True

for k in range(28, 35):
    ax1 = ("A", 1) if k == 31 else ("B", 7)
    ax2 = ("B", 6)
    at_raw = exact_min_max2_iv(24, k, th_lo_deg, ax1, ax2)
    at_shrunk = exact_min_max2_iv(24, k, th_lo_shrunk_deg, ax1, ax2)
    deriv_guard = certify_dsep_bounds_iv(24, k, th_lo_deg, th_lo_shrunk_deg)
    deriv_interior = certify_dsep_bounds_iv(24, k, th_lo_shrunk_deg, th_hi_shrunk_deg)

    # MVT lower bound at theta_lo_shrunk from theta_lo_raw using guard-strip derivative lower bound
    ax1_key = f"{ax1[0]}{ax1[1]}_dtheta_deg_iv"
    ax2_key = f"{ax2[0]}{ax2[1]}_dtheta_deg_iv"
    d_lb_deg = min(deriv_guard[ax1_key][0], deriv_guard[ax2_key][0])
    mvt_shrunk_lb = at_raw["min_val_iv"][0] + d_lb_deg * (th_lo_shrunk_deg - th_lo_deg)

    d_int_lb_deg = min(deriv_interior[ax1_key][0], deriv_interior[ax2_key][0])
    step_ok = bool(at_shrunk["certified_gt_0p0100"] and mvt_shrunk_lb > THRESH_SOURCE_EXACT and d_int_lb_deg > 0.0)
    all_shrunk_certified = all_shrunk_certified and step_ok

    results["uid24_left_boundary"]["steps"][str(k)] = {
        "axes": [f"{ax1[0]}{ax1[1]}", f"{ax2[0]}{ax2[1]}"],
        "at_theta_lo_raw": at_raw,
        "at_theta_lo_shrunk": at_shrunk,
        "guard_strip_derivatives": deriv_guard,
        "guard_strip_min_dsep_dtheta_deg_lb": d_lb_deg,
        "mvt_lower_bound_at_theta_lo_shrunk_m": mvt_shrunk_lb,
        "shrunk_interior_derivatives": deriv_interior,
        "shrunk_interior_min_dsep_dtheta_deg_lb": d_int_lb_deg,
        "certified_gt_0p0100_on_shrunk_interior": step_ok,
    }

for k in range(26, 34):
    ax1 = ("A", 4) if k == 29 else ("B", 2)
    ax2 = ("B", 3)
    at_raw = exact_min_max2_iv(22, k, th_hi_deg, ax1, ax2)
    at_shrunk = exact_min_max2_iv(22, k, th_hi_shrunk_deg, ax1, ax2)
    deriv_guard = certify_dsep_bounds_iv(22, k, th_hi_shrunk_deg, th_hi_deg)
    deriv_interior = certify_dsep_bounds_iv(22, k, th_lo_shrunk_deg, th_hi_shrunk_deg)

    ax1_key = f"{ax1[0]}{ax1[1]}_dtheta_deg_iv"
    ax2_key = f"{ax2[0]}{ax2[1]}_dtheta_deg_iv"
    d_ub_deg = max(deriv_guard[ax1_key][1], deriv_guard[ax2_key][1])  # negative
    mvt_shrunk_lb = at_raw["min_val_iv"][0] + (-d_ub_deg) * (th_hi_deg - th_hi_shrunk_deg)

    d_int_ub_deg = max(deriv_interior[ax1_key][1], deriv_interior[ax2_key][1])  # negative
    step_ok = bool(at_shrunk["certified_gt_0p0100"] and mvt_shrunk_lb > THRESH_SOURCE_EXACT and d_int_ub_deg < 0.0)
    all_shrunk_certified = all_shrunk_certified and step_ok

    results["uid22_right_boundary"]["steps"][str(k)] = {
        "axes": [f"{ax1[0]}{ax1[1]}", f"{ax2[0]}{ax2[1]}"],
        "at_theta_hi_raw": at_raw,
        "at_theta_hi_shrunk": at_shrunk,
        "guard_strip_derivatives": deriv_guard,
        "guard_strip_max_dsep_dtheta_deg_ub": d_ub_deg,
        "mvt_lower_bound_at_theta_hi_shrunk_m": mvt_shrunk_lb,
        "shrunk_interior_derivatives": deriv_interior,
        "shrunk_interior_max_dsep_dtheta_deg_ub": d_int_ub_deg,
        "certified_gt_0p0100_on_shrunk_interior": step_ok,
    }

results["all_shrunk_interior_steps_certified_gt_0p0100"] = all_shrunk_certified

out_path = os.path.join(os.environ.get("BALLZ_PROOF_OUT", "."), "corridor_guard_derivative_certification.json")
with open(out_path, "w") as f:
    json.dump(results, f, indent=2)

print(f"Wrote {out_path}")
print("all_shrunk_interior_steps_certified_gt_0p0100:", all_shrunk_certified)
print("k=31 (uid 24):", json.dumps(results["uid24_left_boundary"]["steps"]["31"], indent=2))
print("k=29 (uid 22):", json.dumps(results["uid22_right_boundary"]["steps"]["29"], indent=2))
