// Frame sources. Every source produces the same raw frame shape, which is
// also the recorded clip format:
//   { t: ms, w: video width px, h: video height px,
//     lm: [[x, y, z, visibility] x33] | null,   // MediaPipe 0-1 image coords
//     wl: [[x, y, z, visibility] x33] | null }  // MediaPipe world coords, meters
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  const pack = (list) => list.map((p) => [p.x, p.y, p.z, p.visibility == null ? 1 : p.visibility]);

  // Opens the preset's camera. Front camera presets ask for facingMode 'user'.
  // Back camera presets (TV) ask for the back camera, then with wideLens try
  // the ultra-wide lens by its label, else zoom the main lens all the way out;
  // with no back camera they fall back to the front one. Resolves with
  // {stream, info: {facing, lens: 'front' | 'main' | 'ultrawide' | 'wide_zoom', fallback, label}}.
  RE.openCamera = async function (preset, cfg, md) {
    const get = (v) => md.getUserMedia({
      audio: false,
      video: Object.assign({ width: { ideal: cfg.camera.idealWidth }, height: { ideal: cfg.camera.idealHeight } }, v),
    });
    const stopStream = (st) => { if (st) st.getTracks().forEach((tr) => tr.stop()); };
    const track = (st) => st.getVideoTracks()[0];
    const front = async (fallback, reason) => {
      const stream = await get({ facingMode: 'user' });
      return { stream, info: { facing: 'user', lens: 'front', fallback, label: track(stream).label || '', reason } };
    };
    if (preset.facingMode !== 'environment') return front(false);
    let s = null;
    try {
      s = await get({ facingMode: { ideal: 'environment' } });
      let tr = track(s);
      const settings = tr.getSettings ? tr.getSettings() : {};
      if (/front|facetime/i.test(tr.label || '') || settings.facingMode === 'user') throw new Error('no back camera');
      let lens = 'main';
      if (preset.wideLens) {
        if (/ultra ?wide/i.test(tr.label || '')) lens = 'ultrawide';
        else {
          const cams = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput');
          const uw = cams.find((d) => /ultra ?wide/i.test(d.label) && !/front/i.test(d.label));
          if (uw) {
            try {
              const s2 = await get({ deviceId: { exact: uw.deviceId } });
              stopStream(s);
              s = s2;
              tr = track(s);
              lens = 'ultrawide';
            } catch (_) {}
          }
          if (lens !== 'ultrawide' && (await widestZoom(tr))) lens = 'wide_zoom';
        }
      }
      return { stream: s, info: { facing: 'environment', lens, fallback: false, label: tr.label || '' } };
    } catch (err) {
      stopStream(s);
      return front(true, err.message);
    }
  };

  // Zoom all the way out when the browser allows it (some back cameras reach
  // the ultra-wide this way). True when the zoom went below 1.
  async function widestZoom(tr) {
    try {
      const caps = tr.getCapabilities ? tr.getCapabilities() : {};
      const cur = tr.getSettings ? tr.getSettings().zoom : undefined;
      if (caps.zoom && caps.zoom.min < (cur == null ? 1 : cur)) {
        await tr.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
        return caps.zoom.min < 1;
      }
    } catch (_) {}
    return false;
  }

  // Live camera + MediaPipe Pose Landmarker (VIDEO mode, one pose).
  class CameraPoseSource {
    constructor(cfg) {
      this.cfg = cfg;
      this.video = null;
      this.stream = null;
      this.landmarker = null;
      this.raf = 0;
      this.running = false;
      this.lastVideoTime = -1;
      this.fps = 0;
      this._fpsFrames = 0;
      this._fpsSince = 0;
      this.delegate = null;
      this.info = null;
    }

    async start(video, preset, onFrame, onStatus = () => {}) {
      if (!g.isSecureContext) throw new Error('Camera needs https (or localhost).');
      if (!g.navigator || !g.navigator.mediaDevices || !g.navigator.mediaDevices.getUserMedia) {
        throw new Error('This browser has no camera access.');
      }
      this.video = video;
      onStatus('Loading pose model');
      const vision = await import(/* webpackIgnore: true */ this.cfg.pose.moduleUrl);
      const fileset = await vision.FilesetResolver.forVisionTasks(this.cfg.pose.wasmBase);
      this.landmarker = await this._createLandmarker(vision, fileset);

      onStatus('Starting camera');
      const opened = await RE.openCamera(preset, this.cfg, g.navigator.mediaDevices);
      this.stream = opened.stream;
      this.info = opened.info;
      if (opened.info.fallback) onStatus('Back camera unavailable, using the front camera');
      video.srcObject = this.stream;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      await video.play();

      this.running = true;
      this._fpsSince = RE.now();
      const loop = () => {
        if (!this.running) return;
        this.raf = g.requestAnimationFrame(loop);
        if (video.readyState < 2 || video.currentTime === this.lastVideoTime) return;
        this.lastVideoTime = video.currentTime;
        const t = RE.now();
        let result;
        try {
          result = this.landmarker.detectForVideo(video, t);
        } catch (err) {
          onStatus('Pose error: ' + err.message);
          return;
        }
        const lm = result.landmarks && result.landmarks[0] ? pack(result.landmarks[0]) : null;
        const wl = result.worldLandmarks && result.worldLandmarks[0] ? pack(result.worldLandmarks[0]) : null;
        this._tickFps(t);
        onFrame({ t, w: video.videoWidth, h: video.videoHeight, lm, wl });
      };
      onStatus('Tracking');
      loop();
    }

    async _createLandmarker(vision, fileset) {
      const p = this.cfg.pose;
      const options = (delegate) => ({
        baseOptions: { modelAssetPath: p.modelUrl, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: p.minPoseDetectionConfidence,
        minPosePresenceConfidence: p.minPosePresenceConfidence,
        minTrackingConfidence: p.minTrackingConfidence,
      });
      try {
        this.delegate = p.delegate;
        return await vision.PoseLandmarker.createFromOptions(fileset, options(p.delegate));
      } catch (err) {
        if (p.delegate === 'CPU') throw err;
        this.delegate = 'CPU';
        return await vision.PoseLandmarker.createFromOptions(fileset, options('CPU'));
      }
    }

    _tickFps(t) {
      this._fpsFrames++;
      if (t - this._fpsSince >= 1000) {
        this.fps = (this._fpsFrames * 1000) / (t - this._fpsSince);
        this._fpsFrames = 0;
        this._fpsSince = t;
      }
    }

    stop() {
      this.running = false;
      if (this.raf) g.cancelAnimationFrame(this.raf);
      if (this.stream) this.stream.getTracks().forEach((tr) => tr.stop());
      if (this.video) this.video.srcObject = null;
      if (this.landmarker && this.landmarker.close) {
        try { this.landmarker.close(); } catch (_) {}
      }
      this.stream = null;
      this.landmarker = null;
    }
  }
  RE.CameraPoseSource = CameraPoseSource;

  RE.validateClip = function (clip) {
    if (!clip || clip.format !== 'rep-engine-clip' || !Array.isArray(clip.frames)) {
      throw new Error('Not a rep-engine clip');
    }
    if (clip.version !== 1) throw new Error('Unsupported clip version ' + clip.version);
    return clip;
  };

  // Feed a whole clip synchronously (tests, analysis).
  RE.replaySync = function (clip, onFrame) {
    RE.validateClip(clip);
    for (const f of clip.frames) onFrame(f);
  };

  // Replay a clip in real time so the overlay and games see it like live input.
  class ReplayPoseSource {
    constructor(clip) { this.clip = RE.validateClip(clip); this.timer = 0; this.running = false; this.fps = 0; }
    start(onFrame, onEnd = () => {}) {
      const frames = this.clip.frames;
      if (!frames.length) { onEnd(); return; }
      this.running = true;
      const t0 = frames[0].t;
      const wall0 = RE.now();
      let i = 0;
      const span = frames.length > 1 ? frames[frames.length - 1].t - t0 : 0;
      this.fps = span > 0 ? ((frames.length - 1) * 1000) / span : 0;
      const step = () => {
        if (!this.running) return;
        const elapsed = RE.now() - wall0;
        // shift timestamps onto the wall clock so time-based logic still works
        while (i < frames.length && frames[i].t - t0 <= elapsed) {
          onFrame(Object.assign({}, frames[i], { t: wall0 + (frames[i].t - t0) }));
          i++;
        }
        if (i >= frames.length) { this.running = false; onEnd(); return; }
        this.timer = g.setTimeout(step, 8);
      };
      step();
    }
    stop() { this.running = false; g.clearTimeout(this.timer); }
  }
  RE.ReplayPoseSource = ReplayPoseSource;
})(globalThis);
