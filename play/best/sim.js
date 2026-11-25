/* Shot simulator for the real game, ported from the project's Python simulator: the game's own Box2D steps the physics (one fresh world per step),
   and the game's event logic (block hits, block nudges, destroy timers, pickups, multi-ball launches) is replayed around it. Blocks are in screen pixels, physics in metres.
   createSimulator(Box2D, constants) -> { simulate(blocks, pixel, pickups, spawn, nLaunch) }. blocks: [[uid, x, y, hp]], pixel: [px, py] in the 480 x 853 view. */
(function (root) {
  "use strict";
  function createSimulator(Box2D, E) {
    const { b2Vec2 } = Box2D.Common.Math, { b2BodyDef, b2FixtureDef, b2World, b2ContactListener } = Box2D.Dynamics, { b2PolygonShape } = Box2D.Collision.Shapes;
    const WS = E.ws, DT = E.dt, [BW, BH, HX, HY] = E.bquad, WALL_UIDS = new Set(E.walls.map((w) => w.uid));
    const BLOCK_PX = E.block_vertices.map(([x, y]) => [x / WS, y / WS]), BALL_PX = E.ball_vertices.map(([x, y]) => [x / WS, y / WS]);
    const OPT = { pk_size: 70.0, s2_rev: 5, s2_dy: 6.0, body_rev: 6 };                   // the validated settings (trigger S2, hit rule A)
    const z = (v) => (v === 0 ? 0 : v);                                                   // the original passes values through JSON, which turns -0 into 0

    function bquadMid(x, y) { const left = x + (-HX * BW), top = y + (-HY * BH), right = (x + BW) + (-HX * BW), bottom = (y + BH) + (-HY * BH); return [(left + right + right + left) / 4.0, (top + top + bottom + bottom) / 4.0]; }
    function syncPostStep(b) { const nx = b.bx / 0.02, ny = b.by / 0.02; if (nx !== b.sx || ny !== b.sy) { b.sx = nx; b.sy = ny; const [mx, my] = bquadMid(b.sx, b.sy), dx = mx - b.sx, dy = my - b.sy; if (dx !== 0 || dy !== 0) { b.sx -= dx; b.sy -= dy; } } }

    function addBody(world, verts, x, y, angle, o) {
      const fd = new b2FixtureDef(); fd.density = o.density; fd.friction = o.friction; fd.restitution = o.restitution;
      const bd = new b2BodyDef(); bd.type = o.immovable ? 0 : 2; bd.position.x = x; bd.position.y = y; bd.angle = angle; bd.fixedRotation = false; bd.linearDamping = 0; bd.angularDamping = 0.01; bd.bullet = !!o.bullet;
      const body = world.CreateBody(bd); body.uid = o.uid; const arr = verts.map((v) => b2Vec2.Get(v[0], v[1])); fd.shape = new b2PolygonShape(); fd.shape.SetAsArray(arr, arr.length); body.CreateFixture(fd); return body;
    }
    function step(balls, blocks) {                                                        // one physics step with all balls in one fresh world
      const w = new b2World(b2Vec2.Get(0, 10), true);
      for (const [uid, bx, by] of blocks) addBody(w, E.block_vertices, bx, by, 0, { density: 1, friction: 0.5, restitution: 0.5, immovable: true, uid });
      for (const wl of E.walls) addBody(w, wl.verts, wl.bx, wl.by, 0, { density: 1, friction: 0.5, restitution: wl.restitution, immovable: true, uid: wl.uid });
      const bodies = [];
      for (const s of balls) { const b = addBody(w, E.ball_vertices, s.x, s.y, s.angle, { density: 1, friction: 0.5, restitution: 0, immovable: false, bullet: true, uid: 1000 + s.id });
        b.SetLinearVelocity(b2Vec2.Get(s.vx, s.vy)); b.SetAngularVelocity(s.w); if (s.fx !== 0 || s.fy !== 0) b.ApplyForce(b2Vec2.Get(s.fx, s.fy), b.GetWorldCenter()); if (s.torque !== 0) b.ApplyTorque(s.torque); bodies.push([s.id, b]); }
      const begins = [], L = new b2ContactListener(); L.BeginContact = (c) => { begins.push([c.GetFixtureA().GetBody().uid, c.GetFixtureB().GetBody().uid]); }; w.SetContactListener(L);
      w.Step(DT, 8, 3); w.ClearForces();
      return { balls: bodies.map(([id, b]) => { const p = b.GetPosition(), v = b.GetLinearVelocity(); return { id, x: z(p.x), y: z(p.y), angle: z(b.GetAngle()), vx: z(v.x), vy: z(v.y), w: z(b.GetAngularVelocity()) }; }), begins };
    }

    function sat(P, Q) { for (const poly of [P, Q]) for (let i = 0; i < poly.length; i++) { const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length], nx = -(by - ay), ny = bx - ax;
      let pmin = Infinity, pmax = -Infinity, qmin = Infinity, qmax = -Infinity; for (const [x, y] of P) { const d = nx * x + ny * y; if (d < pmin) pmin = d; if (d > pmax) pmax = d; } for (const [x, y] of Q) { const d = nx * x + ny * y; if (d < qmin) qmin = d; if (d > qmax) qmax = d; }
      if (pmax < qmin || qmax < pmin) return false; } return true; }
    function ballPoly(ball) { const ca = Math.cos(ball.angle), sa = Math.sin(ball.angle), bx = ball.x / WS, by = ball.y / WS; return BALL_PX.map(([x, y]) => [bx + x * ca - y * sa, by + x * sa + y * ca]); }
    const overlapsPickup = (ball, p) => sat(ballPoly(ball), E.pk_unit.map(([x, y]) => [p[0] + x * OPT.pk_size, p[1] + y * OPT.pk_size]));
    const polyOverlap = (ball, c) => sat(ballPoly(ball), BLOCK_PX.map(([x, y]) => [c[0] + x, c[1] + y]));

    function simulate(blocks, pixel, pickups, spawn, nLaunch, maxSteps) {
      pickups = pickups || []; nLaunch = nLaunch === undefined ? 1 : nLaunch; maxSteps = maxSteps || 3000; const launchGap = 14;
      const tx = pixel[0] * E.scale, ty = pixel[1] * E.scale, aForce = Math.atan2(ty - 90.00000473844368, tx - 359.99177181978746), instAngle = Math.atan2(ty - 90.0, tx - 360.0);
      const ab = new Map();
      for (const [u, sx, sy, hp] of blocks) { const uid = Math.trunc(u), [mx, my] = bquadMid(sx, sy); ab.set(uid, { uid, bx: mx * 0.02, by: my * 0.02, sx, sy, sx0: sx, sy0: sy, hp: Math.trunc(hp), pdt: null, dy: [], lto: false, sdy: 0.0, srev: [] }); }
      const newBall = (id, x, y, fx, fy, k, after, fh) => ({ id, x, y, angle: 0.0, vx: 0.0, vy: 0.0, w: 0.0, fx, fy, torque: 0.0, active: true, spawn_k: k, angle_after: after, fh, fhw: [] });
      const balls = new Map([[1, newBall(1, 7.2, 1.8, Math.cos(aForce) * E.f_launch, Math.sin(aForce) * E.f_launch, 1, instAngle, 1)]]);
      const touchLast = new Map(), seenLast = new Map(), hits = {}; const pk = pickups.map((p) => [p[0], p[1]]);
      let firstHit = 1, fhWait = [], nextId = 2, lastK = 0, spawned = 0;
      const launchKs = Array.from({ length: Math.max(0, nLaunch) }, (_, i) => 1 + launchGap * i), resetKs = new Set(launchKs.map((l) => l + launchGap - 1)), lastLaunchK = launchKs[launchKs.length - 1];
      const ids = () => Array.from(balls.keys()).sort((a, b) => a - b), anyActive = () => Array.from(balls.values()).some((b) => b.active);
      for (let k = 1; k <= maxSteps; k++) {
        for (const [uid, b] of Array.from(ab)) if (b.pdt !== null && k >= b.pdt) ab.delete(uid);
        for (const b of ab.values()) {
          const rem = []; let changed = false;
          for (const d of b.dy) { if (k === d[0]) { b.sy += d[2]; changed = true; } else rem.push(d); }
          if (changed) { const [mx, my] = bquadMid(b.sx, b.sy); b.bx = mx * WS; b.by = my * WS; b.lto = true; } else if (b.lto) { b.lto = false; const [mx, my] = bquadMid(b.sx, b.sy); b.bx = mx * WS; b.by = my * WS; }
          syncPostStep(b); b.dy = rem;
        }
        if (resetKs.has(k)) { firstHit = 0; balls.get(1).fh = 0; }
        if (launchKs.includes(k) && k !== 1) { const nid = nextId++; balls.set(nid, newBall(nid, 7.2, 1.8, Math.cos(aForce) * E.f_launch, Math.sin(aForce) * E.f_launch, k, instAngle, 1)); firstHit = 1; }
        if (fhWait.some((e) => k >= e)) { firstHit = 1; fhWait = fhWait.filter((e) => k < e); }
        for (const b of balls.values()) if (b.fhw.some((e) => k >= e)) { b.fh = 1; b.fhw = b.fhw.filter((e) => k < e); }
        if (spawn && pk.length) for (const bid of ids()) { const bl = balls.get(bid); if (!bl.active || k === 1) continue;
          for (const p of pk.slice()) if (overlapsPickup(bl, p)) { pk.splice(pk.indexOf(p), 1); const nid = nextId++; balls.set(nid, newBall(nid, p[0] * WS, p[1] * WS, E.pick_f[0], E.pick_f[1], k, Math.atan2(ty - p[1], tx - p[0]), 0)); spawned++; } }
        const act = ids().map((i) => balls.get(i)).filter((b) => b.active);
        if (!act.length) { if (k >= lastLaunchK) break; continue; }
        const rep = step(act.map((b) => ({ id: b.id, x: b.x, y: b.y, angle: b.angle, vx: b.vx, vy: b.vy, w: b.w, fx: b.fx, fy: b.fy, torque: b.torque })), Array.from(ab, ([u, b]) => [u, b.bx, b.by]));
        const stepped = new Set();
        for (const s of rep.balls) { const b = balls.get(s.id); Object.assign(b, { x: s.x, y: s.y, angle: s.angle, vx: s.vx, vy: s.vy, w: s.w, fx: 0.0, fy: 0.0, torque: 0.0 }); if (k === b.spawn_k) b.angle = b.angle_after; stepped.add(s.id); }
        lastK = k;
        const order = [], touchNow = new Set();
        for (const [a_, b_] of rep.begins) { const bi = [a_, b_].filter((x) => x >= 1000); if (bi.length !== 1) continue; const bid = bi[0] - 1000, uid = a_ >= 1000 ? b_ : a_; if (WALL_UIDS.has(uid) || !ab.has(uid)) continue; const key = bid + "," + uid; if (!touchNow.has(key)) { touchNow.add(key); order.push(key); } }
        for (const t of ab.values()) { t.sdy = t.sdy - OPT.s2_dy * t.srev.filter((r) => r === k).length; t.srev = t.srev.filter((r) => r !== k); }
        const keyset = new Set(touchNow);
        for (const bid of ids()) { const bl = balls.get(bid); if (!bl.active || !stepped.has(bl.id)) continue; for (const [uid, t] of ab) { if (Math.abs(bl.x - t.bx) > 2.0 || Math.abs(bl.y - t.by) > 2.0) continue; keyset.add(bid + "," + uid); } }
        const pairs = Array.from(keyset, (key) => { const [bid, uid] = key.split(",").map(Number); const touch = touchNow.has(key); return { key, bid, uid, a: touch ? 0 : 1, b: touch ? order.indexOf(key) : uid }; }).sort((p, q) => p.a - q.a || p.b - q.b || p.bid - q.bid);
        const fires = [];
        for (const { key, bid, uid } of pairs) {
          const bl = balls.get(bid), t = ab.get(uid), touch = touchNow.has(key), newc = touch && touchLast.get(key) !== k - 1, ovS = polyOverlap(bl, bquadMid(t.sx0, t.sy0 + t.sdy));
          if (touch) touchLast.set(key, k);
          if (ovS || newc) { const run = seenLast.get(key) !== k - 1; seenLast.set(key, k); if (run) fires.push([bid, uid]); }
        }
        for (const [bid, uid] of fires) {
          const bl = balls.get(bid), tgt = ab.get(uid);
          if (firstHit === 0) { if (bl.x / WS <= tgt.sx) { bl.vx = -4.0; bl.vy = -3.6; } else { bl.vx = 4.0; bl.vy = -3.6; } fhWait.push(k + 5); }
          else { const fbx = Math.cos(-Math.PI / 2) * E.f_boost, fby = Math.sin(-Math.PI / 2) * E.f_boost, ca = Math.cos(bl.angle), sa = Math.sin(bl.angle), cx = bl.x + (ca * E.lc_a[0] - sa * E.lc_a[1]), cy = bl.y + (sa * E.lc_a[0] + ca * E.lc_a[1]), ptx = bl.x + E.lc_a[0], pty = bl.y + E.lc_a[1];
            bl.fx += fbx; bl.fy += fby; bl.torque += (ptx - cx) * fby - (pty - cy) * fbx; }
          tgt.dy.push([k + 2, 0.12, 6.0]); tgt.dy.push([k + OPT.body_rev, -0.12, -6.0]); tgt.hp -= 1; tgt.sdy += OPT.s2_dy; tgt.srev.push(k + OPT.s2_rev); if (tgt.hp <= 0 && tgt.pdt === null) tgt.pdt = k + 2;
          hits[uid] = (hits[uid] || 0) + 1;
        }
        for (const s of rep.balls) { const b = balls.get(s.id); if (b.y > 26.5) b.active = false; }
        if (!anyActive() && k >= lastLaunchK) break;
      }
      return { hits, flight: lastK, completed: lastK < maxSteps, spawns: spawned, pickups_left: pk };
    }
    return { simulate };
  }
  const api = { createSimulator };
  root.NNSim = api; if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
