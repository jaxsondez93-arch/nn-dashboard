"""The statistics on the watch page, checked against known answers and made-up data whose true values are known."""
import json, os, shutil, subprocess, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = shutil.which("node")


class Overlay(unittest.TestCase):
    def test_the_thinking_display_is_see_through(self):
        with open(ROOT + "/web/play/index.html") as f:
            self.assertRegex(f.read(), r"#mind \{[^}]*background:transparent")          # the site styles other canvases with a solid background, which would hide the game


@unittest.skipUnless(NODE, "node not installed")
class Stats(unittest.TestCase):
    def js(self, body):
        code = f'const S=require({json.dumps(ROOT + "/web/play/stats.js")}); let a=7; const rng=()=>(a=(Math.imul(a,48271)>>>0)%2147483647)/2147483647; {body}'
        p = subprocess.run([NODE, "-e", code], capture_output=True, text=True, timeout=60); self.assertEqual(p.returncode, 0, p.stderr); return json.loads(p.stdout)

    def test_wilson_interval_known_values(self):
        w = self.js("console.log(JSON.stringify(S.wilson(8,10)))"); self.assertAlmostEqual(w["lo"], 0.4902, 3); self.assertAlmostEqual(w["hi"], 0.9433, 3)
        z = self.js("console.log(JSON.stringify([S.wilson(0,20), S.wilson(0,0)]))"); self.assertEqual(z[0]["lo"], 0); self.assertGreater(z[0]["hi"], 0.1); self.assertIsNone(z[1])

    def test_logistic_fit_recovers_the_truth(self):
        m = self.js("const r=Array.from({length:6000},()=>{const b=1+Math.floor(rng()*30), p=1/(1+Math.exp(-(3-0.3*b))); return {balls:b,predicted:5,damage:rng()<p?5:4}}); console.log(JSON.stringify(S.logistic(r)))")
        self.assertAlmostEqual(m["a"], 3, delta=0.25); self.assertAlmostEqual(m["b"], -0.3, delta=0.025); self.assertAlmostEqual(m["half"]["balls"], 10, delta=0.6)

    def test_per_ball_model_recovers_q(self):
        m = self.js("const r=Array.from({length:6000},()=>{const b=1+Math.floor(rng()*30); return {balls:b,predicted:5,damage:rng()<Math.pow(0.9,b)?5:4}}); console.log(JSON.stringify(S.perBall(r)))")
        self.assertAlmostEqual(m["q"], 0.9, delta=0.007); self.assertLess(m["qLo"], 0.9 + 0.007); self.assertAlmostEqual(m["half"], 6.58, delta=0.5)

    def test_models_refuse_data_with_nothing_to_learn(self):
        self.assertEqual(self.js("const r=Array.from({length:30},(_, i)=>({balls:i+1,predicted:1,damage:1})); console.log(JSON.stringify([S.logistic(r), S.perBall(r), S.constant(r)]))"), [None, None, None])

    def test_trend_and_several_causes_on_exact_data(self):
        t, m = self.js("const x=[0,1,2,3,4,5,6,7,8,9,10,11], u=x.map(v=>v%4), y=x.map((v,i)=>2+3*v-5*u[i]); const m=S.multiple(y,[x,u]); console.log(JSON.stringify([S.trend(x,x.map(v=>1+2*v),true), m]))")
        self.assertAlmostEqual(t["slope"], 2); self.assertAlmostEqual(t["slopeHalf"], 0, 6); self.assertAlmostEqual(m["r2"], 1, 6); self.assertGreater(m["terms"][0]["coef"], 0); self.assertLess(m["terms"][1]["coef"], 0)

    def test_correlation_histogram_and_memory(self):
        got = self.js("console.log(JSON.stringify([S.pearson([1,2,3,4],[2,4,6,8]), S.pearson([1,2,3],[5,5,5]), S.histogram([0,0,1,2,2,2],2).map(b=>b.n), S.autocorrelation([1,-1,1,-1,1,-1,1,-1],2)]))")
        self.assertAlmostEqual(got[0], 1); self.assertIsNone(got[1]); self.assertEqual(got[2], [2, 4]); self.assertLess(got[3][0], -0.7); self.assertGreater(got[3][1], 0.6)

    def test_watching_the_search_does_not_change_the_choice(self):
        got = self.js(f"""const Q=require({json.dumps(ROOT + "/web/play/best/search.js")}); const px=Array.from({{length:781}},(_,i)=>[i,0]), board={{blocks:[[1,100,900,50]],pickups:[[1,1]],balls:3,turn:1}};
            const sim={{simulate:(b,p)=>({{hits:{{1:(p[0]*37)%41}},completed:true,pickups_left:p[0]%97===5?[]:board.pickups}})}}, sc={{scoreAll:()=>px.map((_,i)=>(i*13)%101),pickupOrder:()=>px.map((_,i)=>i).slice(0,780)}}, cfg={{n1:12,rho:16,refine:5,budget:30,extra:20}};
            let n=0; const quiet=Q.chooseAim(sim,sc,px,board,cfg), watched=Q.chooseAim(sim,sc,px,board,cfg,()=>n++); console.log(JSON.stringify([quiet.index===watched.index, quiet.sims===watched.sims, n>30]))""")
        self.assertEqual(got, [True, True, True])


if __name__ == "__main__":
    unittest.main()
