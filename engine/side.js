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
//   reach    per arm: elbow and wrist in front of the shoulder midpoint, in T
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

  // The side camera's zone (0.14.1, Mark: "a zone visible to the user that is ideal for picking
  // up"): the picture's middle with a margin all round (side.zone, picture fractions). The player
  // is in it with the nose, the shoulders, the hips and both knees seen inside it, head to knees
  // at least minH of the picture's height, centered between cy0 and cy1. get(i) gives landmark i as { x, y, v } in picture
  // fractions. Returns { ok, hint, box, top, bottom, cx } (hint: what to change, plain words; the
  // phone's preview is mirrored, so it never says left or right).
  RE.sideZone = function (get, zone) {
    const Z = zone || RE.defaultConfig().side.zone;
    const box = { x0: Z.x0, x1: Z.x1, y0: Z.y0, y1: Z.y1 };
    const seen = (i) => { const p = get(i); return p && p.v >= Z.minVis ? p : null; };
    const core = [L.NOSE, L.L_SHOULDER, L.R_SHOULDER, L.L_HIP, L.R_HIP].map(seen);
    // part of them seen (a shoulder, a hip): too close; nothing: not in the picture
    if (core.some((p) => !p)) return { ok: false, hint: core.some(Boolean) ? 'Move the phone back' : 'Step into the picture', box };
    const knees = [L.L_KNEE, L.R_KNEE].map(seen);
    const top = core[0].y, cx = (core[3].x + core[4].x) / 2;
    const bottom = knees.every(Boolean) ? Math.max(knees[0].y, knees[1].y) : 1.01;
    const xs = core.concat(knees.filter(Boolean)).map((p) => p.x);
    const out = { box, top, bottom, cx };
    if (top < Z.y0 || bottom > Z.y1) return Object.assign(out, { ok: false, hint: top < Z.y0 && bottom <= Z.y1 ? 'Tilt the phone up a little, or move it back' : bottom > Z.y1 && top >= Z.y0 ? 'Tilt the phone down a little, or move it back' : 'Move the phone back' });
    if (Math.min(...xs) < Z.x0 || Math.max(...xs) > Z.x1) return Object.assign(out, { ok: false, hint: 'Turn the phone to put the player in the middle' });
    if (bottom - top < Z.minH) return Object.assign(out, { ok: false, hint: 'Move the phone closer' });
    // at hip height the player stands in the middle; a phone low on the floor sees them high up
    const cy = (top + bottom) / 2;
    if (cy < Z.cy0) return Object.assign(out, { ok: false, hint: 'Raise the phone to hip height' });
    if (cy > Z.cy1) return Object.assign(out, { ok: false, hint: 'Lower the phone to hip height' });
    return Object.assign(out, { ok: true, hint: 'In the zone' });
  };

  // The stance box on the side phone (0.20.0, Mark 10/24: "side camera zone should be adjustable on
  // the side camera itself; get in fighting stance and make sure there is 1.5 fist width front and
  // back"). From the side picture: which way the player faces, the torso length T, and where each
  // fist rests (followed while it is slow, so a punch does not drag the box). The box runs from the
  // rear fist minus the room to the lead fist plus the room (fists of fistT torso lengths), from
  // above the head to the hips. update(get, fists) takes landmarks as { x, y, v } in picture
  // fractions (get(i)) and returns { ok, box { x0, x1, y0, y1 }, front, back } in picture fractions,
  // or { ok: false } until the body and both fists are seen. The engine's punch zone uses the same
  // room (`punch.fistM` meters a fist) while the side camera sends it.
  class SideBox {
    constructor(cfg) { this.c = (cfg || RE.defaultConfig()).side.box; this.rest = null; this.last = null; this.face = 0; }
    update(get, fists) {
      const c = this.c, seen = (i) => { const p = get(i); return p && p.v >= 0.5 ? p : null; };
      const sl = seen(L.L_SHOULDER), sr = seen(L.R_SHOULDER), hl = seen(L.L_HIP), hr = seen(L.R_HIP), n = seen(L.NOSE), wl = seen(L.L_WRIST), wr = seen(L.R_WRIST);
      if (!sl || !sr || !hl || !hr || !wl || !wr) return { ok: false };
      const sm = RE.mid(sl, sr), hm = RE.mid(hl, hr), T = RE.dist(sm, hm);
      if (!(T > 0.02)) return { ok: false };
      const el = seen(L.L_EAR), er = seen(L.R_EAR), ear = el && er ? RE.mid(el, er) : el || er;
      if (n && ear) this.face += (Math.sign(n.x - ear.x) - this.face) * 0.1;
      const dir = this.face >= 0 ? 1 : -1;
      // each fist's forward reach from the shoulder midpoint, in T; its resting spot follows it while slow
      const r = { l: (dir * (wl.x - sm.x)) / T, r: (dir * (wr.x - sm.x)) / T };
      if (!this.rest) this.rest = { l: r.l, r: r.r };
      for (const k of ['l', 'r']) {
        const v = this.last ? Math.abs(r[k] - this.last[k]) * 30 : 0; // T a second at about 30 frames a second
        if (v < c.restSpeed) this.rest[k] += (r[k] - this.rest[k]) * c.restK;
      }
      this.last = r;
      const room = RE.clamp(fists == null ? c.fists : fists, c.minFists, c.maxFists) * c.fistT;
      const front = Math.max(this.rest.l, this.rest.r) + room, back = Math.min(this.rest.l, this.rest.r) - room;
      const xa = sm.x + dir * back * T, xb = sm.x + dir * front * T;
      const top = (n ? n.y : sm.y - 0.3 * T) - c.headT * T;
      return { ok: true, dir, box: { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: top, y1: hm.y }, front: sm.x + dir * front * T, back: sm.x + dir * back * T, out: { l: r.l > front, r: r.r > front } };
    }
  }
  RE.SideBox = SideBox;

  class SideView {
    constructor(cfg) { this.c = cfg.side; this.sm = cfg.smoothing; this.offset = null; this.reset(); }
    reset() { this.zoneFists = null; this.samples = []; this.face = 0; this.swap = false; this.ev = 0; this.lastRaw = null; this.legSwap = false; this.legEv = 0; this.lastKnees = null; this.stand = []; this.arrivals = []; this.spreads = []; this.f = {}; }
    // the phone's clock to the main clock: main = side + offset (ms)
    sync(offset) { this.offset = offset; }
    filt(key, v, tSec) { const f = (this.f[key] = this.f[key] || new RE.OneEuroFilter(this.sm)); return f.filter(v, tSec); }
    // frame: from RE.sidePack; t: when it arrived, on the main clock
    push(frame, t, cal) {
      if (!frame || !frame.p || frame.p.length < RE.SIDE_LM.length) return;
      // the stance box the player set on the phone, in fists (0.20.0): it sizes the punch zone
      if (frame.zf > 0) this.zoneFists = frame.zf;
      const P = {};
      RE.SIDE_LM.forEach((i, k) => { const q = frame.p[k]; P[i] = { x: q[0] * frame.w, y: q[1] * frame.h, v: q[2] }; });
      this.zone = RE.sideZone((i) => { const q = frame.p[RE.SIDE_LM.indexOf(i)]; return q && { x: q[0], y: q[1], v: q[2] }; }, this.c.zone);
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
      // from the shoulder midpoint, not each arm's own shoulder (0.12.2): the phone's labels
      // can swap the fists without the shoulders, and a bladed stance puts the shoulders at
      // different depths; the main camera gives each shoulder's own offset (ArmDepth)
      const arm = (side, S, E, W) => ({
        e: this.filt(side + 'e', (dir * (P[E].x - sm.x)) / T, tSec),
        w: this.filt(side + 'w', (dir * (P[W].x - sm.x)) / T, tSec),
        h: this.filt(side + 'h', (sm.y - P[W].y) / T, tSec),
        ok: P[E].v >= this.c.minVis && P[W].v >= this.c.minVis,
      });
      // the phone's own labels flipping since the last frame: both wrists jump to where the other was
      const raw = { l: { x: (dir * (P[L.L_WRIST].x - sm.x)) / T, y: (sm.y - P[L.L_WRIST].y) / T }, r: { x: (dir * (P[L.R_WRIST].x - sm.x)) / T, y: (sm.y - P[L.R_WRIST].y) / T } };
      // 0.12.2 (Mark: stray punches during head movement): both fists sit together in front of
      // the face from the side, and a label swap there gave one hand the other's reach. Each
      // fist is followed from where its own speed puts it, and the nearer pairing wins by
      // flipMargin, so a swap between hands close together is caught and a punch passing the
      // other fist is not one
      const flipped = this.follow('lastRaw', raw);
      if (flipped) { this.swap = !this.swap; for (const k of ['e', 'w', 'h']) { const a = this.f['l' + k]; this.f['l' + k] = this.f['r' + k]; this.f['r' + k] = a; } }
      // legs and level (0.12.1): each thigh's angle from straight down (degrees) and its knee's
      // height above its hip (T); the hip midpoint's drop below where it stands (T), from the
      // frames where both thighs hang straight (the last standMs)
      const kr = { l: { x: (dir * (P[L.L_KNEE].x - hm.x)) / T, y: (hm.y - P[L.L_KNEE].y) / T }, r: { x: (dir * (P[L.R_KNEE].x - hm.x)) / T, y: (hm.y - P[L.R_KNEE].y) / T } };
      if (this.follow('lastKnees', kr)) {
        this.legSwap = !this.legSwap;
        for (const k of ['p', 'k']) { const a = this.f['l' + k]; this.f['l' + k] = this.f['r' + k]; this.f['r' + k] = a; }
      }
      // the thigh forward and down (T); across the body is the main camera's (applySignals)
      const leg = (side, H, K) => {
        const fw = this.filt(side + 'p', (dir * (P[K].x - hm.x)) / T, tSec), dn = (P[K].y - hm.y) / T;
        return {
          fw, dn,
          pitch: (Math.atan2(Math.abs(fw), dn) * 180) / Math.PI,
          kh: this.filt(side + 'k', -dn, tSec),
          ok: P[H].v >= this.c.minVis && P[K].v >= this.c.minVis,
        };
      };
      const legs = { left: leg('l', L.L_HIP, L.L_KNEE), right: leg('r', L.R_HIP, L.R_KNEE) };
      if (legs.left.ok && legs.right.ok && legs.left.pitch < this.c.standPitch && legs.right.pitch < this.c.standPitch) this.stand.push([ct, hm.y, (legs.left.pitch + legs.right.pitch) / 2, T]);
      while (this.stand.length && ct - this.stand[0][0] > this.c.standMs) this.stand.shift();
      let level = null;
      if (this.stand.length >= this.c.standFrames && Math.min(P[L.L_HIP].v, P[L.R_HIP].v) >= this.c.minVis) {
        const med = (k) => { const a = this.stand.map((q) => q[k]).sort((x, y) => x - y); return a[a.length >> 1]; };
        // in standing torso lengths, so the torso's own wobble does not read as a level change
        level = this.filt('lv', (hm.y - med(1)) / med(3), tSec);
        this.pitchBase = med(2);
      }
      this.samples.push({ t: ct, left: arm('l', L.L_SHOULDER, L.L_ELBOW, L.L_WRIST), right: arm('r', L.R_SHOULDER, L.R_ELBOW, L.R_WRIST), legs, level, tilt });
      while (this.samples.length > 2 && ct - this.samples[0].t > 1000) this.samples.shift();
    }
    // the phone's labels this frame against where each one's own track predicts it (cur: { l, r }
    // positions in T); keeps the track under key; true when the labels flipped
    follow(key, cur) {
      const last = this[key], d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const pred = last ? { l: { x: last.l.x + last.vl.x, y: last.l.y + last.vl.y }, r: { x: last.r.x + last.vr.x, y: last.r.y + last.vr.y } } : null;
      const flipped = !!pred && d(cur.l, pred.r) + d(cur.r, pred.l) + this.c.flipMargin < d(cur.l, pred.l) + d(cur.r, pred.r);
      // the track's previous point under this frame's labels, for the velocity
      const pl = !last ? cur.l : flipped ? last.r : last.l, pr = !last ? cur.r : flipped ? last.l : last.r;
      const vel = (a, b) => ({ x: (a.x - b.x) * 0.6, y: (a.y - b.y) * 0.6 }); // a damped step
      this[key] = { l: cur.l, r: cur.r, vl: vel(cur.l, pl), vr: vel(cur.r, pr) };
      return flipped;
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
    // Legs and level into this frame's signals (0.12.1): the steps, kicks and level changes read
    // pitchL/pitchR and levelDrop, so the side camera's thigh angles and hip drop take their place
    // while it is fresh. The side's legs are matched to these by knee height (as the arms are).
    applySignals(sig, t, cfg, cal) {
      const s = this.newest(t);
      if (!s || !s.legs || !sig.body) return false;
      const b = sig.body, main = { left: b.lk.y - b.lh.y, right: b.rk.y - b.rh.y };
      if (s !== this.legJudged) {
        this.legJudged = s;
        const same = Math.abs(s.legs.left.kh - main.left) + Math.abs(s.legs.right.kh - main.right);
        const cross = Math.abs(s.legs.left.kh - main.right) + Math.abs(s.legs.right.kh - main.left);
        const worse = this.legSwap ? cross - same : same - cross;
        this.legEv += (worse - this.legEv) / this.c.swapFrames;
        if (this.legEv > this.c.swapMargin) { this.legSwap = !this.legSwap; this.legEv = 0; }
      }
      const legs = this.legSwap ? { L: s.legs.right, R: s.legs.left } : { L: s.legs.left, R: s.legs.right };
      // each thigh in 3D: forward and down from the side, across the body from this camera (in T;
      // the body's x is in shoulder widths), so a low kick's sweep counts toward its angle
      const sw = cal && cal.shoulderWidth > 0 && cal.torsoLength > 0 ? cal.shoulderWidth / cal.torsoLength : 0.75;
      for (const k of ['L', 'R']) {
        const g = legs[k];
        if (!g.ok) continue;
        const across = (k === 'L' ? b.lk.x - b.lh.x : b.rk.x - b.rh.x) * sw;
        const pitch = (Math.atan2(Math.hypot(g.fw, across), g.dn) * 180) / Math.PI;
        sig['pitch' + k] = Math.max(0, pitch - (this.pitchBase || 0));
      }
      if (s.level != null) {
        sig.levelDrop = s.level;
        sig.squatDepth = RE.clamp(s.level / cfg.signals.squatFullDrop, 0, 1);
      }
      sig.side = true;
      return true;
    }
  }
  RE.SideView = SideView;
})(typeof globalThis !== 'undefined' ? globalThis : this);
