# The story so far

A short build log, in the order things happened (November 2026). It is deliberately honest: the dead ends are part of the point.

**1. A stop button that would not stop.** The first problem was not clever at all: stopping the data-labelling service took longer than the system was willing to wait, so the system killed it. The cause was that one stop signal went to *every* process in the service at once, including the helpers the main program depended on, so the main program waited forever for workers that no longer existed. The fix was a setting that tells the system to signal only the main program, plus cooperative shutdown code. Lesson: when "off" is hard, look at who else heard the signal.

**2. A dashboard, then more dashboard.** Training takes hours, so we built a page to watch it. It started as a handful of charts, and then each request added something: time windows, trend lines, correlations, "how much does this explain", confidence bands. Five versions, all in the [version history](VERSION_HISTORY.md).

**3. The model could not see.** The geometric inputs the model was supposed to use were switched off, and, worse, the ones we could switch on were computed in the wrong coordinate frame (raw action numbers instead of the simulator's own). A wrong frame turned out to be *worse than random*; the right one beat random by a clear margin. Fixing that was worth more than any amount of extra training.

**4. The model memorised.** With the inputs fixed, the neural network got *perfect* on the boards it trained on and learned nothing about new ones: *Groundhog Day*, 896 boards on loop. A much simpler model did as well. We stopped the trainer, then ran the experiments that mattered: a learned shortlist plus guided search beats an evenly spaced search when you can only afford a few simulations ([results](RESULTS.md)).

**5. Can we trust the simulator?** We re-ran thousands of stored simulations and got identical answers (so it is deterministic), and compared it with the real game: nearly perfect with one ball, shakier with three. The honest conclusion is that the simulator is good, not perfect, and real play is the final judge.

**6. The laptop that kept switching off.** The machine stopped abruptly several times, once for most of a day. We chased heat, sleep settings and a battery whose gauge claimed to hold about 4% of its rated capacity. We did not find the cause. We did make the machine safer: a cap on how hard the trainer may work, a guard that stops it gracefully when the chip is too hot, and more frequent saves. Think of it as the Allomancer who learns that pewter is not free.

**7. A live game.** One real game ran in a browser while a human watched: 72 turns alive in the cleaner run, 80 in a full-screen run that lost. The full-screen run also taught us that a click landing a fraction of a pixel off changes the shot, so the simulator's predictions stopped matching. Always check the controls before trusting the result.

**8. The dashboard that watched the wrong run.** After all that, the dashboard was cheerfully reporting that training had stopped a day earlier, because it was looking at the *previous* run's folder. The training was fine; the monitor was wrong. It now follows whichever run is active, which is the kind of bug that only shows up when you finally need the thing to be right.

The notes behind each step are in [What we learned](LEARNINGS.md).
