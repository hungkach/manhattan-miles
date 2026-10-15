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

  for (const name of ['strike', 'squat', 'drive_up', 'slip', 'stance']) RE.detectors.add(name);

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
      const nl = !ctx.low && ok(L.L_WRIST) && near(b.lw, this.c.near);
      const nr = !ctx.low && ok(L.R_WRIST) && near(b.rw, this.c.near);
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
        if (ctx.low || !(l && r)) { this.up = false; this.since = null; }
      }
      out.guard = this.up;
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
        if (ctx.low) continue;
        const type = this.classify(ctx, hand, a, h.hist, out);
        if (!type) continue;
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
      const c = this.c;
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
      const lowStance = ctx.sig.hipDrop >= c.downDrop;

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
  // arm length in meters (pose positions are in shoulder widths of unitM meters)
  const armLen = (a, unitM) => (len(sub(a.elbow, a.shoulder)) + len(sub(a.wrist, a.elbow))) * unitM;

  // Slip: head off the center line, nose against the hip midpoint (2D body
  // units), through a deadzone to -1..1; fires 'slip' at slip.eventLevel.
  class SlipDetector {
    constructor(cfg) { this.c = cfg.combat.slip; this.armed = { left: true, right: true }; }
    update(ctx, out) {
      const b = ctx.sig.body;
      let slip = 0;
      if (!ctx.low) {
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

  // Level changes: 'squat' when the hips drop past squat.drop (with how fast
  // they got there), re-armed above squat.reset; 'drive_up' when the hips
  // come back up by drive.rise within drive.ms of the bottom of a squat.
  class LevelDetector {
    constructor(cfg) { this.c = cfg.combat.level; this.armed = true; this.hist = []; this.bottom = null; }
    update(ctx, out) {
      const t = ctx.t;
      const drop = ctx.sig.hipDrop;
      if (drop == null || ctx.low) return;
      this.hist.push({ t, drop });
      while (this.hist.length && t - this.hist[0].t > this.c.speedMs) this.hist.shift();
      if (this.armed && drop >= this.c.squat) {
        this.armed = false;
        const start = this.hist[0];
        const speed = (drop - start.drop) / Math.max(0.05, (t - start.t) / 1000);
        this.bottom = { t, drop };
        out.events.push(['squat', { depth: ctx.sig.squatDepth, speed }]);
      }
      if (this.bottom) {
        if (drop > this.bottom.drop) this.bottom = { t, drop };
        if (this.bottom.drop - drop >= this.c.rise) {
          const ms = t - this.bottom.t;
          if (ms <= this.c.driveMs) out.events.push(['drive_up', { depth: this.bottom.drop, speed: (this.bottom.drop - drop) / Math.max(0.05, ms / 1000) }]);
          this.bottom = null;
        }
      }
      if (!this.armed && drop < this.c.reset) { this.armed = true; this.bottom = null; }
    }
  }

  // The arm pose for this frame, shared by the strike and stance detectors.
  class ArmPose {
    update(ctx, out) {
      out.arms = null;
      const frame = frameOf(ctx);
      const pose = RE.armPose(ctx.world, frame, ctx.cal.shoulderWidthW);
      if (!pose) return;
      pose.unitM = ctx.cal.shoulderWidthW || len(sub(ctx.world[L.R_SHOULDER], ctx.world[L.L_SHOULDER])) || 0.4;
      // the same arms in the torso's own frame (turns with the shoulders): hooks
      // sweep around the body, so a bladed stance must not tilt them toward the camera
      pose.torso = RE.armPose(ctx.world, RE.bodyFrame(ctx.world, ctx.cal.up) || frame, ctx.cal.shoulderWidthW);
      out.arms = pose;
    }
  }

  // run after the locomotion detectors (stance reads the turn detector's yaw)
  RE.makeCombatDetectors = (cfg) => [new ArmPose(), new GuardDetector(cfg), new StanceDetector(cfg), new StrikeDetector(cfg), new SlipDetector(cfg), new LevelDetector(cfg)];

  // Fight state machine (spec update_combat). Runs only in combat mode.
  // target: {bearing(), shooting(), open()} from enter_combat; all optional.
  //   standing  squat while the target shoots: 'sprawl'; squat otherwise
  //             (when the target is open): 'shot'
  //   shot      drive_up within shotMs: 'takedown' and top; too slow: 'stuffed'
  //   top       strikes become 'down_strike'; rise out of the crouch for
  //             scrambleMs: 'scramble' and back to standing
  // Anywhere: running (high knees) for escapeMs: 'escape' (the engine then
  // leaves combat mode).
  class Combat {
    constructor(cfg) { this.c = cfg.combat.fight; this.reset(); }
    reset() { this.phase = 'standing'; this.shotAt = null; this.highSince = null; this.runSince = null; this.target = null; }
    enter(target) { this.reset(); this.target = target || null; }
    // returns events to emit: [[name, payload]]
    onEvent(name, payload, t) {
      const out = [];
      const tg = this.target || {};
      if (name === 'squat' && this.phase === 'standing') {
        if (tg.shooting && tg.shooting()) out.push(['sprawl', payload]);
        else if (!tg.open || tg.open()) { this.phase = 'shot'; this.shotAt = t; out.push(['shot', payload]); }
      } else if (name === 'drive_up' && this.phase === 'shot') {
        if (t - this.shotAt <= this.c.shotMs) { this.phase = 'top'; this.highSince = null; out.push(['takedown', payload]); }
      } else if (name === 'strike' && this.phase === 'top') {
        out.push(['down_strike', { hand: payload.hand, power: payload.power }]);
      } else if (name === 'run_start') {
        this.runSince = t;
      } else if (name === 'run_end') {
        this.runSince = null;
      }
      return out;
    }
    update(t, sig) {
      const out = [];
      if (this.phase === 'shot' && t - this.shotAt > this.c.shotMs) { this.phase = 'standing'; out.push(['stuffed', {}]); }
      if (this.phase === 'top') {
        // the top position is a half squat hold: stand up and they scramble free
        if ((sig.squat_depth || 0) < this.c.topDepth) {
          if (this.highSince === null) this.highSince = t;
          if (t - this.highSince >= this.c.scrambleMs) { this.phase = 'standing'; out.push(['scramble', {}]); }
        } else this.highSince = null;
      }
      if (this.runSince !== null && t - this.runSince >= this.c.escapeMs) { this.runSince = null; out.push(['escape', {}]); }
      return out;
    }
    snapshot() { return { phase: this.phase }; }
  }
  RE.Combat = Combat;
  RE.GuardDetector = GuardDetector;
  RE.StrikeDetector = StrikeDetector;
})(globalThis);
