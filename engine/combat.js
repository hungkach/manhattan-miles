// Combat module (spec: "Combat mode", milestone 4). Detectors for guard,
// stance, strikes, slip and level changes, the arm pose games mirror, and
// the fight state machine (standing -> shot -> top) that turns them into
// takedowns and down strikes. Kicks are out of scope: knees-up framing
// cannot see the feet.
//
// Frames: strikes and the arm pose use 3D world landmarks in a camera-facing
// frame learned at calibration (cal.frame: right, up, fwd, where fwd points
// at the camera), so a punch toward the screen reads as reach, not as an
// image the camera cannot see the depth of. Guard and slip use 2D body units.
(function (g) {
  'use strict';
  const RE = g.RepEngine;
  const L = RE.LM;

  for (const name of ['strike', 'squat', 'drive_up', 'jump', 'slip', 'stance', 'bound', 'teep', 'low_kick', 'knee', 'weave']) RE.detectors.add(name);

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const len = (a) => Math.hypot(a.x, a.y, a.z);
  const norm = (a) => { const n = len(a); return n > 0 ? { x: a.x / n, y: a.y / n, z: a.z / n } : null; };
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

  // Camera-facing frame from world landmarks: right from the shoulders (so
  // mirroring never flips it), up from hip to shoulder, fwd toward the camera.
  RE.bodyFrame = function (world, up) {
    const right0 = norm(sub(world[L.R_SHOULDER], world[L.L_SHOULDER]));
    const u = up || RE.worldUp(world);
    if (!right0 || !u) return null;
    const fwd = norm(cross(u, right0));
    if (!fwd) return null;
    return { right: norm(cross(fwd, u)), up: u, fwd };
  };

  // The frame to measure arms in: calibrated (stays facing the camera when
  // the torso turns into a stance), else this frame's torso.
  function frameOf(ctx) {
    return (ctx.cal && ctx.cal.frame) || (ctx.world ? RE.bodyFrame(ctx.world, ctx.cal && ctx.cal.up) : null);
  }

  // Arm pose in that frame, relative to the shoulder midpoint, in calibrated
  // shoulder widths: x = player's right, y = up, z = toward the camera.
  // Per arm: shoulder, elbow, wrist, extension (0 at a 90 degree elbow, 1
  // straight) and reach (wrist distance in front of its shoulder over arm length).
  RE.armPose = function (world, frame, sw) {
    if (!world || !frame) return null;
    const sm = RE.mid3(world[L.L_SHOULDER], world[L.R_SHOULDER]);
    const unit = sw > 0 ? sw : len(sub(world[L.R_SHOULDER], world[L.L_SHOULDER])) || 0.4;
    const at = (p) => { const d = sub(p, sm); return { x: dot(d, frame.right) / unit, y: dot(d, frame.up) / unit, z: dot(d, frame.fwd) / unit }; };
    const arm = (sh, el, wr) => {
      const s = world[sh], e = world[el], w = world[wr];
      const armLen = len(sub(e, s)) + len(sub(w, e));
      const angle = RE.jointAngle(s, e, w);
      return {
        shoulder: at(s), elbow: at(e), wrist: at(w), angle,
        extension: RE.clamp((angle - 90) / 90, 0, 1),
        reach: armLen > 0 ? RE.clamp(dot(sub(w, s), frame.fwd) / armLen, -1, 1) : 0,
      };
    };
    return { left: arm(L.L_SHOULDER, L.L_ELBOW, L.L_WRIST), right: arm(L.R_SHOULDER, L.R_ELBOW, L.R_WRIST) };
  };

  // Guard: both wrists near the face, held a moment; drops when either leaves.
  // Also records when each hand was last at the guard, which gates strikes.
  class GuardDetector {
    constructor(cfg) { this.c = cfg.combat.guard; this.since = null; this.up = false; this.lastNear = { left: -Infinity, right: -Infinity }; }
    update(ctx, out) {
      const t = ctx.t;
      const b = ctx.sig.body;
      const ratio = ctx.cal.torsoLength / ctx.cal.shoulderWidth; // T in S
      const dist = (w) => Math.hypot(w.x - b.nose.x, (w.y - b.nose.y) * ratio);
      const near = (w, lim) => dist(w) <= lim && w.y >= b.sMid.y - this.c.below;
      const ok = (i) => { const p = ctx.points[i]; return p && !p.held && p.v >= ctx.holdVis; };
      const nl = !ctx.upperLow && ok(L.L_WRIST) && near(b.lw, this.c.near);
      const nr = !ctx.upperLow && ok(L.R_WRIST) && near(b.rw, this.c.near);
      if (nl) this.lastNear.left = t;
      if (nr) this.lastNear.right = t;
      out.handNearAt = { left: this.lastNear.left, right: this.lastNear.right };
      if (!this.up) {
        if (nl && nr) {
          if (this.since === null) this.since = t;
          if (t - this.since >= this.c.holdMs) this.up = true;
        } else this.since = null;
      } else {
        const keep = (w, i) => ok(i) && near(w, this.c.near * this.c.release);
        // a hand out on a punch keeps the guard: only both hands down, or one away too long, drop it
        const l = keep(b.lw, L.L_WRIST) || t - this.lastNear.left < this.c.punchMs;
        const r = keep(b.rw, L.R_WRIST) || t - this.lastNear.right < this.c.punchMs;
        if (ctx.upperLow || !(l && r)) { this.up = false; this.since = null; }
      }
      out.guard = this.up;
      // each hand on its own (a hand by the ear covers that side against a hook)
      out.guardHands = { left: nl, right: nr };
    }
  }

  // Stance: which shoulder leads (nearer the camera). Torso yaw from the turn
  // detector gives it; with a square torso, a hand clearly in front decides.
  // Held stanceMs before it changes; fires 'stance' on a change.
  class StanceDetector {
    constructor(cfg) { this.c = cfg.combat.stance; this.stance = 'square'; this.cand = 'square'; this.since = 0; }
    update(ctx, out) {
      const t = ctx.t;
      let now = 'square';
      if (out.yaw >= this.c.minYaw) now = 'orthodox';
      else if (out.yaw <= -this.c.minYaw) now = 'southpaw';
      else if (out.arms) {
        const d = out.arms.left.wrist.z - out.arms.right.wrist.z;
        if (d >= this.c.handLead) now = 'orthodox';
        else if (d <= -this.c.handLead) now = 'southpaw';
      }
      if (now !== this.cand) { this.cand = now; this.since = t; }
      if (this.cand !== this.stance && t - this.since >= this.c.holdMs) {
        this.stance = this.cand;
        out.events.push(['stance', { stance: this.stance }]);
      }
      out.stance = this.stance;
    }
  }

  // Strikes, per hand (0.9.0, Mark 10/20: the warm-up missed hooks and uppercuts, and waving
  // the arms back and forth threw hooks; "just guess from the movement"). A punch is a fast move
  // out from a set hand toward the camera (where the opponent is), judged where it ends:
  //   set       the hand was up in front (wrist no lower than setBelow under its shoulder,
  //             within setWide of the body's middle, elbow bent under setAngle) and still
  //             (under stillSpeed) for setMs, and the move began within setWithinMs of that.
  //             Waving or flailing never holds still, so it never starts a punch.
  //   the move  fist speed past minSpeed and setTravel from where it was set; it is judged at
  //             its far end (the fist stops getting farther, or slows under stopSpeed), which
  //             has to be frontMin in front of its shoulder.
  //   straight  the elbow ends straight (straightOn) with the fist fwdGain nearer the camera:
  //             jab with the lead hand, cross with the rear
  //   uppercut  from its lowest point the fist rose upperRise, mostly upward (upperShare),
  //             ending no lower than upperTo under the shoulder
  //   hook      the fist swept inward hookTravel (torso frame) from its outermost point, the
  //             elbow still bent (hookAngle); from the rear hand it is the overhand (0.8.0)
  //   guess     anything else that went toward the camera (fwdGuess) is a straight
  //   down      from a crouch, the fist driving down (downBelow, downSpeed)
  // Power is peak fist speed over refSpeed, clamped 0.5 to 1.5 (spec).
  // Taught strikes (0.10.0, Mark 10/21: "the coach teaches you how to throw a strike, the system
  // captures it, and that's how it reads it"). In the gym the game asks for each punch; while
  // teaching (engine.teach_strike), every move the asked-for hand makes out from rest is kept as
  // that player's sample of that punch, whatever the rules make of it, and while the guard is held
  // (engine.teach_guard) the engine learns where that player's hands rest. From then on a hand
  // near its learned guard counts as set, and a move is read by the nearest of the player's own
  // samples (the shape of the fist's path from where it was set to its far end, in arm lengths,
  // with the elbow angle), the other hand's samples mirrored when a hand has none. The rules
  // below still read any punch that was never taught.
  const ROLE = { jab: 'straight', cross: 'straight', hook: 'hook', overhand: 'hook', uppercut: 'uppercut' };
  // where a punch is over: the fist has come back to backFrac of its farthest distance from where
  // it was set (its index in path), or -1 while it is still out
  function backAt(path, backFrac, minFar = 0) {
    const s0 = path[0];
    let far = 0;
    for (let i = 1; i < path.length; i++) {
      const d = Math.hypot(path[i].x - s0.x, path[i].y - s0.y, path[i].z - s0.z);
      if (d > far) far = d;
      else if (far >= minFar && d <= backFrac * far) return i;
    }
    return -1;
  }
  // the fist's path from where it was set until it is on its way back, resampled to n points by
  // arc length, in arm lengths (L, m), each point [dx, dy, dz, elbow angle / 180 * angleW]
  // (backFrac 0: only out to its farthest point, for an early read)
  function strikeShape(path, L, n, angleW, backFrac) {
    const s0 = path[0];
    let seg;
    if (backFrac > 0) { const bi = backAt(path, backFrac, 0.05); seg = bi > 0 ? path.slice(0, bi + 1) : path; }
    else {
      let fi = 0, fd = 0;
      path.forEach((x, i) => { const d = Math.hypot(x.x - s0.x, x.y - s0.y, x.z - s0.z); if (d > fd) { fd = d; fi = i; } });
      seg = path.slice(0, fi + 1);
    }
    let far = 0;
    for (const x of seg) far = Math.max(far, Math.hypot(x.x - s0.x, x.y - s0.y, x.z - s0.z));
    if (seg.length < 2) return null;
    const cum = [0];
    for (let i = 1; i < seg.length; i++) cum.push(cum[i - 1] + Math.hypot(seg[i].x - seg[i - 1].x, seg[i].y - seg[i - 1].y, seg[i].z - seg[i - 1].z));
    const total = cum[cum.length - 1];
    if (!(total > 0)) return null;
    const pts = [];
    let j = 1;
    for (let k = 0; k < n; k++) {
      const at = (total * k) / (n - 1);
      while (j < seg.length - 1 && cum[j] < at) j++;
      const a = seg[j - 1], b = seg[j], u = cum[j] > cum[j - 1] ? RE.clamp((at - cum[j - 1]) / (cum[j] - cum[j - 1]), 0, 1) : 1;
      const lp = (p, q) => p + (q - p) * u;
      pts.push([(lp(a.x, b.x) - s0.x) / L, (lp(a.y, b.y) - s0.y) / L, (lp(a.z, b.z) - s0.z) / L, (lp(a.angle, b.angle) / 180) * angleW]);
    }
    return { pts, len: total / L, far: far / L };
  }
  // root mean square distance between two shapes; mirror flips the other hand's sideways axis
  function shapeDist(a, b, mirror) {
    let sum = 0;
    for (let i = 0; i < a.pts.length; i++) {
      const p = a.pts[i], q = b.pts[i];
      sum += (p[0] - (mirror ? -q[0] : q[0])) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 + (p[3] - q[3]) ** 2;
    }
    return Math.sqrt(sum / a.pts.length);
  }
  RE.strikeShape = strikeShape;

  // The player's taught punches. With a side camera on (0.12.0) the set taught with it, since its
  // depth is truer and the paths differ; without one the main camera's set. Either falls back to
  // the other until it has samples of its own.
  function libOf(ctx) {
    const c = ctx.cal;
    if (!c) return null;
    return (ctx.sideOn ? c.strikesSide || c.strikes : c.strikes || c.strikesSide) || null;
  }
  function libFor(ctx) { const k = ctx.sideOn ? 'strikesSide' : 'strikes'; return (ctx.cal[k] = ctx.cal[k] || {}); }
  class StrikeDetector {
    constructor(cfg) {
      this.c = cfg.combat.strike;
      this.T = cfg.combat.teach;
      this.isStrike = true;
      const hand = () => ({ hist: [], last: -Infinity, setAt: -Infinity, stillSince: null, prev: null, live: false, calm: null, calmAt: -Infinity });
      this.hands = { left: hand(), right: hand() };
      this.guardAcc = { left: null, right: null };
    }
    // arm length (m) for shapes: the reference 0.6 m arm times armScale
    armL(out) { return 0.6 * (out.armScale || 1); }
    // the player's samples: the nearest one per role for this hand (own, or the other hand mirrored)
    match(ctx, hand, path, out, early) {
      const lib = libOf(ctx);
      if (!lib) return null;
      const T = this.T, live = strikeShape(path, this.armL(out), T.points, T.angleW, early ? 0 : T.backFrac);
      if (!live) return null;
      const other = hand === 'left' ? 'right' : 'left';
      const best = { role: null, d: Infinity, roleD: {} };
      for (const role of ['straight', 'hook', 'uppercut']) {
        const own = (lib[hand] && lib[hand][role]) || [], mir = (lib[other] && lib[other][role]) || [];
        const cands = (own.length ? own.map((tp) => [tp, false, 1]) : mir.map((tp) => [tp, true, T.mirrorK])).map(([tp, mirror, k]) => [early ? tp.out : tp, mirror, k]).filter(([tp]) => tp);
        for (const [tp, mirror, k] of cands) {
          const ratio = live.len / tp.len;
          if (ratio < T.lenRatio[0] || ratio > T.lenRatio[1]) continue;
          const d = shapeDist(live, tp, mirror) * k;
          if (d < (best.roleD[role] ?? Infinity)) best.roleD[role] = d;
          if (d < best.d) { best.d = d; best.role = role; }
        }
      }
      return best;
    }
    taught(ctx, role) {
      const lib = libOf(ctx);
      return !!lib && ['left', 'right'].some((hd) => lib[hd] && lib[hd][role] && lib[hd][role].length);
    }
    // teaching: any move out from rest by the asked-for hand is a sample of the asked-for punch
    teachTick(ctx, hand, h, s, c, out) {
      const T = this.T, t = ctx.t;
      if (!h.live) {
        if (h.calm && t - h.calmAt <= T.calmMs && s.v >= T.startSpeed && t - h.last >= c.refractoryMs) { h.live = true; h.from = h.calm.t; h.set = h.calm; }
        return;
      }
      const back = t - h.from > T.minMs && s.v < c.stillSpeed && Math.hypot(s.x - h.set.x, s.y - h.set.y, s.z - h.set.z) <= T.backM;
      if (!back && t - h.from <= T.maxMs) return;
      h.live = false;
      const path = h.hist.filter((x) => x.t >= h.from);
      const peakV = Math.max(0, ...path.map((x) => x.v));
      const shape = peakV >= T.minSpeed ? strikeShape(path, this.armL(out), T.points, T.angleW, T.backFrac) : null;
      if (!shape || shape.far * this.armL(out) < c.setTravel) return;
      const role = ctx.teach.role;
      const lib = libFor(ctx);
      const list = ((lib[hand] = lib[hand] || {})[role] = lib[hand][role] || []);
      list.push(Object.assign(shape, { speed: peakV, out: strikeShape(path, this.armL(out), T.points, T.angleW, 0) }));
      while (list.length > T.keep) list.shift();
      h.last = t;
      out.events.push(['strike_taught', { hand, role, n: list.length, speed: peakV }]);
    }
    update(ctx, out) {
      const t = ctx.t;
      const arms = out.arms;
      if (!arms) return;
      const sw = arms.unitM;
      const c = scaled(this.c, out.armScale || 1);
      // the whole body moving sideways (a bound) shifts the arms in the picture without a punch
      // (0.12.2): no punch starts while the hips move fast sideways, or just after
      const hm = ctx.sig && ctx.sig.body && ctx.sig.body.hMid;
      if (hm) {
        if (this.hipPrev && t > this.hipPrev.t && Math.abs(hm.x - this.hipPrev.x) / ((t - this.hipPrev.t) / 1000) > this.c.hipSpeed) this.hipQuiet = t + this.c.hipQuietMs;
        this.hipPrev = { t, x: hm.x };
      }
      const bodyMoving = t < (this.hipQuiet || 0);
      for (const hand of ['left', 'right']) {
        const h = this.hands[hand];
        const a = arms[hand];
        const p = a.wrist;
        const q = arms.torso[hand];
        // camera frame (x from the body's middle, y and z from its own shoulder) and torso frame (tx, tz)
        const s = { t, angle: a.angle, x: p.x * sw, y: (p.y - a.shoulder.y) * sw, z: (p.z - a.shoulder.z) * sw, tx: q.wrist.x * sw, tz: (q.wrist.z - q.shoulder.z) * sw, ey: (a.elbow.y - a.shoulder.y) * sw };
        s.v = h.prev && t > h.prev.t ? Math.hypot(s.x - h.prev.x, s.y - h.prev.y, s.z - h.prev.z) / ((t - h.prev.t) / 1000) : 0;
        h.prev = s;
        h.hist.push(s);
        while (h.hist.length && t - h.hist[0].t > c.windowMs) h.hist.shift();
        if (ctx.upperLow) { h.stillSince = null; h.live = false; continue; }
        if (bodyMoving && !(ctx.teach && ctx.teach.role)) { h.live = false; h.setAt = -Infinity; h.stillSince = null; continue; }
        if (s.v < c.stillSpeed) { h.calm = s; h.calmAt = t; }
        // teaching (0.10.0): the guard's resting place, or this hand's sample of a punch
        if (ctx.teach && ctx.teach.guard && s.v < c.stillSpeed) {
          const g = (this.guardAcc[hand] = this.guardAcc[hand] || { x: 0, y: 0, z: 0, n: 0 });
          g.x += s.x; g.y += s.y; g.z += s.z; g.n++;
        }
        if (ctx.teach && ctx.teach.role && ctx.teach.hand === hand) { this.teachTick(ctx, hand, h, s, c, out); continue; }
        // a set hand: a guard (fist up in front, elbow down and bent) held still, or the player's
        // own guard (learned in the gym, 0.10.0); after a punch, coming back to where it was set
        // is enough (combos: a double jab rests about 50 ms)
        const gp = ctx.cal && ctx.cal.guardPos && ctx.cal.guardPos[hand];
        const set = (s.y >= -c.setBelow && Math.abs(s.x) <= c.setWide && s.angle <= c.setAngle && s.ey <= -c.elbowDown) || (!!gp && Math.hypot(s.x - gp.x, s.y - gp.y, s.z - gp.z) <= this.T.guardTol);
        const back = h.after && !h.live && t - h.last >= c.refractoryMs && Math.hypot(s.x - h.after.x, s.y - h.after.y, s.z - h.after.z) <= c.setReturn && s.v < 2 * c.stillSpeed;
        if (set && back) { h.setAt = t; h.set = s; h.after = null; h.stillSince = null; continue; }
        if (set && s.v < c.stillSpeed) {
          if (h.stillSince === null) h.stillSince = t;
          if (t - h.stillSince >= c.setMs) {
            // back at the guard: a move that never qualified can still be a straight (the guess)
            if (h.live) this.finish(ctx, hand, h, out, c, true);
            h.setAt = t; h.set = s; h.live = false;
          }
          continue;
        }
        h.stillSince = null;
        if (t - h.last < c.refractoryMs) continue;
        if (!h.live) {
          // a move begins: out from where the hand was set, soon after
          if (t - h.setAt > c.setWithinMs) continue;
          if (Math.hypot(s.x - h.set.x, s.y - h.set.y, s.z - h.set.z) < c.setTravel) continue;
          h.live = true; h.from = h.setAt;
        }
        // the hands dropped (to the sides, or to start waving): not a punch
        if (s.y < -c.upperLowest) { h.live = false; h.setAt = -Infinity; continue; }
        // judge each kind as its shape completes and the fist slows down; give up after windowMs
        if (t - h.from > c.windowMs) { this.finish(ctx, hand, h, out, c, true); continue; }
        const path = h.hist.filter((x) => x.t >= h.from);
        const peakV = Math.max(...path.map((x) => x.v));
        // with taught samples a punch is judged whole, once the fist is on its way back (0.10.0);
        // the rules alone judge each kind as its shape completes and the fist slows
        if (libOf(ctx)) {
          if (backAt([h.set, ...path], this.T.backFrac, c.setTravel) > 0) this.finish(ctx, hand, h, out, c, false);
          else if (peakV >= c.minSpeed && s.v <= c.stopFrac * peakV) this.finish(ctx, hand, h, out, c, false, true); // early, if it is plainly one punch
        }
        else if (peakV >= c.minSpeed && s.v <= c.stopFrac * peakV) this.finish(ctx, hand, h, out, c, false);
      }
    }
    // judge the move so far; guess: also call anything else thrown at the camera a straight
    finish(ctx, hand, h, out, c, guess, early) {
      const path = h.hist.filter((x) => x.t >= h.from);
      const peakV = Math.max(0, ...path.map((x) => x.v));
      let type = peakV >= c.minSpeed ? this.classify(ctx, hand, [h.set, ...path], out, c, guess) : null;
      // the player's own samples come first; the rules read what was never taught, and a taught
      // punch the rules see still counts when it is not far from the player's samples
      const T = this.T, m = peakV >= Math.min(c.minSpeed, T.minSpeed) ? this.match(ctx, hand, [h.set, ...path], out, early) : null;
      // early (the fist has slowed at full reach): only a plain match, well clear of every other punch
      if (early) {
        const others = m ? Object.entries(m.roleD).filter(([r]) => r !== m.role).map(([, d]) => d) : [];
        if (!(m && m.d <= T.earlyTol && others.every((d) => d >= T.earlyGap * m.d))) return;
      }
      if (m && m.d <= T.tol) {
        const lead = out.stance === 'southpaw' ? 'right' : 'left';
        type = m.role === 'straight' ? (hand === lead ? 'jab' : 'cross') : m.role;
      } else if (type && ROLE[type] && this.taught(ctx, ROLE[type]) && !((m && m.roleD[ROLE[type]]) <= T.tol * T.fallbackK)) type = null;
      if (!type) { if (guess) h.live = false; return; }
      h.live = false;
      h.last = ctx.t;
      h.after = h.set; // where it was set: coming back there re-arms it
      h.setAt = -Infinity;
      // 0.8.0 (Mark): a hook from the rear hand is the overhand
      if (type === 'hook' && this.c.overhand && hand === (out.stance === 'southpaw' ? 'left' : 'right')) type = 'overhand';
      out.events.push(['strike', { hand, type, power: RE.clamp(peakV / this.c.refSpeed, 0.5, 1.5), speed: peakV }]);
    }

    classify(ctx, hand, path, out, c, guess) {
      const s0 = path[0], end = path[path.length - 1];
      const lowStance = (ctx.sig.levelDrop != null ? ctx.sig.levelDrop : ctx.sig.hipDrop) >= c.downDrop;
      const maxZ = Math.max(...path.map((x) => x.z));
      if (lowStance && end.y <= -c.downBelow && s0.y - end.y >= c.downTravel) return 'down';
      // it has to go toward the opponent: waving and raising the hands stay beside the body
      if (maxZ < c.frontMin) return null;
      const lead = out.stance === 'southpaw' ? 'right' : 'left';
      const straight = hand === lead ? 'jab' : 'cross';
      // an uppercut dips, then rises from its lowest point, mostly upward, ending up by the chin
      let bestRise = 0, upEnd = null;
      for (let i = 1; i < path.length; i++) {
        let low = path[0];
        for (let k = 0; k < i; k++) if (path[k].y < low.y) low = path[k];
        const x = path[i], rise = x.y - low.y, across = Math.hypot(x.x - low.x, x.z - low.z);
        const dip = path[0].y - low.y >= c.upperDip && low.y >= -c.upperLowest && low.angle <= c.straightOn + 10; // a bent-arm dip, not a hanging arm
        if (rise > bestRise && rise >= c.upperShare * across && x.y >= -c.upperTo && dip) { bestRise = rise; upEnd = x; }
      }
      if (bestRise >= c.upperRise && upEnd.angle <= c.hookAngle) return 'uppercut';
      // a straight: the elbow opened up with the fist going at the camera
      const ext = path.reduce((m, x) => (x.angle > m.angle ? x : m), s0);
      if (ext.angle >= c.straightOn && ext.z - s0.z >= c.fwdGain && (ext.y >= -c.straightBelow || guess)) return straight; // a low one waits: it may be an uppercut's dip
      // a hook sweeps inward (the player's right for the left hand) from its outermost point
      const inward = hand === 'left' ? 1 : -1;
      let sweep = 0, outmost = path[0];
      // (wound out at hook height with the elbow bent: a dropped arm swinging back up is not a hook)
      const atHeight = (x) => Math.abs(x.y) <= c.hookHeight && x.angle <= c.hookAngle;
      for (const x of path) {
        if (atHeight(x) && inward * x.tx < inward * outmost.tx) outmost = x;
        const d = inward * (x.tx - outmost.tx);
        if (d > sweep && atHeight(x) && x.tz >= c.hookFront) sweep = d;
      }
      if (sweep >= c.hookTravel) return 'hook';
      // anything else thrown at the camera: call it a straight, once the hand is back
      if (guess && maxZ - s0.z >= c.fwdGuess) return straight;
      return null;
    }
  }
  // strike thresholds in meters and m/s, scaled by armScale (shorter arms,
  // smaller thresholds); angles and times stay as they are
  const METERS = ['setBelow', 'setWide', 'setReturn', 'elbowDown', 'stillSpeed', 'setTravel', 'minSpeed', 'frontMin', 'fwdGain', 'straightBelow', 'fwdGuess', 'upperRise', 'upperDip', 'upperLowest', 'upperTo', 'hookTravel', 'hookHeight', 'hookFront', 'downBelow', 'downTravel', 'downSpeed'];
  const scaledCache = new Map();
  function scaled(c, k) {
    if (k === 1) return c;
    const key = Math.round(k * 100);
    let s = scaledCache.get(key);
    if (!s || s.base !== c) {
      s = Object.assign({}, c, { base: c });
      for (const m of METERS) if (m !== 'reach' && typeof c[m] === 'number') s[m] = c[m] * (key / 100);
      scaledCache.set(key, s);
    }
    return s;
  }
  // arm length in meters (pose positions are in shoulder widths of unitM meters)
  const armLen = (a, unitM) => (len(sub(a.elbow, a.shoulder)) + len(sub(a.wrist, a.elbow))) * unitM;

  // Slip: head off the center line, nose against the hip midpoint (2D body
  // units), through a deadzone to -1..1; fires 'slip' at slip.eventLevel.
  class SlipDetector {
    constructor(cfg) { this.c = cfg.combat.slip; this.armed = { left: true, right: true }; }
    update(ctx, out) {
      const b = ctx.sig.body;
      let slip = 0;
      if (!ctx.upperLow) {
        const off = b.nose.x - b.hMid.x;
        const k = (Math.abs(off) - this.c.deadzone) / (this.c.full - this.c.deadzone);
        if (k > 0) slip = Math.sign(off) * Math.min(k, 1);
      }
      out.slip = slip;
      for (const side of ['left', 'right']) {
        const level = side === 'left' ? -slip : slip;
        if (this.armed[side] && level >= this.c.eventLevel) { this.armed[side] = false; out.events.push(['slip', { side }]); }
        else if (!this.armed[side] && level < this.c.eventReset) this.armed[side] = true;
      }
    }
  }

  // Head movement (0.13.0, Mark: "like Fight Night Champion: the head moves in an arc; left and
  // right are slips, straight down is a duck, a U is a weave. While weaving it is a level change
  // and you can jump at any time for a double"). The head is the nose across from the hip
  // midpoint (S, + the player's right, as the slip reads it) and the shoulders' drop below
  // standing (T; the hips when the shoulders are hidden). out.head { x, y } every frame.
  //   zones    side: |x| at least weave.side and y under weave.low; low: y at least weave.low
  //   'weave'  from one side, down through low (within legMs of leaving that side), up to the
  //            other side (within legMs of the bottom), all within maxMs: { from, to, depth (T,
  //            the lowest point), width (S, side to side), ms }
  //   out.weaving  from the dip out of a side until holdMs after the other side is reached:
  //            the fight machine counts it as a level change (a jump in it is the shot)
  class WeaveDetector {
    constructor(cfg) { this.c = cfg.combat.weave; this.side = null; this.dip = null; this.until = -Infinity; }
    update(ctx, out) {
      const t = ctx.t, c = this.c, sig = ctx.sig, b = sig.body;
      out.weaving = t < this.until;
      if (ctx.upperLow || !b) { out.head = null; this.dip = null; return; }
      const x = b.nose.x - b.hMid.x;
      const y = sig.shoulderDrop != null && sig.upperSeen ? sig.shoulderDrop : sig.levelDrop != null ? sig.levelDrop : 0;
      out.head = { x, y };
      const low = y >= c.low, at = !low && Math.abs(x) >= c.side ? (x < 0 ? 'left' : 'right') : null;
      if (at) {
        const d = this.dip;
        // reaching the other side out of a dip: the weave
        if (d && at !== d.from && t - d.bottomAt <= c.legMs && t - d.fromAt <= c.maxMs) {
          out.events.push(['weave', { from: d.from, to: at, depth: d.depth, width: Math.abs(x - d.fromX), ms: Math.round(t - d.fromAt) }]);
          this.until = t + c.holdMs;
          out.weaving = true;
        }
        this.dip = null;
        this.side = { at, t, x };
      } else if (low) {
        if (!this.dip && this.side && t - this.side.t <= c.legMs) this.dip = { from: this.side.at, fromAt: this.side.t, fromX: this.side.x, depth: y, bottomAt: t };
        if (this.dip) {
          if (y > this.dip.depth) this.dip.depth = y;
          this.dip.bottomAt = t;
          this.until = Math.max(this.until, t + c.holdMs);
          out.weaving = true;
        }
      } else if (this.dip && t - this.dip.bottomAt > c.legMs) this.dip = null;
    }
  }

  // Level changes, from sig.levelDrop (the hips, or the shoulders when the
  // hips are hidden; knees are not needed, a squat in knees-up framing pushes
  // them out of the frame):
  //   'squat'     the level drops past level.squat (payload: how fast), re-armed
  //               above level.reset
  //   'drive_up'  from a squat, the level comes back up by level.rise within
  //               level.driveMs, however long the squat was held (payload:
  //               rise speed in T/s); once per squat
  //   'jump'      the level rises level.jump above standing (a hop off the
  //               floor), re-armed back near standing
  // out.levelLow says the squat is being held.
  class LevelDetector {
    constructor(cfg) { this.c = cfg.combat.level; this.armed = true; this.hist = []; this.win = []; this.lowAt = -Infinity; this.driven = true; this.jumpArmed = true; }
    update(ctx, out) {
      const t = ctx.t;
      const drop = ctx.sig.levelDrop;
      out.levelLow = false;
      if (drop == null) return;
      const c = this.c;
      this.hist.push({ t, drop });
      while (this.hist.length && t - this.hist[0].t > c.speedMs) this.hist.shift();
      this.win.push({ t, drop });
      while (this.win.length && t - this.win[0].t > c.driveMs) this.win.shift();
      if (this.armed && drop >= c.squat) {
        this.armed = false;
        this.driven = false;
        const start = this.hist[0];
        const speed = (drop - start.drop) / Math.max(0.05, (t - start.t) / 1000);
        out.events.push(['squat', { depth: ctx.sig.squatDepth, speed }]);
      }
      if (drop >= c.squat * c.holdFrac) this.lowAt = t;
      out.levelLow = !this.armed && drop >= c.squat * c.holdFrac;
      // the drive: the deepest point in the last driveMs against now, allowed
      // until driveMs after the level left the squat
      if (!this.driven && t - this.lowAt <= c.driveMs) {
        let top = this.win[0];
        for (const s of this.win) if (s.drop > top.drop) top = s;
        if (top.drop - drop >= c.rise) {
          this.driven = true;
          // speed over the rise itself: from the last moment still at the bottom
          // (within 0.03 T of it), not from the start of a held squat
          let from = top;
          for (const s of this.win) if (s.t >= top.t && s.drop >= top.drop - 0.03) from = s;
          out.events.push(['drive_up', { depth: top.drop, speed: (from.drop - drop) / Math.max(0.05, (t - from.t) / 1000) }]);
        }
      }
      if (!this.armed && drop < c.reset) this.armed = true;
      if (this.jumpArmed && drop <= -c.jump) { this.jumpArmed = false; out.events.push(['jump', { height: -drop }]); }
      else if (!this.jumpArmed && drop > -c.jump * 0.4) this.jumpArmed = true;
    }
  }

  // Bound (0.8.0, Mark: a bound out and back, after Homecoming Hero, makes an
  // angle like Dillashaw or Cruz). The hip midpoint, against where it was at
  // calibration (body x, S): from near the middle (bound.center) it gets
  // bound.out to one side within bound.outMs, then comes back near the middle
  // (bound.back) within bound.backMs of its furthest point: 'bound' with the
  // side it went to (the player's own left or right), how far (S) and how
  // long the whole move took (ms).
  class BoundDetector {
    constructor(cfg) { this.c = cfg.combat.bound; this.hist = []; this.peak = null; }
    update(ctx, out) {
      const t = ctx.t, c = this.c;
      if (!ctx.sig.hipsSeen && !ctx.sig.upperSeen) { this.peak = null; return; }
      const x = ctx.sig.hipsSeen ? ctx.sig.body.hMid.x : ctx.sig.body.sMid.x;
      this.hist.push({ t, x });
      while (this.hist.length && t - this.hist[0].t > c.outMs) this.hist.shift();
      if (!this.peak && Math.abs(x) >= c.out) {
        // left the middle quickly: the bound is on
        const start = this.hist.find((s) => Math.abs(s.x) <= c.center && Math.sign(s.x || x) !== -Math.sign(x));
        if (start) this.peak = { t, x, from: start.t };
      } else if (this.peak) {
        if (Math.sign(x) === Math.sign(this.peak.x) && Math.abs(x) > Math.abs(this.peak.x)) { this.peak.t = t; this.peak.x = x; }
        if (Math.abs(x) <= c.back) {
          out.events.push(['bound', { side: this.peak.x > 0 ? 'right' : 'left', dist: Math.abs(this.peak.x), ms: t - this.peak.from }]);
          this.peak = null;
        } else if (t - this.peak.t > c.backMs) this.peak = null; // stepped over and stayed: not a bound
      }
    }
  }

  // Arm depth (0.6.0, after the first camera fights: hooks and uppercuts
  // landed, straights did not). MediaPipe's world landmarks judge depth
  // poorly, and a straight goes right at the camera, so its world depth comes
  // out squashed: the arm reads short and bent. The image shows the same punch
  // as foreshortening, the arm looking shorter on screen than it is. fix()
  // gives the elbow and wrist back the depth that foreshortening implies,
  // against each segment's reference length (the longest it has looked lately,
  // in meters at the body's scale, decaying slowly), toward the camera. World
  // depth wins when it already says more, or says the segment points back.
  class ArmDepth {
    constructor(cfg) { this.c = cfg.combat.depth; this.ref = {}; this.t = null; }
    // the player's arm length (shoulder to wrist, the longer arm's references)
    // over a reference 0.6 m arm, for scaling strike thresholds down for
    // shorter arms (the references read a few percent long, and long arms
    // already clear the standard thresholds, so it never scales up)
    armScale() {
      const r = this.ref;
      const arm = r.lu == null || r.ru == null ? 0 : Math.max(r.lu + r.lf, r.ru + r.rf);
      return arm >= 0.3 ? RE.clamp(arm / 0.6, 0.75, 1) : 1; // no reference yet: unscaled
    }
    // side: a side camera's arms for this moment ({ left, right } reach in T, from SideView), or null
    fix(ctx, frame, side) {
      const world = ctx.world, pts = ctx.points, c = this.c;
      const dt = this.t == null ? 0 : Math.max(0, (ctx.t - this.t) / 1000);
      this.t = ctx.t;
      if (!pts) return world;
      const ipx = RE.dist(RE.mid(pts[L.L_SHOULDER], pts[L.R_SHOULDER]), RE.mid(pts[L.L_HIP], pts[L.R_HIP]));
      const wm = len(sub(RE.mid3(world[L.L_SHOULDER], world[L.R_SHOULDER]), RE.mid3(world[L.L_HIP], world[L.R_HIP])));
      if (!(ipx > 0) || !(wm > 0)) return world;
      const k = wm / ipx; // meters per pixel at the body
      // perspective: a fist nearer the camera looks bigger, which hides part
      // of its foreshortening. With the camera's focal length (from fovDeg on
      // the long side) the body's distance is D = f * k, and a point d meters
      // nearer than the body maps back to the body's scale by (D - d) / D.
      const f = Math.max(ctx.w, ctx.h) / 2 / Math.tan((c.fovDeg * Math.PI) / 360);
      const D = f * k, cx = ctx.w / 2, cy = ctx.h / 2;
      const at = (p, d) => { const m = Math.max(0.2, (D - d) / D); return { x: cx + (p.x - cx) * m, y: cy + (p.y - cy) * m }; };
      const out = world.slice();
      const move = (p, d) => Object.assign({}, p, { x: p.x + frame.fwd.x * d, y: p.y + frame.fwd.y * d, z: p.z + frame.fwd.z * d });
      const sd = side;
      this.usedSide = false;
      for (const [S, E, W, side] of [[L.L_SHOULDER, L.L_ELBOW, L.L_WRIST, 'l'], [L.R_SHOULDER, L.R_ELBOW, L.R_WRIST, 'r']]) {
        const zE = dot(sub(world[E], world[S]), frame.fwd), zF = dot(sub(world[W], world[E]), frame.fwd);
        const l3u = len(sub(world[E], world[S])), l3f = len(sub(world[W], world[E]));
        // two passes: depths from the image lengths, then the image lengths again
        // with each point scaled back by its own depth
        let dE = Math.max(0, zE), dW = dE + Math.max(0, zF), du = 0, df = 0, lu = 0, lf = 0;
        for (let pass = 0; pass < 2; pass++) {
          const s0 = at(pts[S], 0), e0 = at(pts[E], dE), w0 = at(pts[W], dW);
          lu = RE.dist(s0, e0) * k; lf = RE.dist(e0, w0) * k;
          const refU = Math.max(this.ref[side + 'u'] == null ? 0 : this.ref[side + 'u'] - c.decay * dt, pass ? 0 : Math.max(lu, l3u));
          const refF = Math.max(this.ref[side + 'f'] == null ? 0 : this.ref[side + 'f'] - c.decay * dt, pass ? 0 : Math.max(lf, l3f));
          const ru = RE.clamp(refU, c.minLen, c.maxLen), rf = RE.clamp(refF, c.minLen, c.maxLen);
          du = Math.sqrt(Math.max(0, ru * ru - (lu / c.inPlane) ** 2));
          df = Math.sqrt(Math.max(0, rf * rf - (lf / c.inPlane) ** 2));
          if (!pass) { this.ref[side + 'u'] = ru; this.ref[side + 'f'] = rf; }
          const nE = zE > -c.behind && du > zE ? du : zE;
          const nF = zF > -c.behind && df > zF ? df : zF;
          dE = Math.max(0, nE); dW = dE + Math.max(0, nF);
        }
        const sa = sd && sd[side === 'l' ? 'left' : 'right'];
        if (sa && sa.ok) {
          // the side camera saw how far in front of the shoulder midpoint the elbow and fist are,
          // in torso lengths; less this shoulder's own offset from the midpoint (this camera
          // reads the torso well), it is the depth from this shoulder
          const off = dot(sub(world[S], RE.mid3(world[L.L_SHOULDER], world[L.R_SHOULDER])), frame.fwd);
          out[E] = move(world[E], sa.e * wm - off - zE);
          out[W] = move(world[W], sa.w * wm - off - zE - zF);
          this.usedSide = true;
          continue;
        }
        const nE = zE > -c.behind && du > zE ? du : zE;
        const nF = zF > -c.behind && df > zF ? df : zF;
        out[E] = move(world[E], nE - zE);
        out[W] = move(world[W], nE - zE + nF - zF);
      }
      return out;
    }
  }

  // The arm pose for this frame, shared by the strike and stance detectors.
  // With a side camera (0.12.0) the arms come from the main frame taken at the same moment as the
  // newest side frame (within alignMs), so the two agree on a fast punch; the arms run that much
  // behind (the link's delay, a frame or two).
  class ArmPose {
    constructor(cfg) { this.depth = new ArmDepth(cfg); this.hist = []; this.alignMs = cfg.side.alignMs; }
    update(ctx0, out) {
      out.arms = null;
      let ctx = ctx0, side = null;
      const sv = ctx0.sideView;
      if (sv && ctx0.sideOn && ctx0.world && ctx0.points) {
        this.hist.push({ t: ctx0.t, world: ctx0.world, points: ctx0.points });
        while (this.hist.length && ctx0.t - this.hist[0].t > 500) this.hist.shift();
        const s = sv.newest(ctx0.t);
        let best = null;
        if (s) for (const h of this.hist) if (!best || Math.abs(h.t - s.t) < Math.abs(best.t - s.t)) best = h;
        if (best && Math.abs(best.t - s.t) <= this.alignMs) {
          ctx = Object.assign({}, ctx0, { t: best.t, world: best.world, points: best.points });
          const p = best.points, ipx = RE.dist(RE.mid(p[L.L_SHOULDER], p[L.R_SHOULDER]), RE.mid(p[L.L_HIP], p[L.R_HIP])) || 1;
          side = sv.match(s, { left: (p[L.L_SHOULDER].y - p[L.L_WRIST].y) / ipx, right: (p[L.R_SHOULDER].y - p[L.R_WRIST].y) / ipx });
        }
      } else this.hist.length = 0;
      const frame = frameOf(ctx);
      const world = frame && ctx.world ? this.depth.fix(ctx, frame, side) : ctx.world;
      out.armScale = this.depth.armScale();
      out.sideUsed = !!this.depth.usedSide;
      const pose = RE.armPose(world, frame, ctx.cal.shoulderWidthW);
      if (!pose) return;
      pose.unitM = ctx.cal.shoulderWidthW || len(sub(ctx.world[L.R_SHOULDER], ctx.world[L.L_SHOULDER])) || 0.4;
      // the same arms in the torso's own frame (turns with the shoulders): hooks
      // sweep around the body, so a bladed stance must not tilt them toward the camera
      pose.torso = RE.armPose(world, RE.bodyFrame(world, ctx.cal.up) || frame, ctx.cal.shoulderWidthW);
      out.arms = pose;
    }
  }

  // run after the locomotion detectors (stance reads the turn detector's yaw)
  // Kicks and knees (0.11.0, Mark 10/22: a lead teep and a Dutch-style rear low kick; the knee
  // was the plan's counter to a shot). Knees-up framing often hides the feet, so a kick is read
  // from the thigh and the knee: one leg comes up while the other stays planted (no step from the
  // other leg within plantMs either side, so marching and high knees never kick), judged as it
  // comes back down:
  //   'low_kick'  the rear leg, its knee sweeping sweep (S) or more toward the lead side
  //   'teep'      the lead leg, the thigh up past teepPitch (degrees)
  //   'knee'      the rear leg straight up past kneePitch, without the sweep
  // Payload { leg, pitch (degrees, peak thigh angle), sweep (S), ms, power (rise speed over
  // refRate, 0.5 to 1.5) }. Thigh pitch comes from the world landmarks; without them the knee's
  // rise in the image (T) stands in (liftPerDeg).
  class KickDetector {
    constructor(cfg) { this.c = cfg.combat.kick; this.legs = { left: { up: null, lastUp: -Infinity, lastDown: -Infinity }, right: { up: null, lastUp: -Infinity, lastDown: -Infinity } }; }
    update(ctx, out) {
      const t = ctx.t, c = this.c, sig = ctx.sig, b = sig.body;
      if (!b) return;
      const lead = out.stance === 'southpaw' ? 'right' : 'left';
      for (const leg of ['left', 'right']) {
        const L = this.legs[leg], other = this.legs[leg === 'left' ? 'right' : 'left'];
        const k = leg === 'left' ? 'L' : 'R';
        let pitch = sig['pitch' + k];
        if (pitch == null) { const lift = sig['kneeLift' + k]; pitch = lift == null ? null : lift / c.liftPerDeg; }
        if (pitch == null) { L.up = null; continue; }
        const knee = leg === 'left' ? b.lk : b.rk;
        if (!L.up) {
          if (pitch >= c.onPitch) { L.up = { t0: t, x0: knee.x, peak: pitch, sweep: 0, rise: 0, prevT: t, prevP: pitch }; L.lastUp = t; }
          continue;
        }
        const u = L.up;
        u.peak = Math.max(u.peak, pitch);
        if (t > u.prevT) u.rise = Math.max(u.rise, (pitch - u.prevP) / ((t - u.prevT) / 1000));
        u.prevT = t; u.prevP = pitch;
        // toward the lead side: the player's left is -x in body units for an orthodox stance
        const toLead = lead === 'left' ? -1 : 1;
        u.sweep = Math.max(u.sweep, toLead * (knee.x - u.x0));
        if (pitch > Math.max(c.offPitch, c.downFrac * u.peak) && t - u.t0 < c.maxMs) continue;
        // back down: judge it
        L.up = null; L.lastDown = t; L.downing = true;
        const ms = t - u.t0;
        if (ms >= c.maxMs) continue;
        // a step from the other leg just before or during: marching, not a kick
        if (other.up || other.lastUp > u.t0 - c.plantMs || other.lastDown > u.t0 - c.plantMs) continue;
        let kind = null;
        if (leg !== lead && u.sweep >= c.sweep && u.peak >= c.lowPitch) kind = 'low_kick';
        else if (leg === lead && u.peak >= c.teepPitch) kind = 'teep';
        else if (leg !== lead && u.peak >= c.kneePitch) kind = 'knee';
        if (!kind) continue;
        // and the other leg has to stay planted a moment after (not the first step of a march)
        L.pending = { kind, at: t, payload: { leg, pitch: u.peak, sweep: u.sweep, ms, power: RE.clamp(u.rise / c.refRate, 0.5, 1.5) } };
      }
      for (const leg of ['left', 'right']) {
        const L = this.legs[leg], other = this.legs[leg === 'left' ? 'right' : 'left'];
        if (!L.pending) continue;
        if (other.up || other.lastUp > L.pending.at) { L.pending = null; continue; }
        if (t - L.pending.at >= c.afterMs) { out.events.push([L.pending.kind, L.pending.payload]); L.pending = null; }
      }
    }
  }

  RE.makeCombatDetectors = (cfg) => [new ArmPose(cfg), new GuardDetector(cfg), new StanceDetector(cfg), new StrikeDetector(cfg), new SlipDetector(cfg), new LevelDetector(cfg), new BoundDetector(cfg), new KickDetector(cfg), new WeaveDetector(cfg)];

  // Fight state machine (spec update_combat; reworked in 0.5.0 after Mark's
  // camera test). Runs only in combat mode. target, from enter_combat, all
  // optional: {bearing(), open(), shooting(), shot({power, speed, jumped})}.
  //   standing  holding a squat (or squatting) while the target shoots:
  //             'sprawl', once per shot. A drive up out of a squat while the
  //             target is open: 'shot' and the drive phase
  //   drive     waits up to fight.jumpWaitMs for a 'jump' off the drive, then
  //             resolves the shot. power = rise speed / fight.refRise (clamped)
  //             plus fight.jumpBonus for a jump. target.shot(...) decides:
  //             {takedown: false} is 'stuffed'; {takedown: true, topMs} (or no
  //             shot callback) is 'takedown' and top for topMs, by default
  //             fight.gnpMs scaled by power
  //             With fight.requireJump (0.7.0) the drive is silent: only a jump
  //             inside requireJumpWaitMs is the 'shot' (resolved at once); no
  //             jump is a 'level_change' and back to standing
  //   top       a timed ground and pound burst: strikes become 'down_strike';
  //             when the time is up, 'scramble' and back to standing
  // Anywhere: running (high knees) for escapeMs: 'escape' (the engine then
  // leaves combat mode).
  class Combat {
    constructor(cfg) { this.c = cfg.combat.fight; this.reset(); }
    reset() { this.phase = 'standing'; this.drive = null; this.topUntil = 0; this.runSince = null; this.target = null; this.sprawled = false; this.weaveUntil = -Infinity; }
    enter(target) { this.reset(); this.target = target || null; }
    gnpMs(power) {
      const [lo, hi] = this.c.gnpMs;
      return Math.round(lo + (hi - lo) * RE.clamp((power - 0.5) / 1.0, 0, 1));
    }
    resolve(t) {
      const d = this.drive;
      this.drive = null;
      const power = RE.clamp(d.speed / this.c.refRise, 0.3, 1.2) + (d.jumped ? this.c.jumpBonus : 0);
      const info = { power, speed: d.speed, jumped: d.jumped };
      const tg = this.target || {};
      const r = (tg.shot && tg.shot(info)) || { takedown: true };
      if (!r.takedown) { this.phase = 'standing'; return [['stuffed', info]]; }
      const topMs = r.topMs || this.gnpMs(power);
      this.phase = 'top';
      this.topUntil = t + topMs;
      return [['takedown', Object.assign(info, { topMs })]];
    }
    // returns events to emit: [[name, payload]]
    onEvent(name, payload, t) {
      const out = [];
      const tg = this.target || {};
      if (name === 'squat' && this.phase === 'standing') {
        if (tg.shooting && tg.shooting() && !this.sprawled) { this.sprawled = true; out.push(['sprawl', payload]); }
      } else if (name === 'drive_up' && this.phase === 'standing') {
        if (!(tg.shooting && tg.shooting()) && (!tg.open || tg.open())) {
          this.phase = 'drive';
          this.drive = { t, speed: payload.speed || 0, jumped: false };
          if (!this.c.requireJump) out.push(['shot', { speed: payload.speed || 0 }]);
        }
      } else if (name === 'jump' && this.phase === 'standing' && t <= this.weaveUntil && !(tg.shooting && tg.shooting()) && (!tg.open || tg.open())) {
        // 0.13.0: out of a weave (a level change in motion) a jump is the double, at full drive
        this.drive = { t, speed: this.c.refRise, jumped: true, weave: true };
        out.push(['shot', { speed: this.c.refRise, weave: true }]);
        out.push(...this.resolve(t));
      } else if (name === 'jump' && this.phase === 'drive') {
        this.drive.jumped = true;
        if (this.c.requireJump) out.push(['shot', { speed: this.drive.speed }]);
        out.push(...this.resolve(t));
      } else if (name === 'weave') {
        // a finished weave keeps the jump window open a little past its end (touch weaves too)
        this.weaveUntil = Math.max(this.weaveUntil, t + this.c.weaveJumpMs + 400);
      } else if (name === 'strike' && this.phase === 'top') {
        out.push(['down_strike', { hand: payload.hand, power: payload.power }]);
      } else if (name === 'run_start') {
        this.runSince = t;
      } else if (name === 'run_end') {
        this.runSince = null;
      }
      return out;
    }
    // sig: the engine snapshot (level_low: a squat being held)
    update(t, sig) {
      this.lastT = t;
      const out = [];
      const tg = this.target || {};
      const shooting = !!(tg.shooting && tg.shooting());
      if (sig.weaving) this.weaveUntil = t + this.c.weaveJumpMs;
      if (!shooting) this.sprawled = false;
      else if (this.phase === 'standing' && sig.level_low && !this.sprawled) { this.sprawled = true; out.push(['sprawl', { held: true }]); }
      if (this.phase === 'drive' && this.c.requireJump && t - this.drive.t >= this.c.requireJumpWaitMs) {
        // a level change and back up, no jump: not a shot
        out.push(['level_change', { speed: this.drive.speed }]);
        this.drive = null; this.phase = 'standing';
      } else if (this.phase === 'drive' && !this.c.requireJump && t - this.drive.t >= this.c.jumpWaitMs) out.push(...this.resolve(t));
      if (this.phase === 'top' && t >= this.topUntil) { this.phase = 'standing'; out.push(['scramble', {}]); }
      if (this.runSince !== null && t - this.runSince >= this.c.escapeMs) { this.runSince = null; out.push(['escape', {}]); }
      return out;
    }
    snapshot() { return { phase: this.phase, top_ms_left: this.phase === 'top' ? Math.max(0, this.topUntil - (this.lastT || 0)) : 0 }; }
  }
  RE.Combat = Combat;
  RE.GuardDetector = GuardDetector;
  RE.StrikeDetector = StrikeDetector;
})(globalThis);
