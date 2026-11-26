#!/usr/bin/env python3
"""Measure how a real game of Falling Ballz progresses, from logs of real games, and write web/play/progression.json for the puzzle builder.

  python3 tools/fit_progression.py LOG.jsonl [LOG.jsonl ...] [--out web/play/progression.json] [--min-turns 20]

A log line is one finished turn as the watch page records it (turn, score, balls, board.blocks = [[uid, x, y, health], ...]); a log may hold several games.
The same game stored twice (a copy of a log) is counted once.

What the numbers are for. The game's own rules fix some things exactly (read from the game's event sheet; see docs/GAME_RULES.md): a new row has 1, 2 or 3 blocks
with probabilities 3/7, 2/7, 2/7 (so 13/7 blocks per turn), a new block's health is 1 + floor(turn / 3), and the pickup timer makes an extra ball possible every 7 turns at best.
The rules cannot say how a player behaves, so those parts are measured here: how long the bot takes to collect pickups (turns per ball), how many blocks of a row are still alive
after 1, 2, 3 ... turns, and how much of their health is left. The comparison of the rules with the measured averages is printed, and stored, so it can be checked."""
import collections, glob, hashlib, json, math, os, statistics, sys

CODE_BLOCKS_PER_TURN = 13 / 7                      # the rules: (6/7 of turns pick 1, 2 or 3 blocks equally -> 2) + (1/7 of turns are pickup rows with 1 block)
CODE_ROW_SHARES = {1: 3 / 7, 2: 2 / 7, 3: 2 / 7}
OPENING_BLOCKS = 6                                 # the fixed opening board
# where the rules put a new block (x ranges, uniform inside): a lone block is an ordinary row of one or the block of a pickup row; rows of two and three have a range each
LONE_BLOCK_X = [(120, 600), (120, 240), (340, 600)]
ROW_X = {2: [(120, 260), (360, 600)], 3: [(65, 217), (340, 400), (510, 657)]}
QUANTILES = [i / 10 for i in range(11)]
MAX_AGE = 8                                        # a row 8 turns old sits at y of about 192-202, the last row that is not already lost


def load_games(paths, min_turns):
    games, seen = {}, set()
    for path in paths:
        for line in open(path):
            try: row = json.loads(line)
            except ValueError: continue                          # a half-written last line
            if "board" in row and "turn" in row: games.setdefault((os.path.abspath(path), row.get("game", 1)), []).append(row)       # keyed by the whole path: two copies of one log share a file name
    out = []
    for key in sorted(games):
        rows = games[key]
        if len(rows) < min_turns: continue
        fingerprint = hashlib.sha256(json.dumps([r["board"] for r in rows[:3]], sort_keys=True).encode()).hexdigest()
        if fingerprint in seen: continue                         # the same game, stored twice
        seen.add(fingerprint); out.append(rows)
    return out


def row_baseline(y):
    """New rows appear at y = 1200 (1210 for rows of three) and rise 126 a turn; return which baseline a block sits on, or None (the opening board)."""
    for base in (1200, 1210):
        if abs(((y - base + 63) % 126) - 63) < 5: return base
    return None


def fit(games):
    turns = sum(len(g) for g in games)
    # how many blocks the newest row has (turn 1 is the fixed opening board, not a spawned row)
    shapes = collections.Counter(); at_1210 = three = 0
    for rows in games:
        for r in rows[1:]:
            newest = [b for b in r["board"]["blocks"] if b[2] >= 1195]
            if not newest or len(newest) > 3: continue
            shapes[len(newest)] += 1
            if len(newest) == 3: three += 1; at_1210 += all(abs(b[2] - 1210) < 2 for b in newest)
    rows_seen = sum(shapes.values())
    # do new blocks land inside the ranges the rules give? (a pixel of slack for rounding)
    inside, seen_rows = collections.Counter(), collections.Counter()
    for rows in games:
        for r in rows[1:]:
            newest = sorted([b for b in r["board"]["blocks"] if b[2] >= 1195], key=lambda b: b[1])
            if not newest or len(newest) > 3: continue
            ok = any(lo - 1 <= newest[0][1] <= hi + 1 for lo, hi in LONE_BLOCK_X) if len(newest) == 1 else all(lo - 1 <= b[1] <= hi + 1 for b, (lo, hi) in zip(newest, ROW_X[len(newest)]))
            seen_rows[len(newest)] += 1; inside[len(newest)] += ok
    # blocks alive before a shot, once the board has filled
    alive = [len(r["board"]["blocks"]) for rows in games for r in rows if r["turn"] >= 20]
    mean_alive = statistics.mean(alive)
    # turns per extra ball: pooled over the games long enough to show it
    long_games = [g for g in games if len(g) >= 100]
    d_turn = sum(g[-1]["turn"] - g[19]["turn"] for g in long_games); d_ball = sum(g[-1]["balls"] - g[19]["balls"] for g in long_games)
    period = d_turn / d_ball
    start = statistics.median(r["turn"] - period * (r["balls"] - 1) for rows in games for r in rows if r["turn"] >= 30)
    # the health rule: the newest row's health against 1 + floor(turn / 3). A game's logged turn numbers can run a turn ahead of or behind the game's own counter for the
    # whole game (a logging slip, not a different rule), so each game is checked at its best constant offset of -1, 0 or +1 and the offsets are reported
    exact = total = 0; offsets = []
    for rows in games:
        best = None
        for d in (0, 1, -1):
            hit = n = 0
            for r in rows:
                newest = [b for b in r["board"]["blocks"] if b[2] >= 1195]
                if newest: n += 1; hit += all(b[3] == 1 + (r["turn"] + d) // 3 for b in newest)
            if best is None or hit > best[1]: best = (d, hit, n)
        offsets.append(best[0]); exact += best[1]; total += best[2]
    # the score per turn, game by game (long games only: the blocks still on the board at the end pull a short game's figure down)
    per_game = [(g[-1]["score"] - g[19]["score"]) / (g[-1]["turn"] - g[19]["turn"]) for g in long_games]
    # what happens to the blocks of a row as it ages
    cnt, board_count, fractions = collections.Counter(), 0, collections.defaultdict(list)
    for rows in games:
        for r in rows:
            t = r["turn"]
            if t < 12: continue
            board_count += 1
            for _, x, y, hp in r["board"]["blocks"]:
                base = row_baseline(y)
                if base is None: continue
                age = round((base - y) / 126)
                if 0 <= age <= MAX_AGE: cnt[age] += 1; fractions[age].append(min(1.0, hp / (1 + (t - age) // 3)))
    alive_per_row, keep = [], []
    for age in range(MAX_AGE + 1):
        alive_per_row.append(round(cnt[age] / board_count, 4))
        f = sorted(fractions[age]) or [0.0]
        keep.append([round(f[min(len(f) - 1, int(q * len(f)))], 3) for q in QUANTILES])
    return {
        "about": "Measured from logs of real games by tools/fit_progression.py; the rules these are compared with are in docs/GAME_RULES.md. Re-run the tool to refresh.",
        "provenance": {"games": len(games), "turns": turns, "long_games": len(long_games)},
        "fit": {
            "score_slope": round(CODE_BLOCKS_PER_TURN, 6),                      # from the rules: every block spawned is destroyed in the long run, 13/7 a turn
            "score_intercept": round(OPENING_BLOCKS - CODE_BLOCKS_PER_TURN - mean_alive, 2),     # the opening 6 blocks, minus the first row's turn, minus the blocks still alive (measured)
            "mean_blocks_alive": round(mean_alive, 2),
            "ball_period": round(period, 3),                                      # measured: turns per extra ball (the rules allow 7 at best)
            "ball_start_turn": round(start, 2),                                   # measured: balls = 1 + (turn - this) / ball_period
        },
        "board": {"max_age": MAX_AGE, "alive_per_row": alive_per_row, "quantile_points": QUANTILES, "health_left": keep},
        "check": {
            "row_shares": {"code": [round(CODE_ROW_SHARES[n], 4) for n in (1, 2, 3)], "data": [round(shapes[n] / rows_seen, 4) for n in (1, 2, 3)], "rows": rows_seen},
            "blocks_per_turn": {"code": round(CODE_BLOCKS_PER_TURN, 4), "data": round(sum(n * c for n, c in shapes.items()) / rows_seen, 4)},
            "score_per_turn_long_games": {"code": round(CODE_BLOCKS_PER_TURN, 4), "data": round(statistics.mean(per_game), 4), "games": [round(x, 3) for x in per_game]},
            "turns_per_ball": {"code_best_case": 7, "data": round(period, 3)},
            "three_block_rows_at_1210": {"code": "all", "data": f"{at_1210}/{three}"},
            "blocks_inside_the_rules_x_ranges": {"code": "all", "data": {str(n): f"{inside[n]}/{seen_rows[n]}" for n in (1, 2, 3)}},
            "health_rule_1_plus_turn_div_3": {"code": "exact", "data": f"{exact}/{total}", "games_needing_a_log_offset": sum(1 for d in offsets if d != 0), "offsets": offsets},
        },
    }


def main(argv):
    out, min_turns, paths = "web/play/progression.json", 20, []
    it = iter(argv)
    for a in it:
        if a == "--out": out = next(it)
        elif a == "--min-turns": min_turns = int(next(it))
        else: paths += glob.glob(os.path.expanduser(a))
    if not paths: sys.exit(__doc__)
    games = load_games(paths, min_turns)
    if not games: sys.exit("no game with enough turns in those logs")
    result = fit(games)
    with open(out, "w") as f: json.dump(result, f, indent=1, sort_keys=True); f.write("\n")
    c = result["check"]
    print(f"{result['provenance']['games']} games, {result['provenance']['turns']} turns -> {out}")
    print(f"  new row has 1/2/3 blocks   code {c['row_shares']['code']}   data {c['row_shares']['data']}")
    print(f"  blocks per turn            code {c['blocks_per_turn']['code']}   data {c['blocks_per_turn']['data']}")
    print(f"  turns per extra ball       code >= 7   data {c['turns_per_ball']['data']}")
    print(f"  health rule                data {c['health_rule_1_plus_turn_div_3']['data']} rows exact")


if __name__ == "__main__":
    main(sys.argv[1:])
