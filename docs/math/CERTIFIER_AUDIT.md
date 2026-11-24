> **Note for readers.** This is a verbatim copy of the audit of the interval certifier, followed by its erratum from the working notes of the proof project (dated November 2026). It refers to scripts, certificate files and folders that live in the author's working directory and are **not part of this repository** (see the [overview](README.md#what-is-and-is-not-here)). Nothing has been edited except this note.

# Audit of `certify_d6_multibounce_iv.py` (read-only), 4 Nov 2026

Scope: the 1D Taylor-model certifier behind the "D=6 on 3 sub-intervals (0.000538 deg)" claim, plus `certify_interval_arithmetic.py` at the level of structure only.
Nothing in the original files was modified. All patched runs below used in-memory copies of the source.
Bottom line: **no certificate was invalidated, but the certifier is not a fully rigorous proof as written.** One step (F2) rests on a heuristic remainder bound, and two smaller formal gaps (F1, F3) exist. Keep the label "certified, pending independent review".

## What I checked directly
| Check | Result |
|---|---|
| Tile coverage (from the saved JSON) | 124 tiles in 3 contiguous runs; run endpoints equal the claimed regions exactly (64.19953-64.199634, 64.199656-64.199968, 64.199978-64.2001); 0 gaps or overlaps; widths sum to 0.000538 deg; all tiles carry the same block order [25,22,24,26,3,5]; 85 tiles use the final-block transition path (matches the manuscript). |
| Comparison operators (`<,<=,>,>=`) | Accept only when the enclosures are strictly separated, otherwise raise `BranchAmbiguityError` (read lines 279-313). |
| Arithmetic algebra (add, sub, mul, square, reciprocal, sqrt, sin, cos) | Read against the Taylor-model derivations; consistent. Caveat: `inv` and `sqrt` assume the center c0 lies inside [lo, hi] and do not assert it. |
| Random-expression fuzz vs 110-digit decimals (38,486 trees x 7 points) | 35 enclosure violations (worst 1.5e-12 absolute; typical ~1e-16) and 6,315 Taylor-form violations, **all removed by one fix** (F1). With the fix: 0 and 0. |
| Pruning constants | Wall x-thresholds 0.50 and 13.90 are sound (walls' inner faces at x=0 and x=14.40; ball reach 0.4853+0.0100=0.4953; margin 0.0047 m). Block L_inf prune 1.70 m vs real reach about 1.07 m: sound. |
| Differential test vs reference simulator | 2,480 angles (20 per tile): first five hit steps equal the saved steps exactly; the sixth equals k, or k+1 on transition-path tiles; 0 violations (45 samples at k+1). |
| Patched reruns of all 124 tiles | (a) leaf fix; (b) leaf fix + remove the wall y-prune; (c) leaf fix + sin/cos error budget 2 -> 100 ULP. **Each: 124/124 certify, identical block order and hit steps to the saved certificate.** Outputs: `d6_tiles_rerun_patched_var_20261104.json`, `d6_tiles_rerun_nowally_20261104.json`, `d6_tiles_rerun_trig100_20261104.json`. |

## Findings, most important first
**F2. Heuristic remainder in the post-impact velocity map (lines 1733-1768). Not proven.**
For the face-B contact case the velocity map is linearized with a finite-difference Jacobian in plain floats (`eps_fd = 1e-8`, central differences) and the second-order remainder is `q_m = up((2.0*(da+dsw)**2)*u_mag + 3.0*(da+dsw)*du_mag + 16.0*err_1(u_mag), 16)`. The coefficients 2, 3 and 16 are not derived anywhere in the code; the finite-difference truncation and rounding error (rounding alone can reach about 1e-8 relative in the derivative) are not bounded. Empirical support only: the 2,480-angle differential test above, the earlier 24,800-sample check, and the 100-ULP/leaf/wall reruns (which do not change this term). **This is the main reason the result cannot be called a rigorous proof.** Fix: propagate `IV` arithmetic through `eval_M` directly, or bound the second and third derivatives analytically.

**F1. `IV.var` (the input-angle constructor) can sit up to half an ULP off its endpoints.** `r_lo` and `r_hi` can both come out 0.0, so the Taylor form `c0 + c1*s` need not contain the true endpoint. Formal gap of about 1e-16 on the angle (rad). Fuzz shows it as the sole cause of all observed violations. Fix: pad `r_lo`, `r_hi` by about 2 ULP. All 124 tiles still certify with this fix (rerun above).

**F3. Wall-pruning argument in the final-block fallback (lines 2141-2144) is unsound as written.** It tests the wall *center* (y=12.8) +-1.70 although each wall spans y in [0, 25.6]. Block 5 is at x=1.48, 1.48 m from the left wall, so the x-prune does not always fire. The conclusion is probably true (the gap between the left wall and block 5's left face is 0.905 m, smaller than the ball diameter), but the code does not prove it. Removing the unsound test makes no tile fail (variant b), so the 85 transition-path tiles do not depend on it.

**F4. Smaller points.**
- `float(....c0)` conversions in the contact solver (lines 1442-1449, 1523-1535, 1618-1622) are valid only if those quantities are degenerate constants (static block normal, ball local vertex). Likely true; not asserted.
- `IV` defines no `__eq__` or `__bool__`: `iv == x` compares identity and `if iv:` is always true. The grep found no obvious misuse; I did not trace every site.
- Acceptance relies on `assert` (stripped under `python -O`); the tile driver retries on any `Exception` but only accepts after the asserts pass.
- Several `pad_ulps(2..16)` calls are heuristic insurance for evaluation-order differences with the engine; they only widen, so they are safe but undocumented.
- `iv_CollidePolygons` line 1204 clips a padded interval to `down(totalRadius.lo, 2)`; negligible, but it can drop up to 2 ULP of padding.

**F5. Scope of what is certified.**
- The model is the **single-angle** model (`a_force = inst_angle = th_rad`). The three certified intervals are 0.000104, 0.000312 and 0.000122 deg wide, narrower than the single- vs two-angle parallax (about 0.0011 deg at 393 px). They therefore do not, on their own, certify any live-game pixel.
- Trig error budget: `IV.cos/sin` allow 2 ULP for libm error. The 100-ULP rerun (c) shows the tile results do not depend on that choice.
- Tile endpoints are decimal literals converted to floats; the certified set is the float interval, differing from the stated decimal interval by about 1e-14 deg.

## Suggested manuscript wording
"Three sub-intervals totalling 0.000538 deg are certified in the single-angle model by an outward-rounded 1D Taylor-model certifier (124 contiguous tiles). The certifier's post-impact velocity step uses a heuristic second-order remainder bound and is pending independent review; patched reruns (leaf padding, wall-prune removal, 100-ULP trig) reproduce all 124 tiles."


---

# Erratum to `certifier_audit_20261104.md` (written 2026-11-05)

The original audit file is unchanged (SHA-256 `f9d33550ee2c864b9c47…`, first 20 hex digits). This file corrects one statement in it.

## Corrected statement
Row "Pruning constants" of the audit said: "Block L_inf prune 1.70 m vs real reach about 1.07 m: sound."
- **The 1.07 m figure is wrong.** I used the wrong block half-extent (0.575) when computing the reach.
- **Correct reach:** the block is an octagon with half-extent 1.2 m; the ball octagon has circumradius about 0.4853 m; each shape carries a 0.005 m skin. Largest centre-to-centre L_inf separation at which a contact can exist: 1.2 + 0.4853 + 2 × 0.005 = **1.6953 m**.
- **Consequence for the certifier:** the 1.70 m prune is still sound, but the margin is **0.0047 m**, not 0.63 m. The audit's verdict "sound" stands; its stated margin does not.
- Basis: geometry from the simulator's polygon proxies (`block_extents.py` in the 2026-11-05 investigation folder). Not independently re-derived by a second method.

## Related finding from the round-2 investigation (not an error in the audit)
The float simulators (not the interval certifier) use a start-of-step block prune of **1.5 m**, which is below the 1.6953 m reach. See `investigation_round2_report_20261105.md`. The audit did not examine that constant because it covered the certifier only. Findings F1–F5 of the audit, including F2 (finite-difference Jacobian with a heuristic remainder bound), are not affected by and not resolved by anything in this erratum.
