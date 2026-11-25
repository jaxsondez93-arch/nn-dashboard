# Lending your processor: how it works, honestly

On the **[Lend your processor](https://jaxsondez93-arch.github.io/nn-dashboard/contribute/)** page a visitor ticks one box and their device computes **training data** for the aim model while the page is open. Results are sent to the project owner automatically.

## What the device computes
The project has 896 recorded training boards. On each, only about 98 of the 781 possible aims have been simulated; about **612,000** have not. A task is one board and up to 40 of those aims. The device runs the game's own physics (the same browser simulator the bot uses) and records, for each shot, the **damage** done and the **margin to losing** (in rows). Only training boards are published; the validation and test games used to judge the model are never included.

## What the visitor agrees to
The box says it plainly: the device is used to compute training data for the neural network aim model; it uses battery and warms up while the page is open; results are sent automatically; the visitor is not shown results and cannot edit them in the page; it resumes on later visits until unticked.
- It runs only while the page is open and visible, uses about a third of one processor core, pauses when the battery is below 30% and not charging (where the browser reports it), and stops after 30 minutes per visit. Unticking stops it.
- Sent: a task number and two numbers per shot. No name, account, device details or location. The receiver is a Google script, so Google sees the visitor's internet address.
- **Honest limit:** nothing running in someone's browser can be hidden from that person. A technical visitor can inspect or alter what their own device sends. That is why results are **checked by recomputation**, not trusted.
- If no collector is configured, the box is disabled and no device is used.

## Switching collection on (once, about five minutes)
The site has no server, so results need somewhere to arrive. A free Google script does it:
1. Create a new Google Sheet (go to `sheets.new`).
2. In the sheet: **Extensions → Apps Script**. Replace the code with the contents of [`collector/google-apps-script.gs`](https://github.com/jaxsondez93-arch/nn-dashboard) and save.
3. **Deploy → New deployment → Web app**. *Execute as*: Me. *Who has access*: Anyone. Deploy and approve the permission request.
4. Copy the web app address (it starts with `https://script.google.com/macros/s/` and ends in `/exec`) into `web/contribute/collector.json` as `{ "endpoint": "..." }`, then rebuild and publish the site.

To switch it off, empty the address and publish again, or delete the deployment in Apps Script. Anyone who learns the address can post to it, which is another reason everything is checked.

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
