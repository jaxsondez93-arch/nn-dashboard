# Lending your processor: how it works, honestly

On the **[Lend your processor](https://jaxsondez93-arch.github.io/nn-dashboard/contribute/)** page a visitor ticks one box and their device computes **training data** for the aim model while the page is open. Results are sent to the project owner automatically.

## What the device computes
The project has 896 recorded training boards. On each, only about 98 of the 781 possible aims have been simulated; about **612,000** have not. A task is one board and up to 40 of those aims. The device runs the game's own physics (the same browser simulator the bot uses) and records, for each shot, the **damage** done and the **margin to losing** (in rows). Only training boards are published; the validation and test games used to judge the model are never included.

## How results are sent
Finished tasks wait on the device and go out in one message at a time. Each message is compressed (gzip, then base64; format version 4), which on real results fits about six times as many shots as plain text. Messages are at least 20 seconds apart, a partly filled one waits 45 seconds, and if the relay says "slow down" the page waits 5 minutes. The whole backlog is saved on the device; at 600 waiting tasks the work pauses until it is back down to 300. Unticking stops the work, and finished results are still sent while the page is open (or the next time it is opened). Keep only one tab of the page open: tabs share the saved backlog.

The relay's free allowance limits messages per day for each network address, so devices on the same network share it.

## How hard it works
A slider from **1% to 100%** sets the share of all the processor cores the browser reports (100% = every core fully busy; 25% to begin with). The page turns that into a number of parallel workers and how busy each is. The graphics chip is not used, and some browsers (notably on iPhones) report fewer cores than the chip has.

Four **safety switches** are on every time the page opens. Turning one off needs a confirmation:
- **Heat protection**: never above 50%, and ease off if shots start taking clearly longer. A web page cannot read the device's temperature, so slowing down is the only sign it can act on; it is not a guarantee.
- **Stability protection**: always leave a core free, and use at most 4 workers on phones and 8 elsewhere, since each worker needs memory.
- **Battery protection**: pause below 30% when not charging (where the browser reports battery level; iPhones do not).
- **Time limit**: stop after 30 minutes per visit.

With switches off a device can get very hot, drain quickly, freeze or close the page. The page says so while any switch is off.

## What the volunteer sees: "Your device"
A live panel in the dashboard's style: speed now and time per shot, shots done (this visit, all time on this device, and as a share of all the work), what has been sent, time left in the visit, a speed chart with a trend line and 95% band and a plain-language verdict ("steady", "slowing down", which is often the device warming up), time-per-shot and progress charts, and a battery chart where the browser reports battery level. All of it is measured on the device and stays there; it shows performance, never the result values.

## What the visitor agrees to
The box says it plainly: the device is used to compute training data for the neural network aim model; it uses battery and warms up while the page is open; results are sent automatically; the visitor is not shown results and cannot edit them in the page; it resumes on later visits until unticked.
- It runs only while the page is open and visible. Unticking stops it.
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
The checker recomputes a random sample of every task (or all shots with `--sample 0`). Browsers occasionally disagree about a shot (one differed in about 1,200 in a test, on a one-ball board; the first real phone matched all of its 607), more often on boards with several balls, because maths functions differ between engines in the last digit and chaotic shots amplify it. A task may therefore differ on one shot (one-ball boards) or a small share (others), and every recomputed value replaces the one received. The importer writes **new** label files into a separate folder and never overwrites existing ones; `board_map.json` (public board number to private board id) stays private.

## How useful is it, really?
- It is real training data, unlike the earlier toy experiment on this page.
- The experiments suggest **new boards matter more than more aims on the same boards**: the simple scorer's learning curve was flat, and the neural network memorised its 896 boards. This work adds more aims (and the margin-to-losing signal, which the older labels lack) but not new boards. Generating new boards by self-play would be the more valuable next task.
- Estimated size: at roughly 25 ms per shot on a laptop at full speed, the 612,000 shots are about 4 hours of one core; phones at a third speed need correspondingly longer, shared among visitors.
