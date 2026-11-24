# Watch the bot play the real game

The page **[Watch the bot play](https://jaxsondez93-arch.github.io/nn-dashboard/play/)** runs the game in an embedded frame and lets a bot play it live, in your browser, on your device. Nothing is sent anywhere.

## What the bot does
It follows the same loop as the earlier laptop bot: wait until the board is still, look at the blocks, choose an aim, press at that spot, wait for the balls to finish, record what happened, repeat. When a game ends it presses Play and starts another.

It uses only what a player can see: the position and hit points of each block. Its strategies:
- **Top block**: aim at the topmost block.
- **Tightest pair**: aim at the block with the smallest gap to its nearest neighbour.
- **Near a wall**: aim at a block close to a side wall.
- **Random aim**, and **Mix**, which picks one of these at random each turn.

The aim is the candidate pixel (out of 781) whose launch angle is closest to the line from the launcher to the chosen block. The log records, for each turn, the strategy, target, balls, blocks and damage dealt; you can download it as JSON.

## What it is not (yet)
- **Not the learned model.** The project's best method (a learned scorer plus guided search with a physics simulator) needs the simulator and the feature code running in the browser. That port is not done; this page uses the simple geometry strategies. They are not claimed to be good.
- **Real time only.** The game runs at its normal speed (about 3 to 4 seconds a turn); there is no fast-forward, because speeding the game up would change its physics.
- **Tested in emulation.** It plays correctly in desktop and iPhone-style emulated browsers. A real phone's browser is the real test.

## The game files and the notice
The game ("FALLING BALLZ", a Construct 2 HTML5 export) is not part of this repository's source and is not covered by its MIT licence. It is added to the published site only when the site is built (`NN_GAME_DIR=<folder> python3 tools/build_pages.py site`), at the request of the site owner, who has stated that redistribution is permitted. No licence for the game is claimed here, and its folder carries a `NOTICE.txt`. Deleting the `play/game` folder removes the game from the site. If you are a rights holder and want it removed, open an issue on the repository.

The only change made to the game files for hosting: the portal script tag (`../../next/next-adapter.js`) was removed from the page.
