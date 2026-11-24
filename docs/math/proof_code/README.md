# Proof code (reference copies)

Five of the scripts behind the [claim ledger](../CLAIM_LEDGER.md). They are published **for reading**: each one imports helper modules that are not part of this repository (the polygon proxies, the seed-3000 block table), so none of them runs on its own. The only edits from the originals are the file paths (now `BALLZ_PROOF_MODULES` and `BALLZ_PROOF_OUT`, both defaulting to the current folder) and a header comment; the logic is untouched.

## How they fit together
```
certify_interval_arithmetic.py        the foundation: outward-rounded intervals + the separation functions
   ^                ^
   |                +-- certify_earlyout_freeflight.py    "no contact" certificate for the corridor (uses the foundation)
   |                          ^
   |                          +-- certify_earlyout_and_guard_100ulp.py   reruns it with 100-ULP trigonometry
   +-- certify_corridor_guard_derivatives.py   derivative bounds on the guard strips and the endpoint check
corridor_level_a_proof.py             an earlier, plain-float analysis with a threshold later shown to have no basis in the source
```

## What each file does
| file | what it does |
|---|---|
| [certify_interval_arithmetic.py](certify_interval_arithmetic.py) | Defines the interval type `IV`. Every elementary operation (+, -, *, /, sqrt) is widened outward by 1 ULP (one unit in the last place) with `math.nextafter`, since IEEE-754 binary64 operations are accurate to half a ULP; `sin` and `cos` are widened by 2 ULPs to cover the maths library. Builds the free-flight trajectory of the ball (step `dt` = 1.3/60, gravity 10, a fixed launch impulse), the separating-axis separation `iv_eval_axis` between the ball polygon and a block polygon, and then certifies a list of statements about one fixed board: the first contact step over a whole interval of angles, the damage-6 plateau, a central "miss" corridor, and two occlusion crossovers with derivative bounds and root brackets. |
| [corridor_level_a_proof.py](corridor_level_a_proof.py) | A plain-float ("Level A") analysis of the corridor with analytical derivative bounds. It uses a contact threshold of 0.00875 m (0.0075 plus a tolerance taken from a later C++ version of the physics library). The free-flight certificate below explains that this threshold has no basis in this game's runtime. Kept for the record. |
| [certify_earlyout_freeflight.py](certify_earlyout_freeflight.py) | The source-exact "no contact" certificate. Its docstring gives the argument: a polygon contact only counts if the collision routine produces a point, and that routine returns early with no points when the separation along every possible starting edge exceeds the total radius (0.0100 m); for a fixed edge the separation is concave in the within-step fraction alpha, so its minimum over an interval of alpha is at an endpoint. It certifies every step, every alpha in [0, 1], every target polygon and every sub-interval of angles, by adaptive bisection (`certify_range`), with a position pad of 1e-9 m and a rotation pad of 1e-12 to cover accumulated rounding. |
| [certify_corridor_guard_derivatives.py](certify_corridor_guard_derivatives.py) | Bounds the derivative of the separation with respect to the angle on the thin guard strips at both ends of the corridor, and uses the exact closed-form minimum over alpha plus a mean-value-theorem step to certify the shrunk endpoints exceed 0.0100 m. |
| [certify_earlyout_and_guard_100ulp.py](certify_earlyout_and_guard_100ulp.py) | Reruns the two certificates above with every trigonometric evaluation widened by 100 ULPs, by temporarily replacing the interval `sin`/`cos`. It shows the results do not depend on the 2-ULP assumption. As the ledger says, that shows the certificates are robust to the choice, not that the underlying interval library is sound. |

## What is certified, and what is not
These files are the corridor and free-flight parts of the ledger. The audit's main finding concerns a different, larger file that is **not** included here: the multi-bounce certifier (2,353 lines), whose post-impact velocity step uses a heuristic remainder bound. See the [audit](../CERTIFIER_AUDIT.md). The ledger's evidence labels (certified, sampled, source-derived, observed) apply to the claims, not to these scripts as such.

Two cautions for a reader. First, the interval type relies on the maths library being accurate to within 2 ULPs on the machine used; the 100-ULP rerun tests the sensitivity to that assumption but does not prove it. Second, several constants are padded by hand (the position and rotation pads); they only widen the enclosures, so they are safe, but they are documented only in comments.
