# What the game's own rules say, and how real play compares

The game is a Construct 2 export, so its rules are stored as a tree of events (conditions and actions with parsed expressions) that the engine runs every frame. They can be read from the running game: `tools/decompile_game.py` opens the watch page in a headless browser, reaches the game screen, and prints every rule as pseudo-code (about 220 lines for the game screen). This page is what those rules say, in words, and how the averages measured from real games compare with them. The "Build a puzzle" panel is built on both.

## The rules

**A turn.** You tap; one ball is launched every 0.3 s until all are out. A ball that hits a block takes 1 off the block's health. Each ball that is destroyed counts down the number of balls still out. When none are left the turn ends: every block and pickup moves up one row (126 pixels), the ball counters are reset, and the next row is made.

**Two details that matter if you build a board yourself.** A hit only takes health off a block, and a destroyed block only adds 1 to the score, when a *label* object with the block's id exists (each block is given one when it appears; the label shows its health). And the number of balls fired is read from `ballStart` and `ballEnd`, not from `TotalBall` alone; all three move together.

**The next row.** Right after a turn ends the game decides what appears at the bottom:

| | blocks | where (x, uniform inside the range) | y |
|---|---|---|---|
| an ordinary turn picks 1, 2 or 3 blocks, equally likely | 1 | 120 to 600 | 1200 |
| | 2 | 120 to 260, and 360 to 600 | 1200 |
| | 3 | 65 to 217, 340 to 400, and 510 to 657 | 1210 |
| a pickup turn (the pickup timer reads 7) | 1 block and the extra-ball pickup | the block in 340 to 600 and the pickup in 120 to 240, or the other way round | 1200 |

The pickup timer counts up by one each turn, and goes back to 0 when the pickup is collected (or when it rises to the loss line uncollected). A pickup row appears when it reads 7, so an extra ball is possible every 7 turns at best.

**Health.** A counter goes up each turn; when it reaches 3 it resets and the health given to new blocks goes up by one. So new blocks have health `1 + floor(turn / 3)`. (Checked turn by turn on a live game: the health, the counter and the blocks' health all matched in 40 of 40 turns.) A new block is given that health, a sequence id, and the same value again as a mirror (its colour step), and gets its label.

**Score** is the number of blocks destroyed. **The opening board** is fixed: 6 blocks of health 1. **You lose** when a block reaches the line near the top.

## The rules against the data

The averages below are measured only from logs of real games (12 games, 6,288 turns, all played by the bot) with `tools/fit_progression.py`, which also writes `web/play/progression.json`. Nothing in the measurement assumes the rules.

| | the rules say | measured |
|---|---|---|
| rows of 1 / 2 / 3 blocks | 3/7, 2/7, 2/7 = 42.9%, 28.6%, 28.6% (an ordinary turn is 1/3 each, and a pickup row counts as 1) | 43.1%, 28.5%, 28.4% |
| blocks added per turn | 13/7 = 1.857 | 1.854 |
| three-block rows at y = 1210 | always | 1764 of 1781 |
| new block's health | `1 + floor(turn / 3)` | exact in 6220 of 6276 rows (one game's logged turn numbers ran one turn ahead of the game's own for the whole game; with that offset every game agrees) |
| score per turn | 13/7 in the long run (every block added is destroyed) | 1.84 on average; 1.85 to 1.87 in the longest games, a little lower in short ones because the blocks still on the board are not yet scored |
| turns per extra ball | 7 at best | 7.10: the bot is about a tenth of a turn slower than perfect at collecting pickups |
| where a new block lands | inside the ranges above | all 2697 lone blocks; 1767 of 1785 rows of two; 1765 of 1781 rows of three |

The rules and the measurements agree to within the noise. The few rows that do not (about 0.5%) have blocks logged a multiple of 6 pixels off the usual height, which matches the game's own 6-pixel hit nudge (on a hit a block moves down 6, waits 0.1 s and moves back) being caught half way when the board was logged.

## What the rules cannot say

They say what appears, not what a player does with it. Those parts are measured, and they are the only measured inputs the puzzle builder uses:

- **How fast pickups are collected**, hence turns per extra ball (7.10 for the bot). A human would typically collect fewer, so would have fewer balls at the same turn.
- **How blocks are worn away.** Of the blocks added, 76% are still there one turn later, 48% after two, 29% after three, then roughly 0.6 times as many for each further turn. The health they have left, as a share of the health they started with, falls the same way (the middle block: 79% after one turn, 46% after two, 32% after three).
- **The score offset**: the blocks still on the board (about 6 at any time) are not yet scored, so score is about `13/7 × turn − 1.8`.

## How the puzzle builder uses this

The builder turns any number you enter into "how far into a real game is this" (a turn), and fills whatever you left empty with what a real game has at that point.

| you enter | it means turn |
|---|---|
| turn | that turn |
| score | `(score + 1.83) / (13/7)` |
| balls | `6.27 + 7.10 × (balls - 1)` |
| health | `3 × (health - 1) + 1` (the middle of the 3 turns that share a health) |
| blocks and no number at all | the strongest block's health, as health (if you typed any number, that number decides and the blocks do not) |

- **What you enter is never changed.** Only empty things are filled.
- **Several numbers:** the turn used for the empty ones is the **average** of the turns your numbers point to. Enter a score that points to turn 21 and a health that points to turn 37 and the empty ones follow turn 29; both of your numbers stay exactly as typed.
- **What is filled in:** the turn, then score `13/7 × turn − 1.83`, balls `1 + (turn − 6.27) / 7.10`, health `1 + floor(turn / 3)`, and a typical board: the rows of the last few turns with places taken from the rules above, thinned and worn the way the bot's play thins and wears them. The layout is a fixed function of the numbers (same input, same puzzle), and "Another layout" changes only the layout.
- **Example.** A start score of 38 alone gives about turn 21: 3 balls, health 8, and a board of 8 blocks. (5 balls and health 13 together describe turn 35 to 37, a score near 65.)

## Limits

- All measurements are from the bot's play. The wear tables and the ball count describe how a good player's game looks; a casual player's would differ.
- **Pickups** can be placed. A pickup is a plain object with no variables; a ball touching it destroys it, adds one to the ball count (`TotalBall` and `ballEnd`), launches a free ball toward the last tap, and sets the pickup timer to 0. A pickup row sets the timer to 8 and it counts up a turn at a time while the pickup is on the board (it is set to 0 again when the pickup is collected or rises to the line uncollected); a new pickup row only appears when the timer reads exactly 7. That is also why there is never more than one pickup at a time, and why a built scene may have at most one. A built board with a pickup gets a timer of 8 or more (8 plus the turns it has risen), and one without gets the timer you give it (0 by default, so the first pickup row appears 7 turns on). Checked in the real game: a ball fired straight at a built pickup took the ball count from 3 to 4 and left the timer at 1 (0, then one turn counted).
- The numbers have no limit of their own: the game keeps them as 64-bit floats, exact for whole numbers up to 9,007,199,254,740,991 (2^53 - 1).
- The decompiler names engine objects by their numbers (`t11` and so on); the meanings used here (ball, block, label, pickup) were established by watching them in a running game.
