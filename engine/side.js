// A second camera at the side (0.12.0, Mark 10/23: "could the second camera be placed at the
// side you have an open stance in, connected through a session code with a url? Optional.").
//
// The main camera sees a punch toward it only as a shortening arm, and MediaPipe squashes that
// depth (ArmDepth recovers it from foreshortening, but tired, loose or rotational punches blur it).
// A phone at the player's side sees the same punch across its image: how far the elbow and the
// fist are in front of the shoulder is plain x in the side picture. The side phone runs its own
// tracker and sends only a few landmarks (RE.sidePack); the main engine (SideView) turns each
// into forward reach in torso lengths, and ArmPose reads the arms from the main frame taken at
// the same moment as the newest side frame (the link's delay, about a frame or two), with the
// side's reach in place of the foreshortening estimate.
//
// Side picture measures (each frame, in the side image, smoothed like the main landmarks):
//   T        torso length, shoulder midpoint to hip midpoint (px)
//   facing   which way the player faces across the picture: the nose ahead of the ears (EMA)
//   reach    per arm: elbow and wrist in front of their shoulder, in T
//   height   per arm: wrist above its shoulder, in T, to tell the arms apart. MediaPipe's left and
//            right are unreliable in profile, so the side's arms are matched to the main camera's:
//            a frame where the phone's two wrists swap places against the last frame is its
//            labels flipping (followed at once); and over time the wrist heights decide (the
//            mismatch of this matching against the other, averaged over swapFrames, past
//            swapMargin T, swaps it). Hands at one height (a guard) leave it as it is
//   tilt     how far the phone is from a true profile: the shoulders' spread across the picture
//            against the player's shoulder width over torso length (main calibration), the least
//            over the last few seconds; a placement check for the game to show (a bladed stance
//            turns the shoulders too, so reach is not corrected by it)
// Times: a side frame carries the phone's own clock; side_sync(offset) (the link measures it)
// puts it on the main clock. Without it, a frame is taken to be leadMs older than its arrival.
(function (g) {
  'use strict';
  const RE = g.RepEngine;
  const L = RE.LM;

  // the landmarks the side phone sends, in this order
  RE.SIDE_LM = [L.NOSE, L.L_EAR, L.R_EAR, L.L_SHOULDER, L.R_SHOULDER, L.L_ELBOW, L.R_ELBOW, L.L_WRIST, L.R_WRIST, L.L_HIP, L.R_HIP, L.L_KNEE, L.R_KNEE];
  const round = (v, k) => Math.round(v * k) / k;
  // a raw frame from the side phone, small enough to send 30 times a second
  RE.sidePack = function (raw) {
    if (!raw || !raw.lm) return null;
    return { t: raw.t, w: raw.w, h: raw.h, p: RE.SIDE_LM.map((i) => [round(raw.lm[i][0], 1e4), round(raw.lm[i][1], 1e4), round(raw.lm[i][3] == null ? 1 : raw.lm[i][3], 100)]) };
  };

  class SideView {
    constructor(cfg) { this.c = cfg.side; this.sm = cfg.smoothing; this.offset = null; this.reset(); }
    reset() { this.samples = []; this.face = 0; this.swap = false; this.ev = 0; this.lastRaw = null; this.arrivals = []; this.spreads = []; this.f = {}; }
    // the phone's clock to the main clock: main = side + offset (ms)
    sync(offset) { this.offset = offset; }
    filt(key, v, tSec) { const f = (this.f[key] = this.f[key] || new RE.OneEuroFilter(this.sm)); return f.filter(v, tSec); }
    // frame: from RE.sidePack; t: when it arrived, on the main clock
    push(frame, t, cal) {
      if (!frame || !frame.p || frame.p.length < RE.SIDE_LM.length) return;
      const P = {};
      RE.SIDE_LM.forEach((i, k) => { const q = frame.p[k]; P[i] = { x: q[0] * frame.w, y: q[1] * frame.h, v: q[2] }; });
      const sm = RE.mid(P[L.L_SHOULDER], P[L.R_SHOULDER]), hm = RE.mid(P[L.L_HIP], P[L.R_HIP]);
      const T = RE.dist(sm, hm);
      this.arrivals.push(t);
      while (this.arrivals.length && t - this.arrivals[0] > 1000) this.arrivals.shift();
      if (!(T > 10) || Math.min(P[L.L_SHOULDER].v, P[L.R_SHOULDER].v) < this.c.minVis) return;
      const ct = this.offset != null && frame.t != null ? frame.t + this.offset : t - this.c.leadMs;
      const last = this.samples[this.samples.length - 1];
      if (last && ct <= last.t) return; // out of order
      // facing: the nose ahead of the ears, smoothed
      const ear = RE.mid(P[L.L_EAR], P[L.R_EAR]);
      if (P[L.NOSE].v >= this.c.minVis) this.face += (Math.sign(P[L.NOSE].x - ear.x) - this.face) * 0.1;
      const dir = this.face >= 0 ? 1 : -1;
      // placement: the least shoulder spread lately
      const ratio = cal && cal.shoulderWidth > 0 && cal.torsoLength > 0 ? cal.shoulderWidth / cal.torsoLength : 0.75;
      this.spreads.push([ct, Math.min(1, Math.abs(P[L.L_SHOULDER].x - P[L.R_SHOULDER].x) / T / ratio)]);
      while (this.spreads.length && ct - this.spreads[0][0] > 5000) this.spreads.shift();
      const tilt = Math.asin(Math.min(...this.spreads.map((q) => q[1])));
      const tSec = ct / 1000;
      const arm = (side, S, E, W) => ({
        e: this.filt(side + 'e', (dir * (P[E].x - P[S].x)) / T, tSec),
        w: this.filt(side + 'w', (dir * (P[W].x - P[S].x)) / T, tSec),
        h: this.filt(side + 'h', (P[S].y - P[W].y) / T, tSec),
        ok: P[E].v >= this.c.minVis && P[W].v >= this.c.minVis,
      });
      // the phone's own labels flipping since the last frame: both wrists jump to where the other was
      const raw = { l: { x: (dir * (P[L.L_WRIST].x - sm.x)) / T, y: (sm.y - P[L.L_WRIST].y) / T }, r: { x: (dir * (P[L.R_WRIST].x - sm.x)) / T, y: (sm.y - P[L.R_WRIST].y) / T } };
      const lr = this.lastRaw, d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const flipped = !!lr && d(raw.l, lr.r) + d(raw.r, lr.l) + this.c.flipMargin < d(raw.l, lr.l) + d(raw.r, lr.r);
      this.lastRaw = raw;
      if (flipped) { this.swap = !this.swap; for (const k of ['e', 'w', 'h']) { const a = this.f['l' + k]; this.f['l' + k] = this.f['r' + k]; this.f['r' + k] = a; } }
      this.samples.push({ t: ct, left: arm('l', L.L_SHOULDER, L.L_ELBOW, L.L_WRIST), right: arm('r', L.R_SHOULDER, L.R_ELBOW, L.R_WRIST), tilt });
      while (this.samples.length > 2 && ct - this.samples[0].t > 1000) this.samples.shift();
    }
    // is the side camera sending (within a second)?
    connected(t) { return !!this.arrivals.length && t - this.arrivals[this.arrivals.length - 1] < 1000; }
    fps(t) { return this.connected(t) ? this.arrivals.length : 0; }
    // the newest side sample, if it is no older than maxAgeMs at time t
    newest(t) {
      const s = this.samples[this.samples.length - 1];
      return s && t - s.t <= this.c.maxAgeMs ? s : null;
    }
    // a sample's arms matched to the main camera's (main: { left, right } wrist heights above
    // their shoulders in T, from the main frame taken at the same moment)
    match(s, main) {
      if (!s) return null;
      if (main && s !== this.judged) {
        this.judged = s;
        const same = Math.abs(s.left.h - main.left) + Math.abs(s.right.h - main.right);
        const cross = Math.abs(s.left.h - main.right) + Math.abs(s.right.h - main.left);
        // how much worse the current matching fits than the other, averaged
        const worse = this.swap ? cross - same : same - cross;
        this.ev += (worse - this.ev) / this.c.swapFrames;
        if (this.ev > this.c.swapMargin) { this.swap = !this.swap; this.ev = 0; }
      }
      return this.swap ? { left: s.right, right: s.left } : { left: s.left, right: s.right };
    }
  }
  RE.SideView = SideView;
})(typeof globalThis !== 'undefined' ? globalThis : this);
