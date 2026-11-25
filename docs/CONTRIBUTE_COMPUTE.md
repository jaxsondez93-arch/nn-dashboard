# Lending your processor: how it works, honestly

The site has a page, **[Lend your processor](https://jaxsondez93-arch.github.io/nn-dashboard/contribute/)**, where a visitor can let their browser do a small amount of arithmetic and, only if they choose, share the answer. This note explains what it does, why it is safe, how results are checked, and, just as important, what it is *not*.

## What the computation is
A synthetic version of the aim-search problem from the rest of the project. A "board" is a made-up bumpy landscape of damage over 781 aims. Four strategies each get *K* tests and try to find the best aim: random, evenly spaced, spaced-then-zoom-in, and a "hunch" strategy where a noisy guess of quality *q* decides what to test. The question the crowd answers: **how much does a decent hunch help, as a function of the test budget and the hunch quality?**

The grid is 8 budgets (10 to 120 tests) by 6 hunch qualities (0 to 1). Each of the 48 cells is split into 500 *work units* of 100 boards, 24,000 units in all. A unit takes a typical laptop about 0.13 seconds; the whole grid is about 50 minutes of single-core work.

## Why it is safe
- **Sandboxed and opt-in.** It runs in a browser background thread (a Web Worker) only while the page is open. It needs no install, account or permission. The visitor must tick a consent box; it stops on Stop, when the tab is hidden, at a session limit (1, 5, 15 or 30 minutes, default 5, or 'until I press Stop'), and when the battery is below 30% and not charging (where the browser reports battery).
- **Gentle by default.** The worker rests between small chunks so the processor is busy about a quarter of the time (Gentle), half (Medium) or all of it (Hard, which warms a phone).
- **The page cannot send data anywhere.** Its Content-Security-Policy allows connections only to this site. The one way anything leaves a device is the visitor pressing *Submit all*, which opens a public GitHub issue (prefilled, or with the results copied for pasting when there are many) that *they* then submit; they can also download the results as a file. We do not read the user agent, location or any identifier.
- **A result is tiny and anonymous:** a unit number, four whole numbers and a checksum.
- **No trust required.** Every unit is deterministic and uses only addition, subtraction, multiplication, division and comparisons (no exponentials, logarithms, trigonometry or square roots, whose last digits can differ between devices). Anyone can recompute any unit and must get exactly the same four numbers. Wrong or invented results are rejected by recomputation.

## One press for many results
Finished units collect on the device; one press bundles all unsent ones (up to 2,500 per issue) into a single submission. A visitor can also choose to have the page start by itself on later visits. Submitting without any press at all would need a small server to receive results, which this static site does not have.

## Checking and collecting results
```
node tools/verify_unit.js result.json          # exit 0 only if the recomputation matches exactly
gh api "repos/jaxsondez93-arch/nn-dashboard/issues?state=all&per_page=100" --paginate > issues.json
node tools/aggregate_results.js issues.json --out web/contribute/phase_diagram.json
```
The aggregator only looks at issues titled "Work unit result ...", re-computes every result before counting it, counts each unit once, reports extra volunteers who confirmed the same unit, and rejects anything malformed or wrong. Rebuild the site (`python3 tools/build_pages.py site`) to publish the updated heat map.

The determinism claim is checked in the tests (the same unit twice, tampered results rejected, the aggregator's counts) and was checked across two JavaScript engines: Node (V8) and Chromium produced identical totals. Safari and Firefox use different engines; if a phone's shared result verifies in Node, that is a real cross-engine confirmation.

## What it is not (please read)
- **It is not a serious research workload.** The whole experiment is under an hour of single-core work. A laptop could do all of it unaided; volunteers add redundancy and a demonstration, not necessary speed. It is a working, safe *framework* for volunteer computing, more than a computation anyone needs.
- **It does not run the real game.** The real project's expensive work is simulating the real game's physics, at roughly 0.1 seconds per simulated shot. Doing that in a browser would need the physics engine compiled to run there, and the engine contains code that belongs to the game's makers, so it cannot be published here. That is a decision for the owner (permission, or a clean-room re-implementation), not a technical detail.
- **Public.** A shared result is a public GitHub issue. Opening it shows GitHub your IP address, as visiting any website does.
- **Spam.** Anyone can post an issue; verification means spam cannot change the numbers, but moderation is still manual.
- **Phones get warm.** Gentle mode is the default for a reason; use Pause if the phone feels warm, and prefer charging.
