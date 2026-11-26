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
3. it then picks one of the tested shots, in this order of importance: **survive**, **break blocks that are about to become last-chance** (added 25 November 2026; testing up to 30 more shots aimed at them), **get the extra ball**, then **most damage**. In a check on 10 early recorded boards the new rule left such a block 0 times against 5 for the earlier order, with the same number of losing shots and about 31% less damage on those boards; its effect on whole games is not yet measured. When no block is within three rows of the line it tries 16 shots instead of 30: on 60 recorded boards that kept 94% of the damage, with no more losing shots. It can spread the simulations over several processor cores with identical choices (1.3 to 1.8 times faster on the project laptop). When a board has an extra ball and none of the first shots collects it, up to 20 more are tested, aimed towards it. If **every** tested shot would lose, it keeps testing the other aims, those pointing at the threatening blocks first, until one survives, so it plays a losing shot only when all 781 lose in the simulator. What is and is not proved about this: [bot guarantees](math/BOT_GUARANTEES.md).

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
- **Scoreboard.** Live turn, score and balls, a danger meter, rings on the blocks about to reach the line, records, and a button that loads the record game into the charts.
- **Thinking display.** The scorer's view of all aims, every shot the physics tries (red = loses, gold = extra ball), and the choice. It only draws.
- **Prediction accuracy, exploring tools and machine readings**, with the formulas. A page can only measure some things about your device; temperature and processor load appear only with a helper running on the same computer.
- **The log** is kept on your device across refreshes, can be downloaded, opened again for analysis, or erased.

## What it is not
- **Real time only.** The game runs at its normal speed; speeding it up would change its physics.
- **Tested in emulation.** It plays correctly in desktop and iPhone-style emulated browsers. A real phone's browser, which uses a different engine on iPhone, is the real test.

## The game files and the notice
The game ("FALLING BALLZ", a Construct 2 HTML5 export) is not part of this repository's source and is not covered by its MIT licence. It is added to the published site only when the site is built (`NN_GAME_DIR=<folder> python3 tools/build_pages.py site`), at the request of the site owner, who has stated that redistribution is permitted. No licence for the game is claimed here, and its folder carries a `NOTICE.txt`. Deleting the `play/game` folder removes the game from the site. If you are a rights holder and want it removed, open an issue on the repository.

Changes made to the game files for hosting: the portal script tag (`../../next/next-adapter.js`) was removed from the page, a short script makes the game render at pixel density 1 when (and only when) the bot page loads it, and a blank 1x1 `loading-logo.png` was added because the game's loader requests that file and it was not among the files (without it the loader crashes).
