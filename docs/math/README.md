# The mathematics

Two bodies of mathematical work sit behind this project, and they have very different standing. Please read the status columns.

**New:** [what can be proved about the bot, and where the proofs stop](BOT_GUARANTEES.md).

| | what it is | status |
|---|---|---|
| **A. The game proof project** | Exact collision geometry, multi-bounce dynamics and damage analysis for the puzzle game, with interval-arithmetic certificates and a long manuscript | Partly **certified pending independent review**, partly sampled, one central question **open**. See the [claim ledger](CLAIM_LEDGER.md) and the [audit](CERTIFIER_AUDIT.md). |
| **B. The statistics and model math** | The definitions, formulas and small proofs behind the dashboard and the experiments | Written out and **checked by direct computation** in [STATISTICS_AND_MODEL_MATH.md](STATISTICS_AND_MODEL_MATH.md). Everything quoted there is recomputable from the results files. |

## A. The game proof project, in plain terms
The game throws a ball at blocks that each need a number of hits ("hp"). The question the manuscript asks is: **for a given board, which launch angles produce which damage, and can we prove it exactly?** The model has a discrete free-flight step (Theorem 1), a contact and time-of-impact solver with grazing-boundary bounds (Theorem 2), exact angular intervals of equal damage on one fixed board (Propositions 3 and 4), a specification of the game engine's post-contact behaviour, and a damage landscape with multi-hp scaling.

Manuscript outline (the manuscript itself, about 290 KB, is not included here):
1. Introduction, problem statement and explicit model assumptions
2. Discrete free-flight model (Theorem 1)
3. Contact geometry, the time-of-impact solver and grazing-boundary sandwich bounds (Theorem 2)
4. Angular hit intervals and occlusion on one fixed board (Propositions 3 and 4)
5. The post-contact solver and the game engine's event specifications
6. The damage landscape, aiming robustness and multi-hp scaling
7. Proof and verification ledger
8. Open directions

### How strong is each claim? (summary of the ledger)
The ledger uses four kinds of evidence, strongest first: **certified** (outward-rounded interval or exact arithmetic over a continuous set), **sampled** (a finite grid or bisection), **source-derived** (read from the game's own code, conditional on stated premises) and **observed** (a live game run).

| claim | evidence | headline caveat |
|---|---|---|
| Every hp=1 block fires its hit event at most once, so damage D is at most 6 | source-derived, conditional | the audit of the relevant events must be re-read verbatim |
| The maximum D = 6 is attained at one aim | observed + source-derived rule | not established at refresh rates of 100 Hz or more |
| A corridor of angles gives D = 0 | interval-certified on a slightly shrunk interval; end strips only sampled | a 100-ULP rerun reproduced the saved certificate exactly; that shows reproducibility, not soundness |
| D = 6 on three sub-intervals totalling 0.000538 degrees | interval-certified (124 tiles) | **not fully rigorous as written**: one step uses a heuristic remainder bound |
| The rest of a plateau has D = 6 | sampled on 430,001 points | a grid, so thin slivers are not excluded |
| The certifier refuses boxes that are not D = 6 | 72 of 72 refused | shows it can refuse; does not show it can certify D = 5 |
| Whole-game survival optimality | **OPEN** | the Bellman argument is conditional and circular on its key hypothesis |

### The most important honest statement
From the audit: *"no certificate was invalidated, but the certifier is not a fully rigorous proof as written."* The weak step (finding F2) linearises the post-impact velocity map with a finite-difference Jacobian and a remainder bound whose coefficients are not derived. Patched reruns (padding the angle constructor, removing an unsound pruning test, and widening the trigonometric error budget to 100 ULP) all reproduced every one of the 124 tiles, which is strong empirical support but not a proof. An erratum corrected one stated margin (0.0047 m, not 0.63 m) without changing the verdict.

## What is and is not here
**Included:** the [claim ledger](CLAIM_LEDGER.md), the [certifier audit and erratum](CERTIFIER_AUDIT.md), this overview, the [statistics and model math](STATISTICS_AND_MODEL_MATH.md), and [five proof scripts](proof_code/README.md) (about 1,500 lines: the interval-arithmetic foundation and the corridor and free-flight certificates), published as reference copies for reading.

**Not included yet, on purpose:** the manuscript, the multi-bounce certifier (2,353 lines) and the two Proposition 3/4 certifiers (603 and 564 lines), the JSON certificates, the PDFs and the experiment folders (about 190 MB in total). The working directory contains personal paths in hundreds of files, and a script should be read through and scrubbed before it is published, not copied. The five included scripts were read in full and only their file paths were changed. The rest can be added file by file once reviewed.

## Why it matters for the aiming model
The learned scorer in this repository never uses these proofs; it is trained on simulator outputs. The proof work matters for **trust in the simulator**: the exact geometry and the interval certificates are what justify treating simulator labels as ground truth, and the simulator's measured agreement with the real game (see [RESULTS](../RESULTS.md)) is the empirical side of the same question.
