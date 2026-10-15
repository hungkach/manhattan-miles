// Locomotion gesture detectors: march steps, high knees (run), torso turn
// steering, lean, point turn, turn around and wave. Each reads the per-frame signals in body
// units (S = shoulder width, T = torso length, +x = player's right, +y = up)
// and pushes events; games only ever see the events and the snapshot.
(function (g) {
  'use strict';
  const RE = g.RepEngine;
  const L = RE.LM;

  RE.detectors = RE.detectors || new Set();
  for (const name of ['step', 'run_start', 'run_end', 'turn_left', 'turn_right', 'lean_left', 'lean_right', 'point', 'turn_around', 'wave']) {
    RE.detectors.add(name);
  }

  // True when landmark i is tracked this frame (not held at a stale value).
  const seen = (ctx, i) => {
    const p = ctx.points[i];
    return !!p && !p.held && p.v >= ctx.holdVis;
  };

  // Where a wrist is: the smoothed point when tracked, else MediaPipe's raw
  // estimate if it lies outside the frame. Raised or outstretched hands
  // often leave a close portrait or a landscape frame, and the raw estimate
  // still says which way they went. null when the wrist is simply lost.
  function wristAt(ctx, i) {
    if (seen(ctx, i)) return { p: ctx.points[i], offFrame: false };
    const r = ctx.raw && ctx.raw[i];
    if (r && (r.x < 0 || r.x > ctx.w || r.y < 0 || r.y > ctx.h)) return { p: r, offFrame: true };
    return null;
  }

  // Wrist speeds in S per second (wristAt positions, so off-frame too).
  class WristSpeed {
    constructor() { this.prev = null; }
    update(ctx, out) {
      const t = ctx.t;
      const ratio = ctx.cal.torsoLength / ctx.cal.shoulderWidth; // T expressed in S
      const pos = (i) => { const at = wristAt(ctx, i); return at ? RE.toBody(at.p, ctx.cal) : null; };
      const now = { t, l: pos(L.L_WRIST), r: pos(L.R_WRIST) };
      const p = this.prev;
      this.prev = now;
      out.wristSpeedL = out.wristSpeedR = 0;
      if (!p || t <= p.t) return;
      const dt = (t - p.t) / 1000;
      const speed = (k) => (now[k] && p[k] ? Math.hypot(now[k].x - p[k].x, (now[k].y - p[k].y) * ratio) / dt : 0);
      out.wristSpeedL = speed('l');
      out.wristSpeedR = speed('r');
    }
  }

  // March steps and high knees, after Homecoming Hero's step trigger, which
  // holds up on real phones. Each leg has four cues (cfg.march.cues): thigh
  // angle and knee height from 3D world landmarks, knee rise and knee lead
  // from the 2D image. A leg steps when `need` of its known cues pass their
  // on values and re-arms when `need` drop below off; a cue whose knee is not
  // tracked is unknown and counts neither way, so one hidden or badly read
  // source never blocks the other. Thigh angle and knee height count above
  // the other leg's and lead is one knee's rise minus the other's, so a squat
  // (both legs together) never steps. Legs alternate. Thresholds come from
  // the profile's tuned cues (engine.apply_capture) when it has them.
  // High knees: startSteps consecutive steps whose peak thigh angle reaches
  // run.pitch, or whose peak knee lift reaches run.lift, spaced at
  // run.cadence or faster, start a run; it ends after run.exitMs without one.
  const STEP_CUES = ['pitch', 'lift', 'rise', 'lead'];
  const LEGS = { left: { knee: L.L_KNEE, other: 'right', k: 'L', o: 'R' }, right: { knee: L.R_KNEE, other: 'left', k: 'R', o: 'L' } };
  const above = (v, other) => (v == null ? null : v - Math.max(0, other == null ? 0 : other));

  class StepDetector {
    constructor(cfg) {
      this.m = cfg.march;
      this.r = cfg.run;
      this.e = cfg.effort;
      this.steps = [];
      this.lastLeg = null;
      this.lastStepAt = -Infinity;
      this.highCount = 0;
      this.lastHighAt = -Infinity;
      this.running = false;
      this.peaks = [];
      // legs start held, so nothing fires until the knee is seen down
      const leg = () => ({ active: true, lastFire: -Infinity, lastStep: -Infinity, counted: false, interval: Infinity, peakPitch: 0, peakLift: 0 });
      this.legs = { left: leg(), right: leg() };
    }

    // This frame's cue values per leg, null for a cue that cannot be read.
    cues(ctx) {
      const s = ctx.sig;
      const kneeSeen = { left: seen(ctx, L.L_KNEE), right: seen(ctx, L.R_KNEE) };
      const out = {};
      for (const name of ['left', 'right']) {
        const g = LEGS[name];
        if (!kneeSeen[name]) { out[name] = { pitch: null, lift: null, rise: null, lead: null }; continue; }
        const other = kneeSeen[g.other];
        out[name] = {
          pitch: above(s['pitch' + g.k], other ? s['pitch' + g.o] : null),
          lift: above(s['kneeLiftW' + g.k], other ? s['kneeLiftW' + g.o] : null),
          rise: s['kneeLift' + g.k],
          lead: other ? s['kneeLift' + g.k] - s['kneeLift' + g.o] : null,
        };
      }
      return out;
    }

    threshold(ctx, name, id) {
      const tuned = ctx.cal.cues && ctx.cal.cues[name] && ctx.cal.cues[name][id];
      return tuned || this.m.cues[id];
    }

    update(ctx, out) {
      const t = ctx.t;
      const s = ctx.sig;
      if (this.running && t - this.lastHighAt > this.r.exitMs) {
        this.running = false;
        this.highCount = 0;
        out.events.push(['run_end', {}]);
      }
      // squat beats march: a deep hip drop holds both legs
      const paused = s.hipDrop > this.m.squatPauseDrop;
      const vals = paused ? null : this.cues(ctx);
      out.stepCues = vals;
      for (const name of ['left', 'right']) this.updateLeg(ctx, name, vals && vals[name], t, out);
      out.cadence = RE.cadenceFromSteps(this.steps, t, this.m.cadenceWindowMs);
      out.running = this.running;
      out.kneeLift = this.peaks.length ? this.peaks.reduce((a, b) => a + b, 0) / this.peaks.length : 0;
      const active = out.cadence > 0;
      out.effort = active
        ? RE.clamp(0.7 * RE.clamp(out.cadence / this.e.fullCadence, 0, 1) + 0.3 * RE.clamp(out.kneeLift / this.e.fullLift, 0, 1), 0, 1)
        : 0;
    }

    updateLeg(ctx, name, v, t, out) {
      const leg = this.legs[name];
      if (!v) { leg.active = true; leg.counted = false; return; }
      let on = 0, off = 0;
      for (const id of STEP_CUES) {
        const x = v[id];
        if (x == null || !isFinite(x)) continue;
        const th = this.threshold(ctx, name, id);
        if (x >= th.on) on++;
        if (x <= th.off) off++;
      }
      const g = LEGS[name];
      const s = ctx.sig;
      if (leg.counted) {
        // peaks of this step, for high knees and effort
        if (s['pitch' + g.k] != null) leg.peakPitch = Math.max(leg.peakPitch, s['pitch' + g.k]);
        const lift = above(s['stepLift' + g.k], s['stepLift' + g.o]);
        if (lift != null) leg.peakLift = Math.max(leg.peakLift, lift);
        if (v.rise != null) leg.peakLift = Math.max(leg.peakLift, v.rise);
      }
      if (!leg.active) {
        if (on < this.m.need || t - leg.lastFire < this.m.refractoryMs) return;
        leg.active = true;
        leg.lastFire = t;
        const alternates = this.lastLeg !== name || t - leg.lastStep >= this.m.sameLegMinMs;
        if (!alternates) return;
        leg.counted = true;
        leg.peakPitch = 0;
        leg.peakLift = 0;
        leg.interval = t - this.lastStepAt;
        leg.lastStep = t;
        this.lastLeg = name;
        this.lastStepAt = t;
        this.steps.push(t);
        if (this.steps.length > 64) this.steps.shift();
        out.events.push(['step', { leg: name }]);
        return;
      }
      if (off < this.m.need) return;
      // knee back down: the step is complete, judge it for high knees
      leg.active = false;
      if (!leg.counted) return;
      leg.counted = false;
      this.peaks.push(leg.peakLift);
      if (this.peaks.length > 4) this.peaks.shift();
      const high = leg.peakLift >= this.r.lift || leg.peakPitch >= this.r.pitch;
      const fast = leg.interval <= 60000 / this.r.cadence;
      if (!high) { this.highCount = 0; return; }
      this.highCount++;
      if (this.running) {
        if (fast) this.lastHighAt = t;
      } else if (this.highCount >= this.r.startSteps && fast) {
        this.running = true;
        this.lastHighAt = t;
        out.events.push(['run_start', {}]);
      }
    }
  }

  // Lean: shoulder midpoint x minus hip midpoint x, through a deadzone,
  // scaled to -1..1. Fast wrists (punches, swipes) switch it off, and the
  // same suppression gates turn steering below.
  class LeanDetector {
    constructor(cfg) {
      this.c = cfg.lean;
      this.suppressUntil = -Infinity;
      this.armed = { left: true, right: true };
    }

    update(ctx, out) {
      const t = ctx.t;
      const s = ctx.sig;
      const speed = Math.max(out.wristSpeedL, out.wristSpeedR);
      if (speed > this.c.wristSpeedMax) this.suppressUntil = t + this.c.suppressHoldMs;
      out.steerSuppressed = t < this.suppressUntil;

      let steer = 0;
      if (!ctx.low && !out.steerSuppressed) {
        const mag = (Math.abs(s.lean) - this.c.deadzone) / (this.c.full - this.c.deadzone);
        if (mag > 0) steer = Math.sign(s.lean) * Math.min(mag, 1);
      }
      out.lean = steer;

      for (const side of ['left', 'right']) {
        const level = side === 'left' ? -steer : steer;
        if (this.armed[side] && level >= this.c.eventLevel) {
          this.armed[side] = false;
          out.events.push(['lean_' + side, { lean: steer }]);
        } else if (!this.armed[side] && level < this.c.eventReset) {
          this.armed[side] = true;
        }
      }
    }
  }

  // Torso turn steering. Shoulder width shrinks with the cosine of torso yaw
  // while torso length does not, and both scale with distance, so
  //   cos(yaw) = (shoulder width / torso length) / calibrated ratio
  // reads the same whether the player stands closer or farther. That gives
  // the size of the turn; the direction comes from which shoulder is nearer
  // the camera in world landmarks, cross-checked against the nose offset
  // from the shoulder midpoint (the nose sits in front of the shoulders).
  class TurnDetector {
    constructor(cfg) {
      this.c = cfg.turn;
      this.armed = { left: true, right: true };
    }

    direction(ctx) {
      const c = this.c;
      let depth = 0;
      const w = ctx.world;
      if (w && seen(ctx, L.L_SHOULDER) && seen(ctx, L.R_SHOULDER)) {
        const ls = w[L.L_SHOULDER], rs = w[L.R_SHOULDER];
        const width = Math.hypot(ls.x - rs.x, ls.y - rs.y, ls.z - rs.z);
        // world z grows away from the camera: right shoulder farther = turned right
        const dz = width > 0 ? (rs.z - ls.z) / width : 0;
        if (Math.abs(dz) >= c.depthMin) depth = Math.sign(dz);
      }
      let nose = 0;
      if (seen(ctx, L.NOSE)) {
        const off = ctx.sig.body.nose.x - ctx.sig.body.sMid.x;
        if (Math.abs(off) >= c.noseMin) nose = Math.sign(off);
      }
      // both cues present but disagreeing: do not steer
      if (depth && nose && depth !== nose) return 0;
      return depth || nose;
    }

    update(ctx, out) {
      const c = this.c;
      const s = ctx.sig;
      out.turn = 0;
      out.yaw = 0;
      if (ctx.low || !(s.torsoRatio > 0)) return;
      const cosYaw = RE.clamp(s.shoulderRatio / s.torsoRatio, 0, 1);
      const mag = (Math.acos(cosYaw) * 180) / Math.PI;
      const dir = this.direction(ctx);
      out.yaw = dir * mag;
      const k = (mag - c.deadzone) / (c.full - c.deadzone);
      if (dir && k > 0 && !out.steerSuppressed) out.turn = dir * Math.min(k, 1);

      for (const side of ['left', 'right']) {
        const level = side === 'left' ? -out.turn : out.turn;
        if (this.armed[side] && level >= c.eventLevel) {
          this.armed[side] = false;
          out.events.push(['turn_' + side, { turn: out.turn }]);
        } else if (!this.armed[side] && level < c.eventReset) {
          this.armed[side] = true;
        }
      }
    }
  }

  // Elbow angle in degrees: 3D world landmarks when the wrist is tracked,
  // else in the image from the wrist point given.
  function elbowAngle(ctx, sh, el, wr, wristPoint, offFrame) {
    const w = ctx.world;
    if (!offFrame && w && w[sh] && w[el] && w[wr]) return RE.jointAngle(w[sh], w[el], w[wr]);
    const p = ctx.points;
    const flat = (q) => ({ x: q.x, y: q.y, z: 0 });
    return RE.jointAngle(flat(p[sh]), flat(p[el]), flat(wristPoint));
  }

  // Point turn: one arm straight out sideways, wrist still, held. Both arms
  // out (a T pose) is not a point, and a swipe passing through is not either.
  class PointDetector {
    constructor(cfg) {
      this.c = cfg.point;
      this.since = { left: null, right: null };
      this.fired = { left: false, right: false };
      this.lastFire = -Infinity;
    }

    candidate(ctx, side, out) {
      const [sh, el, wr] = side === 'left' ? [L.L_SHOULDER, L.L_ELBOW, L.L_WRIST] : [L.R_SHOULDER, L.R_ELBOW, L.R_WRIST];
      const at = wristAt(ctx, wr);
      if (!seen(ctx, el) || !at) return false;
      const b = ctx.sig.body;
      const s = side === 'left' ? b.ls : b.rs;
      const w = RE.toBody(at.p, ctx.cal);
      const outward = side === 'left' ? s.x - w.x : w.x - s.x;
      if (outward < this.c.wristOut || w.y < s.y - this.c.maxBelow) return false;
      const speed = side === 'left' ? out.wristSpeedL : out.wristSpeedR;
      if (speed > this.c.maxWristSpeed) return false;
      return elbowAngle(ctx, sh, el, wr, at.p, at.offFrame) >= this.c.elbowMin;
    }

    update(ctx, out) {
      const t = ctx.t;
      const cand = ctx.low ? { left: false, right: false } : { left: this.candidate(ctx, 'left', out), right: this.candidate(ctx, 'right', out) };
      if (cand.left && cand.right) cand.left = cand.right = false;
      for (const side of ['left', 'right']) {
        if (!cand[side]) { this.since[side] = null; this.fired[side] = false; continue; }
        if (this.since[side] === null) this.since[side] = t;
        if (!this.fired[side] && t - this.since[side] >= this.c.holdMs && t - this.lastFire >= this.c.cooldownMs) {
          this.fired[side] = true;
          this.lastFire = t;
          out.events.push(['point', { side }]);
        }
      }
    }
  }

  // Is this wrist overhead? A wrist that left through the top of the frame
  // counts too, since raised hands often leave a landscape frame.
  function wristOverhead(ctx, i, aboveNose) {
    const at = wristAt(ctx, i);
    if (!at) return false;
    if (at.offFrame) return at.p.y < 0;
    return RE.toBody(at.p, ctx.cal).y - ctx.sig.body.nose.y >= aboveNose;
  }

  // Turn around: both wrists above the head, held.
  class TurnAroundDetector {
    constructor(cfg) {
      this.c = cfg.turnAround;
      this.since = null;
      this.fired = false;
      this.lastFire = -Infinity;
    }

    update(ctx, out) {
      const t = ctx.t;
      const up = !ctx.low && wristOverhead(ctx, L.L_WRIST, this.c.aboveNose) && wristOverhead(ctx, L.R_WRIST, this.c.aboveNose);
      out.handsOverhead = up;
      if (!up) { this.since = null; this.fired = false; return; }
      if (this.since === null) this.since = t;
      if (!this.fired && t - this.since >= this.c.holdMs && t - this.lastFire >= this.c.cooldownMs) {
        this.fired = true;
        this.lastFire = t;
        out.events.push(['turn_around', {}]);
      }
    }
  }

  // Wave: wrist well above its shoulder, swinging side to side. Counts direction
  // changes of at least minSwing S; enough of them inside the window fire.
  class WaveDetector {
    constructor(cfg) {
      this.c = cfg.wave;
      this.hands = { left: fresh(), right: fresh() };
      this.lastFire = -Infinity;
    }

    update(ctx, out) {
      const t = ctx.t;
      const b = ctx.sig.body;
      for (const hand of ['left', 'right']) {
        const h = this.hands[hand];
        const wi = hand === 'left' ? L.L_WRIST : L.R_WRIST;
        const s = hand === 'left' ? b.ls : b.rs;
        const w = hand === 'left' ? b.lw : b.rw;
        // both hands overhead is the turn-around gesture, not a wave
        if (ctx.low || out.handsOverhead || !seen(ctx, wi) || w.y - s.y < this.c.minAbove) { this.hands[hand] = fresh(); continue; }
        const x = w.x - s.x;
        let reversed = false;
        if (h.dir === 0) {
          h.lo = Math.min(h.lo, x);
          h.hi = Math.max(h.hi, x);
          if (x - h.lo >= this.c.minSwing) { h.dir = 1; h.ext = x; }
          else if (h.hi - x >= this.c.minSwing) { h.dir = -1; h.ext = x; }
        } else if (h.dir * (x - h.ext) > 0) {
          h.ext = x;
        } else if (Math.abs(x - h.ext) >= this.c.minSwing) {
          h.dir = -h.dir;
          h.ext = x;
          reversed = true;
        }
        if (!reversed) continue;
        h.reversals = h.reversals.filter((r) => t - r <= this.c.windowMs);
        h.reversals.push(t);
        if (h.reversals.length >= this.c.reversals && t - this.lastFire >= this.c.cooldownMs) {
          this.lastFire = t;
          h.reversals = [];
          out.events.push(['wave', { hand }]);
        }
      }
    }
  }

  function fresh() {
    return { dir: 0, ext: 0, lo: Infinity, hi: -Infinity, reversals: [] };
  }

  // All locomotion detectors, run in order once per frame.
  // ctx: {t (ms), w, h, points (smoothed px), raw (unsmoothed px), world, cal, sig, low, holdVis}
  // Returns {events: [[name, payload]], turn, yaw, lean, cadence, running, effort, ...}
  RE.LocomotionDetectors = class LocomotionDetectors {
    constructor(cfg) {
      this.list = [new WristSpeed(), new StepDetector(cfg), new LeanDetector(cfg), new TurnDetector(cfg), new TurnAroundDetector(cfg), new PointDetector(cfg), new WaveDetector(cfg)];
      if (RE.makeCombatDetectors) this.list.push(...RE.makeCombatDetectors(cfg));
    }
    update(ctx) {
      const out = { events: [], turn: 0, yaw: 0, lean: 0, steerSuppressed: false, cadence: 0, running: false, effort: 0, kneeLift: 0, handsOverhead: false, wristSpeedL: 0, wristSpeedR: 0, arms: null, guard: false, stance: 'square', slip: 0 };
      for (const d of this.list) d.update(ctx, out);
      return out;
    }
  };
  RE.StepDetector = StepDetector;
})(globalThis);
