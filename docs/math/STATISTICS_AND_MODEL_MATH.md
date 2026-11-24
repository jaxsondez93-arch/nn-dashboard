# Statistics and model math

Definitions, formulas and short proofs used by the dashboard and the experiments, each with the numbers that were actually computed. "Checked" means recomputed directly, not just recalled.

## 1. Regret
For a board b with aim values y_{b,1..781} (the damage of each aim), a method that simulates a set S_b of at most K aims has
**regret_b = max_j y_{b,j} − max_{j in S_b} y_{b,j} ≥ 0**,
and the reported figure is the mean over boards. Zero means the best aim was found. If m aims tie for the maximum, a random K-subset contains at least one of them with probability **1 − C(781−m, K) / C(781, K)**; this is how the "random" column of the top-k table was computed (exactly, not by sampling).

## 2. The search budgets
- *Guided search* with parameters (n1, rho, r) and budget B: choose n1 aims by descending score subject to a minimum spacing rho (non-maximum suppression), always include the out-of-order aim 780, simulate them, take the two best by simulated damage, simulate aims within r index steps of each until B is reached, and fill any leftover budget by score rank. For the frozen 30-simulation setting (12, 16, 5): 12 + 1 = 13 simulations in phase one, up to 17 in refinement.
- *Coarse-to-fine*: a stride-s grid over aims 0..779 costs ceil(780/s) + 1 simulations before refinement.
- Aim indices 0..779 are ordered by launch angle, so index distance is angle distance there; index 780 is out of order and is never anyone's neighbour.

## 3. Comparing methods across games
Boards in one game follow each other (each is the previous board plus a shot and a new row), so they are strongly correlated and the unit of replication is the **game**, not the board.
- **Sign test.** With w wins in n games, the two-sided p-value is 2 · sum_{k ≥ max(w, n−w)} C(n, k) / 2^n. Checked: 14 of 16 gives 274/65,536 = **0.0042**; 12 of 16 gives 5,034/65,536 = **0.0768**; 8 of 16 gives 1.
- **Paired game-cluster bootstrap.** Resample games with replacement; for each resample compute (sum of per-game difference totals) / (sum of per-game board counts); take the 2.5th and 97.5th percentiles. This keeps the dependence inside a game intact.
- **Paired t-interval over game means**, with 15 degrees of freedom: mean ± 2.131 · s / sqrt(16).
- **Efficiency.** Ridge-guided regret at 30 simulations (1.925) is about coarse-to-fine regret at 50 (1.878): a factor of 50/30 ≈ 1.7. At 50 simulations ridge reaches 1.413; linear interpolation between the coarse-to-fine points (50, 1.878) and (100, 1.137) gives the budget for 1.413 as 50 + (1.878 − 1.413)/(1.878 − 1.137) · 50 ≈ **81**, a factor of about 1.6. We therefore quote "about 1.5 to 1.6 times fewer simulations", and it vanishes by 100. Interpolation between two points is crude.

## 4. A small proof: why board-level features did nothing
Targets were standardized **per board**: for each board, the hp values are shifted and scaled so that sum_j y_{b,j} = 0.

**Claim.** If a feature column z is constant within each board (z_{b,j} = z_b), its pooled covariance with the standardized target is exactly zero, and it cannot change any within-board ranking directly.

**Proof.** The inner product of the column with the target is sum_b sum_j z_b y_{b,j} = sum_b z_b (sum_j y_{b,j}) = sum_b z_b · 0 = 0. In a linear model the prediction for aim j on board b contains the term w_z z_b, which is the same for every aim of that board, so it cannot change which aim ranks first. ∎

**Caveat (stated honestly).** The weight w_z can still move the *other* weights through the cross terms of the normal equations, sum_b z_b · (board-sum of an aim feature), so the claim is "no direct effect", not "identical models". Measured: dropping the 11 board-level scalars changed cross-validated regret by **0.0000** [−0.10, +0.09].
Features that *vary* within a board, such as an aim feature multiplied by a board-level quantity, are not covered by the argument, and that is exactly where the interaction model gained (regret −0.225, interval [−0.49, +0.03]; rank correlation +0.468 against +0.384).

## 5. The dashboard's statistics
- **Least-squares trend** for y_i on x_i, slope b = S_xy / S_xx. When residuals are autocorrelated with lag-1 coefficient ρ, the usual interval is too narrow; an AR(1) approximation inflates the variance of a slope or mean by about (1 + ρ)/(1 − ρ), equivalently an effective sample size n_eff ≈ n (1 − ρ)/(1 + ρ). The page applies a correction of this kind; the exact implementation is in `index.html`.
- **Correlation interval.** Pearson r over n paired points; Bartlett's effective sample size n_eff = n / (1 + 2 sum_k ρ_x(k) ρ_y(k)); Fisher transform z = atanh r with standard error 1/sqrt(n_eff − 3); the interval is tanh(z ± 1.96 se).
- **R-squared** = 1 − SS_res/SS_tot. Adjusted R² = 1 − (1 − R²)(n − 1)/(n − p − 1). **Out-of-sample R²** fits on contiguous blocks of time and predicts held-out blocks, and it can be negative. **VIF_j** = 1/(1 − R_j²), where R_j² regresses metric j on the others.
- **Bands for simple regression.** With residual standard deviation s and t the Student quantile: the confidence band half-width is t · s · sqrt(1/n + (x − x̄)²/S_xx); the prediction band is t · s · sqrt(1 + 1/n + (x − x̄)²/S_xx). The "calibration" figure is the share of plotted points inside the prediction band.

## 6. Ridge scorer
w = (ZᵀZ + λ I)⁻¹ Zᵀ y with Z the column-standardized features plus an unpenalised intercept; targets standardized per board; standardization statistics come from the training fold only. Selection among λ in {10, 100, 1000} was done inside the 5-fold leave-games-out cross-validation.

## 7. Facts about the game, measured
- Every block rises by exactly **126 px per turn**: 5,528 of 5,528 consecutive pairs in the training games and 270 of 270 in validation.
- The loss line lies between y = 88 and y = 150 px (46 lost games bound it below, 1,057 alive boards above); any value in that range reproduces every recorded outcome on the 3 validation losses and 52 validation alive boards, so the data cannot narrow it further, and three validation losses are a weak check.
- Margin to loss is slack = (lowest block y after the rise − y_loss) / 126, in rows; a shot whose slack is at most 0 loses.
- A shot that clears the whole board leaves no blocks, so slack is undefined (stored as NaN). For modelling it is **defined** as (1200 − 119)/126 = **8.58 rows**, the margin if the next board holds only the entering row at y ≈ 1200 and the loss line is at 119. This is a modelling choice, flagged in the data, and it exceeds the largest finite slack seen (7.66), so cleared shots rank best.
- Entering rows have 1 to 3 blocks of hp = floor(turn / 3) + 1.
- The recorded "board after" equals the next recorded board in 1,291 of 1,291 transitions.

## 8. Simulator fidelity
Exact agreement of simulated and recorded damage, with 95% Wilson intervals: **1 ball 130 of 137 (94.9%), [89.8%, 97.5%]; 2 balls 28 of 35 (80.0%), [64.1%, 90.0%]; 3 balls 5 of 8 (62.5%), [30.6%, 86.3%].** The 3-ball figure rests on eight shots, so it is a hint, not a measurement. Disagreements go in both directions (multi-ball simulated damage too high on 14% of shots and too low on 9%), which looks like sensitive dynamics and not a fixable bias. Re-simulating 7,804 labelled aims reproduced every stored value (0 mismatches), so the simulator is deterministic.
