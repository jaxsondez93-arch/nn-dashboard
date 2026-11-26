# What can be proved about the bot, and where the proofs stop

This is about the choosing rule in `web/play/best/search.js`. The statements marked **proved** follow from how that code works. They are hand proofs, checked by tests on made-up cases, not machine-verified proofs. **The bot is not proved optimal, and it is not optimal by design** (see "Limits").

## Setting
- A **board** is the blocks (position and number), any extra-ball pickup and the number of balls.
- **A** is the fixed set of 781 aims.
- **S** is the simulator. For a board and an aim `a` it returns, deterministically: `L(a)` (1 if a surviving block reaches the loss line, else 0), `g(a)` (pickups collected) and `d(a)` (damage).
- `u(a)` and `v(a)` are the health left, after the shot, on blocks that would be last-chance next turn, and two rows further out.
- The **rank** of an aim is `(1 − L, −u, g, −v, d)`, compared first entry first: survive, then leave nothing about to become last-chance, then the ball, then less health two rows out, then damage.
- **T** is the set of aims the bot tests on this turn. It plays `c`, a highest-ranked aim in T.

The bot builds T in three stages:
1. **First pass:** 30 aims chosen by the scorer and a short search (16 when no block is within three rows of the line), including the last aim.
2. **Emergency search**, only if every first-pass aim loses: the remaining aims, those pointing at the threatening blocks first, until one survives (then up to 6 neighbours).
3. **Look-ahead search**, only if no surviving shot so far has `u = 0` and some block needs it: up to 30 more aimed at those blocks, plus neighbours.
4. **Extra-ball search**, only if the board has a pickup: if no aim so far collects it while surviving, up to `m` more aimed towards it; around a collecting aim, neighbours. At most `m` aims in all (`m = 20`).

## Theorem 1: nothing tested beats the shot played (proved)
No aim in T has a higher rank than `c`.

*Proof.* `c` is chosen as a maximum of the rank over T. ∎

## Theorem 2: survival is complete over the 781 aims (proved)
If some aim in A survives in S, then the shot played survives in S.

*Proof.* If the first pass contains a surviving aim, it is in T, and survival is the first entry of the rank, so by Theorem 1 `c` survives. Otherwise the emergency search runs. Its queue contains every aim of A that the first pass did not test (the aims pointing at threats, then all of the scorer's ordering, then the last aim, with repeats removed), and it stops only at a surviving aim or at the end of the queue. A surviving aim exists in the queue, so one is found and put in T. Theorem 1 applies. ∎

**Corollary (what a losing shot means).** If the bot plays a shot that loses in S, then all 781 aims lose in S.

## Theorem 3: testing more never makes the choice worse (proved)
For the same board, raising the extra budget `m` never lowers the rank of the shot played.

*Proof.* Stages 1 to 3 do not depend on `m`. Stage 4 walks a fixed sequence of aims and `m` only sets where it stops, so a larger `m` tests every aim a smaller one does, possibly more. A maximum over a larger set is not smaller. ∎

**Corollary (against the damage-only bot).** That bot played an aim from the same first pass, so the present bot's shot never ranks below it in this order. It **can** do less damage, when it trades damage for survival, for low blocks or for the ball.

**Several processors (proved by construction, checked by test).** The search asks for batches of shots and only counts them in a fixed order, so the number of processors cannot change the choice.

The order of the stages matters. With the extra-ball search first, a test on made-up cases found a case where a larger budget gave up a ball, so the emergency search comes first.

## What these proofs assume
| assumption | status |
|---|---|
| S behaves like the real game | **false with many balls.** It matched 892 of 900 reference results (boards with up to 4 balls), but in a long live game (see below) it was exactly right on far fewer shots once the bot had 5 or more balls. Where S is wrong, Theorem 2 can fail in the real game |
| S's loss rule (a surviving block whose centre is at height 245 or less after the shot) is the game's rule | taken from the project's simulator, **not independently proved** |
| 781 aims are enough | the real game allows aims in between. "All 781 lose" does not mean no shot at all could survive |
| the code does what the proof says | checked by tests, including more-tests-never-worse and the emergency search |

## The simulator's accuracy falls as balls increase (measured, cause unknown)
One live game on 25 November 2026, snapshot of its first 197 predicted turns, played with shots running faster than normal speed:

| balls | predictions exactly right |
|---|---|
| up to 4 | 93% of 29 turns |
| 5 or more | 13% of 168 turns |

On average the game did **9.2 points less** damage than predicted (± 2.2). A "each ball is its own chance" fit gives q = 0.865 per ball (the chance of an exact prediction halving about every 5 balls); it fitted slightly better than a logistic curve. Turns in one game are not independent, and ball count rose along with turn number, so this describes the data and does not prove that balls alone are the cause. Two causes have **not** been ruled out: the browser simulator being wrong for many balls, and the faster speed. **Until this is settled, the proofs above say little about the real game beyond about 4 balls.**

## How the record game ended (25 November 2026)
The damage-first bot reached turn 1413 with 199 balls. A block with **7 health** received no hits on turns 1411 and 1412 while the bot did over 500 damage elsewhere. On turn 1413 the simulator predicted exactly 7 hits, none to spare, and the real game fell short. Replaying turns 1411 and 1412 with the look-ahead order destroys that block. This shows the rule would have acted on that block, not how much longer a whole game would last.

## The health balance: what surviving requires
**Observed rule (record game, all 1,412 new rows):** every new block had health `turn // 3 + 1`. Rows held 1, 2 or 3 blocks (43%, 29%, 28%; mean 1.855) and a new ball appeared every 7 or 8 turns. This is read from one game's data, not proved from the game's code.

**Theorem 5 (proved).** If a block must be destroyed within `L` turns of appearing, then surviving turn `T` requires the total damage done by turn `T` to be at least the total health of all blocks that appeared by turn `T − L`.

*Proof.* Each of those blocks has been on the board for at least `L` turns, so it has been destroyed, which takes damage equal to its health. Damage is not shared between blocks. ∎

**What it means (an estimate, using the observed rule).** New health per turn grows like `1.855 × turn / 3` and balls like `turn / 7.1`. Their ratio settles near **4.4**: to survive indefinitely the bot must average about 4.4 hits per ball per turn. In the record game it did: 4.2 to 4.6 over each block of 200 turns, with new health and damage equal almost turn for turn up to turn 1400. So the board was not slowly filling up, and the loss came from one block the simulator misjudged. How many hits per ball are *possible* has not been established, so no upper limit on survival is proved.

## Limits: why this is not optimal
1. **One turn only.** The rank looks at the current shot. Taking the ball instead of more damage may leave a board that cannot be survived next turn. Rules of the form "survive now, then ball, then damage" allow games in which that choice loses while the passed-over shot would have lived on, so no argument from these rules alone can show best long-run play. How often such positions arise here is open.
2. **The order itself is a judgement.** "Ball before damage" has not been shown to lengthen games.
3. **New rows are random**, and their odds have not been modelled. No statement of the form "the bot will certainly reach turn N" has been proved, and the proofs above cannot give one.

## How "it reaches turn N" can be established: with a probability
Certainty is out of reach, but a **lower bound on the chance** is not.

**Theorem 4 (proved, standard).** Freeze the bot, choose N in advance, and play `n` independent games. If all `n` reach turn N, then with 95% confidence the chance of reaching turn N is at least `0.05^(1/n)`.

*Proof.* If the true chance `p` were below `0.05^(1/n)`, seeing `n` successes out of `n` would have probability `p^n < 0.05`. ∎

| games, all reaching turn N | chance is at least (95% confidence) |
|---|---|
| 10 | 74% |
| 29 | 90% |
| 59 | 95% |
| 299 | 99% |

With some failures, the exact binomial (Clopper–Pearson) bound is used instead. Any change to the bot restarts the count.

## Next steps
1. Record full games with the frozen bot, with N and the number of games written down first.
2. Find why predictions fail with many balls: repeat the same many-ball shots at normal speed and at high speed, then compare the launch timing with the simulator's.
3. Check the loss rule against recorded game endings in the training games.
4. Estimate how new rows appear, then study two-turn positions (see [research to borrow from](../RESEARCH.md), ideas 1 and 7).
