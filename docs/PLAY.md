# Watch the bot play the real game

There are two separate pages, both running the game in your browser on your device; nothing is sent anywhere.

- **[Watch the bot play](https://jaxsondez93-arch.github.io/nn-dashboard/play/)**: the bot plays, you watch. Your taps, clicks and keys do not reach the game, so you cannot interfere; you can only pause or resume the bot, and a change of strategy takes effect at the next game.
- **[Play it yourself](https://jaxsondez93-arch.github.io/nn-dashboard/yourself/)**: just you and the game, at full sharpness. The page only counts your turns; it sends the game no input.

## What the bot does
It repeats one loop: wait until the board is still, read the blocks, choose an aim, press at that spot, wait for the balls to finish, record what happened. When a game ends it presses Play and starts another.

### The best bot (default)
This is the project's best method, ported to run in your browser:
1. a **learned scorer** (a small linear model trained on 896 recorded boards) ranks all 781 aims;
2. the **game's own physics** simulates the most promising, spread-out ones, then zooms in around the two best, 30 simulations in all;
3. it then picks one of the tested shots, in this order of importance: **survive**, **break blocks that are about to become last-chance** (added 25 November 2026; testing up to 30 more shots aimed at them), **get the extra ball**, then **most damage**. In a check on 10 early recorded boards the new rule left such a block 0 times against 5 for the earlier order, with the same number of losing shots and about 31% less damage on those boards; its effect on whole games is not yet measured. When no block is within three rows of the line it tries 16 shots instead of 30: on 60 recorded boards that kept 94% of the damage, with no more losing shots. Each simulated shot became 1.3 to 1.5 times faster on 25 November, with results identical on every ball position and frame of 586 test shots. The bot can also spread the simulations over several processor cores with identical choices (1.3 to 1.8 times faster on the project laptop, measured before the per-shot speed-up). A further check that re-tries a shot with the aim nudged by under half a pixel, when a block must break at once, is written but switched off until it has been shown to help. When a board has an extra ball and none of the first shots collects it, up to 20 more are tested, aimed towards it. If **every** tested shot would lose, it keeps testing the other aims, those pointing at the threatening blocks first, until one survives, so it plays a losing shot only when all 781 lose in the simulator. What is and is not proved about this: [bot guarantees](math/BOT_GUARANTEES.md).

On 240 recorded training boards with an extra ball, the bot with the new priorities collected it and survived on 89%, against 55% for the earlier damage-only bot, with the same four losing shots, about 6.5% less damage per shot and about 13% more simulations on those boards. (The 20 extra tests account for 89% versus 85%.) Those runs did not include the emergency search, and whether the trade pays off over a full game is untested.

It thinks on your device, in the background, usually under a second or a few seconds on a phone. The log shows the **predicted and actual damage** for every shot.

### How faithful the port is
- The feature code matches the Python original to within 0.00000005.
- On 900 recorded simulation results the browser simulator matched **all 450 one-ball shots exactly** and 442 of 450 shots with several balls or pickups (99.1% overall). The likely reason for the rest is that browsers and Python differ in the last digit of some maths functions, which chaotic multi-ball shots can amplify.
- It chose the same aim as the Python bot on 8 of 10 test boards; one difference was the guard (correctly avoiding a losing shot), the other a long-bouncing shot that came out differently.
- Playing live in an emulated iPhone it predicted the real damage exactly on 15 of 15 early-game shots. Later in a game, with more balls, expect lower accuracy.
- On high-density screens the game renders at a rounded size and aims land slightly off (predictions fell to about 3 of 12 exact), so the bot page runs the game at pixel density 1.

### What the evidence for "best" is
In earlier live games this method survived 72 turns (still alive at a time limit) and 80 turns, while the other bots recorded peaks of 36 to 47 and the geometry bot averaged about 15. That is only two games, so it is a strong hint, not a proven ranking. It aims to do the most damage each turn and is not a long-term planner.

### The simple strategies
**Top block**, **Tightest pair**, **Near a wall**, **Random aim** and **Mix** use only what a player can see and no simulator; they are there for comparison.

## What the page shows while it plays
- **Speed.** You choose a speed (up to "fastest this device can"); the page shows separately the speed in use. Shots run faster by computing more of the same fixed game frames per screen refresh; aiming and menus stay at normal speed. In a 14-turn check the predicted damage was exact on every shot at both normal and fastest speed; whole games cannot be compared turn by turn, because new blocks appear in random places.
- **Scoreboard.** Live turn, score and balls, a danger meter with one tab for every row (1 to 10 shots from the line; it never just says "safe", because some block is always some number of shots away), rings on every block (red must break this shot, orange next, yellow the one after, then fainter cyan rings for each row further out), records, and a button that loads the record game into the charts.
- **Thinking display.** The scorer's view of all aims, every shot the physics tries (red = loses, gold = extra ball), and the choice. It only draws.
- **Prediction accuracy, exploring tools and machine readings**, with the formulas. A page can only measure some things about your device; temperature and processor load appear only with a helper running on the same computer.
- **The log** is kept on your device across refreshes, can be downloaded, opened again for analysis, or erased.

## Build your own puzzle
The **Build a puzzle** panel makes the real game build a board you describe, then lets the bot play on from it. **One number is enough.**

- **Leave a box empty and it is filled in** the way a real game has it at that point: blocks, balls, health and score all grow together (rules and measurements in [GAME_RULES.md](GAME_RULES.md)). A start score of 38 alone gives a game about 21 turns in: 3 balls, health 8, and a typical board of about 8 blocks.
- **What you type is never changed.** If you fill in more than one box, the empty ones follow the **average** of what your numbers point to (a score that points to turn 21 and a health that points to turn 37 give turn 29 for everything left empty), and your own numbers stay exactly as typed.
- The boxes are **start score** (any whole number, no upper limit), **balls** (how many are fired each turn), **block health** (the health of the newest blocks) and **turn**. Numbers typed in the boxes always win over the scene box, and the boxes empty once their numbers are in the scene. 1000 balls on its own gives about turn 7,100: a score near 13,000 and health near 2,400. Nothing is capped: a score of a billion fills in the balls and health a real game that far in would have, however large. **Fill in the rest** shows the whole scene as text, with a line saying what was kept and what was filled in and why; **Another layout** keeps the numbers and changes only where the blocks are. The same numbers always give the same layout.
- Or write the scene yourself (a partial one is fine; the empty parts are filled in; anything you write counts as entered, so a `"score": 0` stays 0):

```json
{ "balls": 12, "score": 0, "blocks": [[150, 420, 30], [480, 420, 30], [320, 640, 60]] }
```

- A block is `[x, y, health]`. `x` runs from 60 (left) to 660 (right). `y` runs from 150 (near the top, the danger end: a block this high must be broken at once) to 1270 (the bottom, where new rows appear). Blocks must be at least 100 apart (the game's own rows of two can be that close); up to 40 blocks. Health and balls have no upper limit: any whole number, 1 or more (the score likewise, 0 or more). If you give blocks and no number at all, the strongest block's health stands in for one; once you have typed any number, that number decides and the blocks do not.
- **The game's own limit.** The game's numbers are 64-bit floating-point numbers (JavaScript's). Every whole number is exact up to 9,007,199,254,740,991 (2^53 - 1); from 2^53 only even numbers exist, from 2^54 only multiples of 4, and so on, up to about 1.8 x 10^308, beyond which a number is infinity and is refused as not a whole number. The page does not stop you anywhere below that. If what you typed cannot be held exactly it says what was really built ("9007199254740993 becomes 9007199254740992"). A built board with that many balls or that much health will not finish a shot in any time you would wait (a ball is fired every 0.3 seconds), and the bot cannot think about it: build it, do not start the bot, and watch what the game does with the numbers.
- Every problem with a scene is listed at once, in words. **Pickups** are written `"pickups": [[x, y], ...]` (up to 8, same field as blocks, at least 100 from anything). A pickup adds one ball when a ball touches it. While one is on the board the game's pickup timer is already past 7, so no second one appears; with none on the board you can set `"pickupTimer"` (0 to 7: a pickup row appears when it reaches 7). `"counter"` (0, 1 or 2) is how many turns since the health of new blocks last went up.
- **Build it** places the board and leaves the bot paused so you can look; **Build it and start the bot** also starts it. The bot must be paused first, and the log's turn numbers start again from 1. The game then carries on by its own rules from the numbers you gave: the next row's health follows the turn.

How a built board is made to play like a real one, because it took three things (each found by experiment, then explained by the game's own rules and confirmed by the shot's predicted damage equalling its real damage):

1. **The ball count is three variables** that always move together (`ballStart`, `ballEnd`, `TotalBall`); the launch loop uses the first two, so setting only `TotalBall` launches a single ball however many the page believes in.
2. **Every block has a companion label** (its health text), pinned to it and paired by an id stored in the block. The game takes health off a block, and scores its destruction, only through that label.
3. **New objects only exist from the next game tick**, so the page reads the board back and compares it with the scene (blocks within a pixel, same health, same labels, ball count and score) before the bot is allowed to look.

How faithful the result is, checked against the simulator the bot predicts with: on ten random scenes of light blocks (health 1 to 5, one to four balls) the real shot did **exactly** the predicted damage in **10 of 10**. On ten scenes of tough blocks (health 15 to 60) it did in 2 of 10, which matches how the simulator does on ordinary games with tough blocks (long chains of bounces off blocks that need many hits are where it drifts), so a built board behaves like a real one. A record-game board with 292 balls and health up to 689 did 1201 damage against 1140 predicted. After a built scene's first turn the game spawns the next row with the health its rules give (7 of 7 turns tested, at every point of the 3-turn cycle). The game itself is deterministic: the same board and aim gave the same damage on every repeat.

## What it is not
- **Real time only.** The game runs at its normal speed; speeding it up would change its physics.
- **Tested in emulation.** It plays correctly in desktop and iPhone-style emulated browsers. A real phone's browser, which uses a different engine on iPhone, is the real test.

## The game files and the notice
The game ("FALLING BALLZ", a Construct 2 HTML5 export) is not part of this repository's source and is not covered by its MIT licence. It is added to the published site only when the site is built (`NN_GAME_DIR=<folder> python3 tools/build_pages.py site`), at the request of the site owner, who has stated that redistribution is permitted. No licence for the game is claimed here, and its folder carries a `NOTICE.txt`. Deleting the `play/game` folder removes the game from the site. If you are a rights holder and want it removed, open an issue on the repository.

Changes made to the game files for hosting: the portal script tag (`../../next/next-adapter.js`) was removed from the page, a short script makes the game render at pixel density 1 when (and only when) the bot page loads it, and a blank 1x1 `loading-logo.png` was added because the game's loader requests that file and it was not among the files (without it the loader crashes).
