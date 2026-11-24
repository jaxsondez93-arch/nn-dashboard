# What we learned

Notes from building the dashboard and running the training project it monitors. The project trains a small model to pick where to aim in a physics-based ball-launching puzzle game; "regret" is how much damage the chosen aim loses against the best of all 781 candidate aims. This is a working log of lessons, with the evidence and the caveats. Nothing here is a proof, and several early beliefs turned out wrong; those are listed too.

## Dashboard and statistics
- **A dashboard can be confidently wrong about the wrong run.** The page read one data directory and one systemd unit name that were fixed in the code. After a new run started in another directory, it reported "no heartbeat" and "trainer inactive" while the new trainer was healthy. Fix: the server now follows whichever run's trainer is active (`NN_RUNS`), and the data directory and unit are configurable.
- **Neighbouring training points are not independent.** Plain regression intervals were far too tight. The page widens intervals with the lag-1 autocorrelation, reduces the effective sample size for correlations (Bartlett), and reports how many plotted points really fall inside the prediction band, so a band that is too narrow shows up as a low number.
- **Raw correlations between drifting metrics mislead.** Two metrics that both drift over time correlate even when unrelated, so the page offers detrended and "changes" modes. Over the older run, CPU load plus temperature explained 82% to 94% of the variation in training speed depending on the window, and almost all of that came from load (unique R-squared 67% to 76%); temperature added almost nothing once load was in the model. The trainer's own CPU use is part of "load", so this is association, not cause.
- **Validation sets this small are noisy.** The validation numbers come from 4 games; the page says so and a single evaluation moves by roughly 0.12.

## Operating a long run on one laptop
- **Group shutdown can wedge a worker pool.** A termination signal sent to a whole process group killed pool workers and their parent's helper, so tasks were lost and the parent waited forever. Fixes that worked: `KillMode=mixed` (signal only the main process, then clean up), a cooperative cancel flag, bounded submission, a kill fallback and a hard-exit backstop.
- **Make long jobs resumable and every write atomic.** Per-item output files plus a manifest that is fsynced; an unfinished item is discarded, never written partially. A stop then costs minutes. Checkpoints should include optimizer state so a resume is exact.
- **Transient `systemd-run` units do not come back after a reboot; enabled units do.**
- **Heat is a hardware risk worth engineering around.** One training thread at full turbo pushed a core to 98 C, about 2 C below its limit, while the fan was already at full speed. The processor cooled from 98 C to 72 C within 10 seconds of the load stopping, so the load was the cause. Capping the trainer at 40% of one core brought the peak to 92 C (mean 78 C). A small watchdog stops the trainer gracefully (so it saves a checkpoint) when the core stays hot, and restarts it only if it stopped it, after it has cooled. Priority order used: hardware, then the checkpoint, then training progress.
- **Battery percentages from a bad gauge are noise.** One laptop reported a full capacity of about 4% of its design capacity; reasoning built on those percentages was unreliable. Log voltage, current and AC state instead.
- **A user-level journal cannot show system suspend messages.** Several abrupt stops were never explained; a root journal read is needed. Earlier explanations (heat, suspend on battery) were not established, and the stop cause remains open.

## Evaluation discipline
- **Split by game, not by board.** Boards from one game are strongly correlated. A test split was sealed from the start and never loaded; a held-out "dev" set of 16 games was kept for evaluation only.
- **Freeze settings before scoring.** Search settings were chosen on the validation games and written to a file before any dev board was scored; a dev set that has been used to select a model is then marked as spent.
- **Use game-cluster bootstrap and per-game wins.** Intervals resample whole games; the number of games where one method beats another, with a sign test, is a robust companion.
- **State the rule in advance and say when you did not.** Later analyses had their decision rules written to files before they ran; one earlier rule was only stated in conversation, and the report says so.

## Findings about the model (simulator-measured)
- **Ridge-guided search beats coarse-to-fine at small budgets.** On 16 held-out games the ridge scorer plus guided search had lower regret than a non-learned coarse-to-fine search at 30 simulations (better on 14 of 16 games, sign test p = 0.004) and, less certainly, at 50 (12 of 16, p = 0.077); at 100 simulations there was no difference. That is roughly 1.5x fewer simulations for the same regret, not 3x. See [RESULTS](RESULTS.md).
- **An untrained geometric heuristic as the shortlist scorer gave no gain** over coarse-to-fine; the gain appears when the learned scorer ranks the aims.
- **The neural network memorised.** Trained on 896 boards from 60 games, its training regret was exactly zero from about step 21,000 while validation stayed flat; a linear model did about as well. The effective sample is the number of distinct boards, not the 100,000 labelled rows.
- **More games did not help the linear scorer.** Fitting on 15, 30, 45 or 60 games gave about the same held-out regret; the features, not the amount of data, were the limit.
- **A wrong coordinate frame is worse than none.** Geometric features computed with raw action pixels were worse than random (-0.68); in the simulator's own frame they beat random by +0.51 (95% interval +0.33 to +0.68). A sweep of the launch origin on the fit boards chose the same origin (+0.479 against +0.495 for the best alternative, inside the rule that keeps the chosen value).
- **Features that are constant within a board cannot change a within-board ranking** when targets are standardized per board: their covariance with the target is exactly zero. Dropping the 11 board-level scalars changed nothing (difference 0.0000). Crossing aim features with them looked promising (regret at 10 lower by 0.225, interval -0.49 to +0.03; within-board rank correlation +0.468 against +0.384) but missed the adoption rule.
- **The shortlist has headroom.** The exact best aim was inside the ridge scorer's top 50 on only 25% of boards (ray heuristic 38%, random 16%), so refinement around good aims does much of the work.
- **The simulator is faithful for one ball and loses fidelity with several.** It matched the real game exactly 94.9% of the time with one ball, 80.0% with two and 62.5% with three; errors went both ways, which looks like chaotic dynamics rather than a fixable bias. Re-simulating 7,804 labelled aims reproduced every stored value, so the engine is deterministic.
- **Survival signals are sparse and have an awkward corner.** Only 9 of 80 dev boards had any aim that loses the game. A shot that clears the whole board leaves no blocks, so its "margin to loss" is undefined; a loader that drops those rows would remove the best shots, so a derived file flags them and defines their margin explicitly.
- **Live play needs its own checks.** One live game (windowed, 14-minute cap) survived 72 turns. A full-screen run lost after 80 turns, and its simulated damage matched the real damage on only 4 of 80 turns because fractional click coordinates shifted the aims: verify input mapping before trusting a live run.

## Corrections we made along the way
- Checkpoints do include optimizer state, and a resume is exact; an early claim that they did not was wrong.
- A claim that overheating was the leading cause of the stops was weakened by later evidence and is not established.
- A first reading of one results table credited the guided-search structure for part of the gain; the table showed it did not (ray-guided minus coarse-to-fine: +0.105, -0.003, +0.088), so the learned scorer is the apparent source.
- A first "pass" on a determinism check covered zero boards and was discarded; a probe's control was accidentally a constant stream and was rerun.

## Caveats
Everything above is regret measured on a simulator over a small number of games, on one machine. Real-game play is the final test and has barely been run. The authentication code in this repository is home-made and unaudited.
