> **Note for readers.** This is a verbatim copy of the claim ledger from the working notes of the proof project (dated November 2026). It refers to scripts, certificate files and folders that live in the author's working directory and are **not part of this repository** (see the [overview](README.md#what-is-and-is-not-here)). Nothing has been edited except this note and one link, which now points to the copy of the audit that is in this repository.

# Claim ledger, 4 Nov 2026

Certifier audit: see [`certifier_audit_20261104.md`](CERTIFIER_AUDIT.md). Main caveat: the post-impact velocity step (F2) uses a finite-difference Jacobian with an empirical remainder bound, so claim 4 is not yet a fully rigorous proof.

Evidence types: **certified** (outward-rounded interval / exact arithmetic over a continuous set), **sampled** (finite grid or bisection), **source-derived** (read from c2runtime.js / data.js, conditional on stated premises), **observed** (live game run).
"Re-checked today" means I re-ran or re-read it in this session. Anything else is as recorded on disk, not independently confirmed today.

| # | Claim | Object | Quantifier / domain | Evidence | Re-checked today | Open items |
|---|---|---|---|---|---|---|
| 1 | D <= 6 (every HP=1 block fires Event 36 at most once) | game runtime (source model) | all trajectories from Seed-3000 HP=1 board | source-derived, conditional on S1-S6 + Events 39-47 audit | no | Re-read Events 39-47 audit verbatim (an earlier pasted excerpt was not verbatim). Argument does not use refresh rate; not tested exhaustively at >= 100 Hz. |
| 2 | max D = 6 attained (pixel 354,296) | live game | 60 Hz; up to 299/3 = 99.67 Hz by the k1=23 rule | observed + source-derived rule | no (only part of `threshold_95_99_live.json` read) | Attainment at >= 100 Hz not established. |
| 3 | Corridor D=0 on (85.2967, 94.9427) deg | simulator model | certified on guard-shrunk [85.30767, 94.93169]; 0.011 deg end strips sampled only | interval-certified (early-out + derivative bounds) | **100-ULP rerun reproduced saved JSON exactly**; min sep 0.0100075045 m (margin 7.5e-6 m) | Certifier soundness not yet audited. Reproducibility != soundness. Guard 0.0105 run does not fully certify (see `earlyout_freeflight_certification_corridor.json`). |
| 4 | D=6 on 3 sub-intervals of [64.196495, 64.203161] (0.000538 deg, ~8.1%) | simulator model | three listed intervals only | interval-certified (Taylor-model certifier, 124 tiles) | no | Partial audit done 4 Nov (`certifier_audit_20261104.md`): tile coverage verified; 124/124 tiles survive 3 patched reruns; open: F2 heuristic remainder, F1/F3 documented; `iv_TimeOfImpact`, simplex solvers, manifold clipping and `certify_interval_arithmetic.py` not yet reviewed line by line. Last-hit step is {k,k+1} in 85 transition-path tiles. Unresolved branch ambiguity near step 306 at [64.199968, 64.199978]. |
| 5 | Rest of plateau is D=6 | simulator model | 1e-7 deg grid on [64.168, 64.211] | sampled (430,001 pts: 207,955 D=6, 222,046 D=5, no other values; 18 transitions) | JSON re-read; counts consistent | Not a continuum statement; sub-grid slivers not excluded. No D=4 seen, so no 6->4 negative controls exist here. |
| 6 | Certifier refuses non-D=6 boxes | certifier | 72 boxes at the 18 observed edges | tested controls (72/72 refused, 0 false positives) | JSON re-read | Tests those boxes only. Does not show it can positively certify D=5. |
| 7 | Rational endpoint check, 7 points all D=6 | simulator model | 7 angles | high-precision cross-check (denominators capped at 2^-170; **not exact**) | JSON re-read | Not a proof over any interval. |
| 8 | fast_py_sim2 == reference simulator | simulators | tested angles only | sampled: 5000/5000 (original seed), 5000/5000 (new seed), 144/144 near edges | **rerun 4 Nov, 0 mismatches** | The 430k scan used the reference sim, not fast_py_sim2, so scan validity does not depend on this. |
| 9 | Refresh-rate rule: result == 60 Hz result if N0.3 <= k1 and delta k(1->2) >= N_wait | game runtime | sufficient condition; shown for Theta_25 up to 95.33 Hz (k1=22) | source-derived + interval-certified k1 >= 22 + sampled scans + live checks | no | Other regions can change at lower rates (secondary impacts inside N_wait ticks). Claim "k1 == 23 over whole plateau" (certified in manuscript) not re-checked. |
| 10 | Full landscape W_d, M_k, E[D] | single-angle model, 60 Hz | (0,180) deg | sampled / bracketed | no | Bracket widths up to 0.19 deg (2c), 1.33 deg (1b). Not certified. |
| 11 | Multi-HP: D >= 11 (HP=2), D >= 15 (HP=3) | simulator | explicit witnesses | Level B lower bounds | no | |
| 12 | HP=4 reversal L_A vs L_B | simulator + live | 0.001 deg grid + 3 live pixels | numerical + observed | no | Compare with `prop3_and_la4_iv_certification_v2.json` (not yet done). |
| 13 | Whole-game survival optimality | game | all states | OPEN | n/a | Bellman result conditional and circular on its key hypothesis. |

## Checklist for the certifier audit (`certify_d6_multibounce_iv.py`)
1. How interval cos/sin are produced: `math.cos`/`math.sin` at endpoints widened by 2 ULP (`certify_interval_arithmetic.py` lines 85-99). libm is not guaranteed correctly rounded, so soundness rests on libm error < 2 ULP on this machine. The 100-ULP rerun covers the corridor only, not the multi-bounce certifier.
2. Padding constants ROT_PAD = 1e-12, POS_PAD = 1e-9 m: justify or bound.
3. Tile coverage: confirm the 124 tiles are contiguous and each accepted tile's conclusion is checked.
4. Branch handling: every `<=` / `>` comparison that is ambiguous must raise, never default.
5. Transition-path tiles (final block): confirm "during step k or start of step k+1" logic.
6. Grep for anything that can accept a box without a certificate (fallbacks, broad excepts, early returns).
7. Add negative controls at other D=6 -> 5 edges in [64.168, 64.211] (the 18 edges are already covered by 72 boxes; 6 -> 4 edges do not occur in this window).
