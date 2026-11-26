"""Looking ahead, thinking on several processors, and the scoreboard: checked with made-up games where the right answer is known."""
import json, os, shutil, subprocess, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


def js(body):
    head = f'const S=require({json.dumps(ROOT + "/web/play/best/search.js")}), P=require({json.dumps(ROOT + "/web/play/best/pool.js")}), H=require({json.dumps(ROOT + "/web/play/hud.js")}); let a=11; const rng=()=>(a=(Math.imul(a,48271)>>>0)%2147483647)/2147483647; const px=Array.from({{length:781}},(_,i)=>[i,0]);'
    p = subprocess.run([NODE, "-e", head + "(async()=>{" + body + "})()"], capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    return json.loads(p.stdout)


# a made-up board: block 1 sits low (it must break next turn if it survives), block 2 is far away
LOW = "const board={blocks:[[1,100,318,7],[2,300,1100,60]],pickups:[],balls:5,turn:9}; const sc={scoreAll:()=>px.map((_,i)=>-i), aimsToward:()=>px.map((_,i)=>(i+400)%780)};"


@unittest.skipUnless(NODE, "node not installed")
class LookAhead(unittest.TestCase):
    def test_rows_left_matches_the_loss_line(self):
        got = js("console.log(JSON.stringify([192,245,246,318,371,372,497,498].map(S.rowsLeft)))")
        self.assertEqual(got, [0, 0, 1, 1, 1, 2, 2, 3])

    def test_a_block_about_to_become_last_chance_beats_more_damage(self):
        got = js(LOW + """const sim={simulate:(b,p)=>({hits:p[0]===406?{1:7,2:5}:{2:50},completed:true,pickups_left:[]})}, cfg={n1:3,rho:10,refine:1,budget:6,urgent:20};
            const off=S.chooseAim(sim,sc,px,board,cfg), on=S.chooseAim(sim,sc,px,board,Object.assign({lookahead:true},cfg)); console.log(JSON.stringify([off.predicted, off.urgent, on.index, on.predicted, on.urgent]))""")
        self.assertEqual(got, [50, 7, 406, 12, 0])

    def test_fewer_shots_only_when_nothing_is_near_the_line(self):
        got = js("""const sc={scoreAll:()=>px.map((_,i)=>-i), aimsToward:()=>[]}, sim={simulate:()=>({hits:{1:1},completed:true,pickups_left:[]})}, cfg={n1:12,rho:16,refine:5,budget:30,calm:16,lookahead:true};
            const n=(y)=>S.chooseAim(sim,sc,px,{blocks:[[1,100,y,500]],pickups:[],balls:2,turn:1},cfg); console.log(JSON.stringify([n(1100).sims, n(1100).calm, n(560).sims, n(560).calm]))""")
        self.assertEqual(got, [16, True, 30, False])

    def test_survival_still_comes_first(self):
        got = js("""const board={blocks:[[1,100,200,4],[2,300,318,7]],pickups:[],balls:5,turn:9}, sc={scoreAll:()=>px.map((_,i)=>-i), aimsToward:()=>px.map((_,i)=>i)};
            const sim={simulate:(b,p)=>({hits:p[0]===0?{2:7}:{1:4},completed:true,pickups_left:[]})}; const r=S.chooseAim(sim,sc,px,board,{n1:3,rho:10,refine:1,budget:6,lookahead:true,urgent:10}); console.log(JSON.stringify([r.losing, r.index!==0]))""")
        self.assertEqual(got, [False, True])


@unittest.skipUnless(NODE, "node not installed")
class SeveralProcessors(unittest.TestCase):
    def test_the_choice_is_the_same_with_any_number_of_processors(self):
        got = js("""let wrong=0; for(let t=0;t<250;t++){ const pl=rng(), pg=rng()**3, T=px.map(()=>({h1:rng()<pl?0:7, h2:Math.floor(rng()*30), got:rng()<pg}));
            const board={blocks:[[1,100,t%2?318:200,7],[2,300,1100,60]],pickups:[[1,1]],balls:5,turn:9}, sc={scoreAll:()=>px.map((_,i)=>-Math.abs(i-t*3)), aimsToward:()=>px.map((_,i)=>(i*41+t)%780), pickupOrder:()=>px.map((_,i)=>(i*37+t)%780)};
            const sim={simulate:(b,p)=>{const o=T[p[0]]; return {hits:{1:o.h1,2:o.h2},completed:true,pickups_left:o.got?[]:board.pickups}}}, cfg={n1:12,rho:16,refine:5,budget:30,extra:20,urgent:30,lookahead:t%3>0};
            const one=S.chooseAim(sim,sc,px,board,cfg); for(const w of [2,5]){ const many=await S.chooseAimParallel(async(aims,each)=>aims.map(i=>{const o=S.outcome(sim,board,px[i]); each(i,o); return o;}), w, sc, px, board, cfg); if(many.index!==one.index||many.sims!==one.sims) wrong++; } }
            console.log(wrong)""")
        self.assertEqual(got, 0)

    def test_the_pool_returns_results_in_the_order_asked(self):
        got = js("""const helpers=[0,1,2].map(()=>({postMessage(m){ if(m.board) return; setTimeout(()=>this.onmessage({data:{job:m.job,k:m.k,o:m.i*10}}), Math.floor(rng()*12)); }}));
            const pool=P.createPool(helpers); pool.board({}); const seen=[]; const a=await pool.compute([5,3,9,1,7,2,8], (i)=>seen.push(i)); const b=await pool.compute([], ()=>{}); console.log(JSON.stringify([a, seen.length, b, pool.size]))""")
        self.assertEqual(got, [[50, 30, 90, 10, 70, 20, 80], 7, [], 3])


@unittest.skipUnless(NODE, "node not installed")
class Scoreboard(unittest.TestCase):
    def test_shots_left_and_milestones(self):
        got = js("console.log(JSON.stringify([H.shotsLeft([]), H.shotsLeft([[1,0,192,3]]), H.shotsLeft([[1,0,318,3],[2,0,900,1]]), H.shotsLeft([[1,0,900,1]]), H.crossed([100,250,500],99,260), H.crossed([100],100,101)]))")
        self.assertEqual(got, [None, 1, 2, 7, [100, 250], []])

    def test_record_game_file(self):
        with open(ROOT + "/web/play/record.json") as f:
            d = json.load(f)
        self.assertEqual(len(d["turns"]), 1413); self.assertEqual(d["turns"][-1]["turn"], 1413); self.assertEqual(max(t["balls"] for t in d["turns"]), 199)
        self.assertEqual(set().union(*(t.keys() for t in d["turns"])) - {"turn", "balls", "blocks", "hp_before", "predicted", "damage", "think_s", "sims", "score", "arm", "speed_used"}, set())


if __name__ == "__main__":
    unittest.main()
