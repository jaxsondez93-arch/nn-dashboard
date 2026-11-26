# Research to borrow from: network and math

A reading list turned into a work plan: published work involving Stanford, Carnegie Mellon (CMU) and MIT on learning, and MIT and Princeton on the math of decisions, matched to what this project actually struggles with.

**How far this was checked (24 November 2026):** titles, authors, venues and affiliations come from web searches and paper summaries or abstracts. The full papers have not been read yet; read one properly before building it. "Institution" means at least one author was there. Nothing here is implemented yet, and a published result does not promise the same gain on this game.

## What the project needs
- The best bot is a simple 40-number scorer plus a short search with the real physics. A larger network **memorised** its training boards and did worse, and more training steps did not help.
- The bot looks **one turn ahead**, but the game is won by surviving many turns.
- The search tries 30 of 781 aims using hand-tuned rules.
- Practice data is cheap to make (volunteers' devices), but more of the same data has not helped.

## The candidates
**Suggested order** (a judgement, not a measured result): first the two cheap tests on stored data (**4**, then **2**); then **1**, which has the most to gain for surviving longer but needs the most building (with **7** as its judge); then **6** and **3**; **5** is the largest rebuild.

### 1. Look further than one turn (MIT)
[Rollout algorithms for combinatorial optimization](https://www.mit.edu/~jnt/Papers/J066-97-rollout.pdf), Bertsekas, Tsitsiklis and Wu, 1997. Also Bertsekas's [rollout survey](https://www.mit.edu/~dimitrib/Rollouts_Survey.pdf).
- **Result (math):** take a decent rule ("base policy"), and choose each move by trying it and then letting the rule play on. Under stated conditions this is never worse than the rule alone.
- **Here:** the current bot is the base rule. For its few best shots, play one or two more turns and prefer the shot that leaves the safest board.
- **Catch:** the guarantee needs a correct model of the next turn. New rows appear at random, so their odds would have to be estimated from recorded training games, and the guarantee becomes approximate.

### 2. Spend the simulations more cleverly (Princeton)
[The knowledge-gradient policy for correlated normal beliefs](https://collaborate.princeton.edu/en/publications/the-knowledge-gradient-policy-for-correlated-normal-beliefs/), Frazier, Powell and Dayanik, 2009.
- **Result (math):** with a limited number of tries over related options, pick the next try that most improves the expected quality of the final choice. Optimal in some special cases, with bounded loss otherwise.
- **Here:** the options are aims, neighbouring aims are related, and the scorer gives the starting belief. It would replace the hand-tuned search.
- **Catch:** it assumes bell-curve uncertainty. Our shots are repeatable but jumpy, so the guarantees do not carry over directly.
- **Cheap to test:** boards where all 781 aims are already simulated let both searches be compared without new physics runs.

### 3. Learn a correction instead of everything (MIT, Princeton)
[Residual policy learning](https://arxiv.org/abs/1812.06298), Silver, Allen, Tenenbaum and Kaelbling (MIT), 2018. [TossingBot](https://tossingbot.cs.princeton.edu/paper.pdf), Zeng, Song, Lee, Rodriguez and Funkhouser (Princeton, Google, Columbia, MIT), 2019.
- **Result (experiments):** start from a working controller or physics estimate and have the network learn only what it gets wrong. This did better, usually with less data, than learning from scratch on their tasks.
- **Here:** keep the 40-number scorer and train a small network on its errors, so it cannot easily end up worse than where it starts.

### 4. Train on what matters: the top of the list (MIT)
[The P-Norm Push](https://jmlr.csail.mit.edu/papers/v10/rudin09b.html), Rudin, 2009.
- **Result (math and experiments):** a ranking objective that concentrates on getting the highest-ranked items right.
- **Here:** the scorer is fitted to be roughly right on all 781 aims, but only its top few are ever tested. This is a small change to the training objective.

### 5. A network that understands "a set of blocks" (CMU, Stanford, MIT)
[Deep Sets](https://arxiv.org/abs/1703.06114), Zaheer and others (CMU, Amazon), 2017. [PointNet](https://arxiv.org/abs/1612.00593), Qi and others (Stanford), 2017. [Neural Physics Engine](https://arxiv.org/abs/1612.00341), Chang, Ullman, Torralba and Tenenbaum (MIT), 2017.
- **Result:** a board is a set with no natural order. Processing each block with the same small network and then pooling respects that (Deep Sets proves the form such functions must take; PointNet uses it on 3D points). The MIT work learns physics from object pairs and generalises across object counts.
- **Here:** describe every block relative to the aim line, instead of summarising the board in 40 numbers.
- **Catch:** the theorem is about what such a network can express, not about how much data it needs.

### 6. Practise on the boards the bot actually reaches (CMU)
[DAgger](https://proceedings.mlr.press/v15/ross11a.html), Ross, Gordon and Bagnell, 2011.
- **Result (math and experiments):** when a model's choices change which situations it meets, keep adding examples from its own play and retrain on everything.
- **Here:** the 896 training boards came from an earlier bot. Record boards from the current best bot's games and send them to volunteers.

### 7. A value for a whole board (MIT)
[Feature-based methods for large scale dynamic programming](https://www.mit.edu/~jnt/Papers/J060-96-bvr-feature.pdf), Tsitsiklis and Van Roy, 1996, and [temporal differences-based policy iteration](https://www.mit.edu/~dimitrib/Tempdif.pdf), Bertsekas and Ioffe, 1996. Both used **Tetris**.
- **Result:** a score built from a few board features can guide play in a game with far too many boards to list. (A [later study](https://jmlr.org/papers/v14/scherrer13a.html) reports different Tetris results from Bertsekas and Ioffe's, so treat their numbers with care.)
- **Here:** "how safe is this board?" would be the judge at the end of idea 1.

## Useful as checks, or for later
| work | why it is not near the top |
|---|---|
| [Rethinking generalization](https://arxiv.org/abs/1611.03530), Zhang (MIT) and others, 2017 | networks can memorise random labels; a good test of whether ours is only memorising |
| [Fine-grained analysis](https://arxiv.org/abs/1901.08584), Arora and others (Princeton), 2019 | theory for very wide two-layer networks; hard to apply directly |
| [Core-set active learning](https://arxiv.org/abs/1708.00489), Sener and Savarese (Stanford), 2018 | chooses what to label next; worth it only once more data helps again |
| [Hyperband](https://jmlr.org/papers/v18/16-558.html), Li (CMU) and others, 2018 | tunes settings efficiently; for after a method is chosen |
| [Gain from invariances](https://arxiv.org/abs/2303.14269), Tahmasebi and Jegelka (MIT), 2023 | symmetry can stretch data further, but only if the symmetry is exact (see below) |

## Checked already: the game is not mirror-symmetric
Flipping every board left to right looks like free extra data. A check on 360 shots from training boards says it is not:

| comparison with the original shot (same damage) | one ball | several balls or pickups |
|---|---|---|
| mirrored board and aim | 41% | 18% |
| aim nudged by half a pixel (how jumpy the game is anyway) | 62% | 37% |
| mirrored, **with the two side walls' bounciness swapped too** | 75% | 48% |

The reason: in the game's physics the **left wall is bouncier than the right** (0.5 against 0.2). Plain mirrored copies would teach the network wrong answers. Mirroring becomes usable only if the network is told which wall is which.

## Foresight and "fast and slow" reading list
Titles suggested for the goals **think ahead, predict better, think faster**. Checked by web search on 25 November 2026 (summaries only, full texts not read).

| work | what it is | use here |
|---|---|---|
| [Thinking Ahead in Real-Time Search](https://ojs.aaai.org/index.php/ICAPS/article/view/13353), Nau, Kuter and Sefer, 2009 | a planner that looks a fixed number of steps ahead cannot walk into dead ends, if the depth is at least how deep the traps go (for predictable worlds) | **direct**: the reason to look ahead; its guarantee needs a predictable next turn, which this game lacks |
| [Thinking Fast and Slow in Human and Machine Intelligence](https://cacm.acm.org/research/thinking-fast-and-slow-in-human-and-machine-intelligence), IBM and others, 2025 | a supervisor picks between a fast solver and a slow one | **direct**: spend fewer simulations when nothing is close to the line |
| [Identifying and Cultivating Superforecasters](https://www.psychologicalscience.org/journals/perspectives/1745691615577794/), Mellers and others, 2015 | careful forecasters give probabilities and keep score on them | give each prediction an error range learned from past misses |
| [Predictivity of variables](https://pmc.ncbi.nlm.nih.gov/articles/PMC4653162) (the linked article is the authors' related 2015 paper; the 2016 one is PNAS 113(50)), Lo and others | significant variables are not automatically good predictors | when choosing what to feed a model of the simulator's misses |
| [Thinking as the control of imagination](https://dx.doi.org/10.1007%2Fs00426-009-0237-z), Pezzulo and Castelfranchi, 2009 | thinking as running mental simulations | background; "The value of foresight" is a different paper, by Pezzulo and Rigoli (2011) |
| [Foresight intelligence in multimodal models](https://arxiv.org/abs/2511.18735), Gong and others, 2025 | tests of long-range anticipation for driving | little direct use |
| [Fast, slow and artificial](https://papers.ssrn.com/abstract=6097646), Shaw and Nave, 2026 (preprint) | how people lean on AI answers | about people, not the bot |
| [Fast and slow: a model of creative thinking](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11892090/), Khalil and Brüne, 2025 | neuroscience of the two modes | background |
| [Nailing Prediction](https://www.econbiz.de/Record/nailing-prediction-experimental-evidence-on-the-value-of-tools-in-predictive-model-development/10014236970), Yue, Hamilton and Bojinov, 2023 | how much software tools matter in prediction contests | little direct use |

Not checked here: Wack (1985) on scenarios, Voros (2003) on foresight frameworks, Clark (2013) on predictive brains, Kahneman and Tversky (1973) on the psychology of prediction.

## How each idea will be judged
One idea at a time, against the current best bot, on the development games used before, with the measure and the pass mark written down first. The final test games stay sealed.
