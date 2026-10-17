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

  for (const name of ['strike', 'squat', 'drive_up', 'jump', 'slip', 'stance', 'bound']) RE.detectors.add(name);

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

  // Strikes, per hand, from the arm pose over the last few hundred ms:
  //   straight  the elbow snaps from bent to straight with the fist going
  //             toward the camera: jab with the lead hand, cross with the rear
  //   hook      bent elbow, fist sweeping inward at shoulder height
  //   uppercut  bent elbow, fist driving up from below the shoulder
  //   down      from a crouch, the elbow straightens with the fist going down
  // A hand must have been at the guard just before (fighters punch from the
  // guard), so marching arm swing or pumping arms on high knees never strike.
  // Power is peak fist speed over refSpeed, clamped 0.5 to 1.5 (spec).
  class StrikeDetector {
    constructor(cfg) {
      this.c = cfg.combat.strike;
      this.hands = { left: { hist: [], last: -Infinity, lastStraight: -Infinity, armed: true }, right: { hist: [], last: -Infinity, lastStraight: -Infinity, armed: true } };
    }
    update(ctx, out) {
      const t = ctx.t;
      const arms = out.arms;
      if (!arms) return;
      const sw = arms.unitM;
      for (const hand of ['left', 'right']) {
        const h = this.hands[hand];
        const a = arms[hand];
        const p = a.wrist;
        const q = arms.torso[hand];
        // camera frame (x, y, z) for straights; torso frame (tx) for hooks
        h.hist.push({ t, near: out.handNearAt[hand] === t, angle: a.angle, x: p.x * sw, y: (p.y - a.shoulder.y) * sw, z: (p.z - a.shoulder.z) * sw, tx: q.wrist.x * sw, tz: (q.wrist.z - q.shoulder.z) * sw });
        while (h.hist.length && t - h.hist[0].t > this.c.windowMs) h.hist.shift();
        if (a.angle < this.c.rearm) h.armed = true;
        if (h.hist.length < 3 || t - h.last < this.c.refractoryMs) continue;
        if (ctx.upperLow) continue;
        let type = this.classify(ctx, hand, a, h.hist, out);
        if (!type) continue;
        // 0.8.0 (Mark): a hook from the rear hand is the overhand
        if (type === 'hook' && this.c.overhand && hand === (out.stance === 'southpaw' ? 'left' : 'right')) type = 'overhand';
        h.last = t;
        if (type === 'jab' || type === 'cross' || type === 'down') { h.armed = false; h.lastStraight = t; }
        const speed = this.peakSpeed(h.hist);
        out.events.push(['strike', { hand, type, power: RE.clamp(speed / this.c.refSpeed, 0.5, 1.5), speed }]);
      }
    }

    peakSpeed(hist) {
      let best = 0;
      for (let i = 1; i < hist.length; i++) {
        const a = hist[i - 1], b = hist[i];
        const dt = (b.t - a.t) / 1000;
        if (dt > 0) best = Math.max(best, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / dt);
      }
      return best;
    }

    classify(ctx, hand, a, hist, out) {
      // distances and speeds in meters scale with the player's arm length (0.6.1:
      // a smaller player's hook travels less and slower in meters)
      const c = scaled(this.c, out.armScale || 1);
      const now = hist[hist.length - 1];
      const first = hist[0];
      const minAngle = Math.min(...hist.map((s) => s.angle));
      const inward = hand === 'left' ? 1 : -1; // inward is toward the player's right for the left hand
      // thrown from the guard: the hand was at the guard when this motion began
      // (raising the hands into a guard ends there, it does not start there)
      const fromGuard = hist.some((s) => s.near && now.t - s.t >= c.guardLeadMs);
      // velocity over the last ~100 ms
      let back = hist.length - 1;
      while (back > 0 && now.t - hist[back].t < c.velMs) back--;
      const v0 = hist[back];
      const dt = (now.t - v0.t) / 1000 || 1;
      const vx = (now.tx - v0.tx) / dt, vy = (now.y - v0.y) / dt;
      const vArc = Math.hypot(now.tx - v0.tx, now.tz - v0.tz) / dt; // a hook travels an arc in the horizontal plane
      const lowStance = (ctx.sig.levelDrop != null ? ctx.sig.levelDrop : ctx.sig.hipDrop) >= c.downDrop;

      if (a.angle >= c.straightOn && minAngle <= c.bentMax && this.hands[hand].armed) {
        const fwdGain = now.z - Math.min(...hist.map((s) => s.z));
        if (lowStance && now.y <= -c.downBelow && vy <= -c.downSpeed) return 'down';
        if (!fromGuard) return null;
        if (now.z >= c.reach * armLen(a, out.arms.unitM) && fwdGain >= c.fwdGain && now.z > Math.abs(now.x - first.x) && now.y > -c.downBelow) {
          const lead = out.stance === 'southpaw' ? 'right' : 'left';
          return hand === lead ? 'jab' : 'cross';
        }
        return null;
      }
      if (!fromGuard || a.angle > c.bentMax2 || ctx.t - this.hands[hand].lastStraight < c.afterStraightMs) return null;
      // a hook swings with the elbow up and out to the side; raising the guard
      // or pulling a punch back keeps the elbow down or in front
      const elbowUp = (a.elbow.y - a.shoulder.y) * out.arms.unitM >= -c.hookElbow;
      const ta = out.arms.torso[hand];
      const elbowOut = inward * (ta.shoulder.x - ta.elbow.x) * out.arms.unitM >= c.hookElbowOut;
      if (elbowUp && elbowOut && Math.abs(now.y) <= c.hookHeight && now.tz >= c.hookFront && inward * vx > 0 && vArc >= c.hookSpeed && inward * now.tx - Math.min(...hist.map((q) => inward * q.tx)) >= c.hookTravel) return 'hook';
      const lowest = Math.min(...hist.map((s) => s.y));
      if (vy >= c.upperSpeed && lowest <= -c.upperFrom && now.y >= -c.upperTo && now.z >= c.hookFront) return 'uppercut';
      return null;
    }
  }
  // strike thresholds in meters and m/s, scaled by armScale (shorter arms,
  // smaller thresholds); angles and times stay as they are
  const METERS = ['reach', 'fwdGain', 'hookHeight', 'hookFront', 'hookSpeed', 'hookTravel', 'hookElbow', 'hookElbowOut', 'upperSpeed', 'upperFrom', 'upperTo', 'downBelow', 'downSpeed'];
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
    fix(ctx, frame) {
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
        const nE = zE > -c.behind && du > zE ? du : zE;
        const nF = zF > -c.behind && df > zF ? df : zF;
        out[E] = move(world[E], nE - zE);
        out[W] = move(world[W], nE - zE + nF - zF);
      }
      return out;
    }
  }

  // The arm pose for this frame, shared by the strike and stance detectors.
  class ArmPose {
    constructor(cfg) { this.depth = new ArmDepth(cfg); }
    update(ctx, out) {
      out.arms = null;
      const frame = frameOf(ctx);
      const world = frame && ctx.world ? this.depth.fix(ctx, frame) : ctx.world;
      out.armScale = this.depth.armScale();
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
  RE.makeCombatDetectors = (cfg) => [new ArmPose(cfg), new GuardDetector(cfg), new StanceDetector(cfg), new StrikeDetector(cfg), new SlipDetector(cfg), new LevelDetector(cfg), new BoundDetector(cfg)];

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
    reset() { this.phase = 'standing'; this.drive = null; this.topUntil = 0; this.runSince = null; this.target = null; this.sprawled = false; }
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
      } else if (name === 'jump' && this.phase === 'drive') {
        this.drive.jumped = true;
        if (this.c.requireJump) out.push(['shot', { speed: this.drive.speed }]);
        out.push(...this.resolve(t));
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
