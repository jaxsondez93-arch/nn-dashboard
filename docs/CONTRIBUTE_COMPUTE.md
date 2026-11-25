# Lending your processor: how it works, honestly

On the **[Lend your processor](https://jaxsondez93-arch.github.io/nn-dashboard/contribute/)** page a visitor ticks one box and their device computes **training data** for the aim model while the page is open. Results are sent to the project owner automatically.

## What the device computes
The project has 896 recorded training boards. On each, only about 98 of the 781 possible aims have been simulated; about **612,000** have not. A task is one board and up to 40 of those aims. The device runs the game's own physics (the same browser simulator the bot uses) and records, for each shot, the **damage** done and the **margin to losing** (in rows). Only training boards are published; the validation and test games used to judge the model are never included.

## What the visitor agrees to
The box says it plainly: the device is used to compute training data for the neural network aim model; it uses battery and warms up while the page is open; results are sent automatically; the visitor is not shown results and cannot edit them in the page; it resumes on later visits until unticked.
- It runs only while the page is open and visible, uses about a third of one processor core, pauses when the battery is below 30% and not charging (where the browser reports it), and stops after 30 minutes per visit. Unticking stops it.
- Sent: a task number and two numbers per shot. No name, account, device details or location. The relay (ntfy.sh) sees the visitor's internet address.
- **Honest limit:** nothing running in someone's browser can be hidden from that person. A technical visitor can inspect or alter what their own device sends. That is why results are **checked by recomputation**, not trusted.
- If no collector is configured, the box is disabled and no device is used.

## How results arrive
The site has no server, so results travel through **[ntfy.sh](https://ntfy.sh)**, a free public message relay that needs no account. The page posts small batches to one channel (named in `web/contribute/collector.json`); a collector on the owner's computer picks them up:
```
python3 tools/collect.py web/contribute/collector.json results.jsonl      # polls and appends new results
```
- The relay keeps messages for only about 12 hours, so the collector should be running (or be run) within that time.
- The channel name is visible in the site's files, so it is **not a secret**: anyone could read the numbers or post junk. Nothing private is in them, and every result is checked by recomputation.
- The relay sees visitors' internet addresses. It limits how many messages one address may send per day; the page batches results to stay well within that.
- To switch collection off, set the address to an empty string and publish again. A Google Apps Script receiver (`collector/google-apps-script.gs`) is an alternative if the owner prefers it: deploy it as a web app and put its address in the same file.

## Using the results
```
# download the sheet as CSV, then:
NN_ENGINE_DIR=<engine folder> node tools/check_results.js results.csv --out verified.jsonl
python3 tools/import_labels.py verified.jsonl board_map.json ~/extra_labels
```
The checker recomputes a random sample of every task (or all shots with `--sample 0`). One-ball boards must match exactly. Boards with several balls or pickups may differ on a small share, because different browsers' maths functions differ in the last digit and chaotic shots amplify it. The importer writes **new** label files into a separate folder and never overwrites existing ones; `board_map.json` (public board number to private board id) stays private.

## How useful is it, really?
- It is real training data, unlike the earlier toy experiment on this page.
- The experiments suggest **new boards matter more than more aims on the same boards**: the simple scorer's learning curve was flat, and the neural network memorised its 896 boards. This work adds more aims (and the margin-to-losing signal, which the older labels lack) but not new boards. Generating new boards by self-play would be the more valuable next task.
- Estimated size: at roughly 25 ms per shot on a laptop at full speed, the 612,000 shots are about 4 hours of one core; phones at a third speed need correspondingly longer, shared among visitors.
