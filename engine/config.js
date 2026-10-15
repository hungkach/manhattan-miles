// Every tunable number lives here. A player profile stores only overrides.
// Values are starting points from the spec, not tested results.
(function (g) {
  'use strict';
  const RE = g.RepEngine;

  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1';

  RE.defaultConfig = function () {
    return {
      pose: {
        moduleUrl: MP + '/vision_bundle.mjs',
        wasmBase: MP + '/wasm',
        modelUrl: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU', // falls back to CPU automatically if GPU init fails
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      },
      camera: { idealWidth: 1280, idealHeight: 720 },
      // One Euro in body units (S per second). beta 2 keeps lag near 50 ms on a
      // marching knee with rest jitter about the same as beta 0.02 (which lagged
      // 100 to 140 ms); fast wrists get a higher cutoff still, so strikes lag less.
      smoothing: { minCutoff: 1.0, beta: 2.0, dCutoff: 1.0, worldUnit: 0.4, worldFollow: [13, 14, 15, 16] },
      visibility: {
        hold: 0.5,    // below this a landmark holds its last value
        framing: 0.6, // required landmarks must beat this to pass framing
      },
      calibration: {
        framingHoldMs: 1000,
        baselineMs: 3000,
        frameMargin: 0.02,   // landmarks this close to the edge count as out of frame
        driftRatio: 0.15,    // shoulder width change that suggests re-baseline
        driftHoldMs: 3000,
      },
      signals: {
        squatFullDrop: 0.5, // hip drop (in T) that reads as squat_depth 1
      },
      // Lengths in body units: S = shoulder width, T = torso length.
      // March steps: four cues per leg, after Homecoming Hero's step trigger.
      // A leg steps when `need` of its known cues pass `on`, and re-arms when
      // `need` drop below `off`; a cue whose landmarks are not visible is
      // unknown and counts neither way. Two cues read 3D world landmarks and
      // two read the 2D image, so either source can carry a step alone.
      march: {
        cues: {
          pitch: { on: 25, off: 12 },     // world: thigh angle from the calibrated vertical (degrees), above the other thigh's
          lift: { on: 0.15, off: 0.08 },  // world: knee height above standing (T), above the other knee's
          rise: { on: 0.16, off: 0.07 },  // image: knee height above its standing spot (T)
          lead: { on: 0.14, off: 0.05 },  // image: this knee's rise minus the other knee's (T)
        },
        need: 2,
        refractoryMs: 250,   // per leg, after it fires
        sameLegMinMs: 600,   // a same-leg repeat counts only after this gap (legs alternate)
        // Warm-up tuning (engine.apply_capture): each cue's on is set to tuneFrac of
        // the weakest captured round that reached seenFrac of the default on, kept
        // within [minFrac, maxFrac] of the default; off goes to half of that.
        tune: { tuneFrac: 0.5, seenFrac: 0.5, minFrac: 0.4, maxFrac: 1.5 },
        squatPauseDrop: 0.2, // squat beats march: hip drop (T) past this pauses stepping
        liftSource: 'auto',  // 'auto' uses world landmarks when the profile has them, 'image' forces 2D
        cadenceWindowMs: 3000,
      },
      run: {
        lift: 0.35,     // peak knee lift (T) of a high-knee step
        pitch: 65,      // or peak thigh angle (degrees) of a high-knee step
        cadence: 150,   // steps per minute between high-knee steps
        startSteps: 2,  // consecutive high-knee steps that start a run
        exitMs: 600,    // run ends after this long with no high-knee step
      },
      // Torso turn steering: yaw from (shoulder width / torso length) against
      // the calibrated ratio, direction from shoulder depth and the nose.
      turn: {
        deadzone: 15,     // degrees of torso yaw that still mean straight ahead
        full: 45,         // degrees that give full turn rate
        depthMin: 0.1,    // shoulder depth difference / shoulder width that gives a direction (about 6 degrees)
        noseMin: 0.04,    // S, nose offset from the shoulder midpoint that gives a direction
        eventLevel: 0.5,  // turn level that fires turn_left / turn_right
        eventReset: 0.2,
      },
      // Lean is still measured (the lean signal), but turn steers.
      lean: {
        deadzone: 0.06,      // S
        full: 0.25,          // S, lean that reads as 1
        // S per second; faster wrists suppress turn and lean (punches never
        // steer). The spec's 2 S/s cut steering on every arm swing once the
        // torso is turned (swing then moves sideways in the image: up to 4 S/s
        // marching, 11 S/s high knees); swipes peak at 35 S/s and up.
        wristSpeedMax: 12,
        suppressHoldMs: 250, // steering stays off this long after the wrists slow down
        eventLevel: 0.5,     // steering level that fires lean_left / lean_right
        eventReset: 0.2,     // steering must return below this to fire again
      },
      point: {
        wristOut: 0.8,    // S, wrist sideways past its shoulder
        elbowMin: 150,    // degrees, near straight
        maxBelow: 0.6,    // T, wrist may sit at most this far below its shoulder
        maxWristSpeed: 1.0, // S per second; the pointing hand must be still
        holdMs: 300,
        cooldownMs: 1000,
      },
      turnAround: {
        aboveNose: 0.3, // T, both wrists this far above the nose
        holdMs: 500,
        cooldownMs: 2000,
      },
      wave: {
        minSwing: 0.15,  // S, sideways wrist travel that counts as one direction change
        minAbove: 0.25,  // T, wrist this far above its shoulder (a swipe at shoulder height is not a wave)
        reversals: 2,
        windowMs: 1000,
        cooldownMs: 2000,
      },
      effort: {
        fullCadence: 170, // cadence that reads as full effort
        fullLift: 0.6,    // knee lift (T) that reads as full effort
      },
      // Combat module (combat.js). Distances in meters unless marked S or T.
      combat: {
        guard: {
          near: 0.85,      // S, each wrist this close to the nose (2D, T scaled to S)
          below: 0.35,     // T, and no lower than this under the shoulder line
          holdMs: 150,     // both hands there this long raises the guard
          release: 1.35,   // a hand must leave near * release to count as away
          punchMs: 700,    // a hand away this briefly (a punch) keeps the guard up
        },
        stance: {
          minYaw: 10,      // degrees of torso turn that blade the stance
          handLead: 0.25,  // S, with a square torso, lead hand this far in front decides
          holdMs: 500,
        },
        strike: {
          windowMs: 350,     // history a strike is judged over
          velMs: 100,        // velocity over this long
          refractoryMs: 200, // per hand (spec: 200 ms jab/cross)
          guardLeadMs: 120,  // the hand was at the guard at least this long before the strike fires (within the window)
          rearm: 130,        // degrees: after a straight the elbow must bend below this again
          straightOn: 150,   // degrees: straight punch ends with the elbow this straight
          bentMax: 115,      // degrees: having been this bent inside the window
          reach: 0.55,       // fist in front of its shoulder by this share of arm length
          fwdGain: 0.18,     // m the fist travelled toward the camera inside the window
          bentMax2: 135,     // degrees: hooks and uppercuts keep the elbow bent
          hookHeight: 0.3,   // m from shoulder height
          hookFront: 0.1,    // m in front of the shoulder
          hookSpeed: 1.8,    // m/s along the arc, sweeping inward
          hookTravel: 0.15,  // m inward inside the window
          hookElbow: 0.15,   // m: the elbow no lower than this under the shoulder
          hookElbowOut: 0.05, // m: and out to the side of it
          afterStraightMs: 400, // no hook or uppercut from a hand pulling a straight back
          upperSpeed: 2.0,   // m/s upward
          upperFrom: 0.25,   // m below the shoulder at the start
          upperTo: 0.15,     // m below the shoulder or higher at the end
          downDrop: 0.15,    // T hip drop: crouched, for down strikes
          downBelow: 0.3,    // m below the shoulder
          downSpeed: 1.2,    // m/s downward
          refSpeed: 5,       // m/s of fist speed that is power 1
        },
        slip: {
          deadzone: 0.25,  // S, nose off the hip midpoint
          full: 0.55,
          eventLevel: 0.5,
          eventReset: 0.2,
        },
        level: {
          squat: 0.35,     // T hip drop that is a squat (spec)
          reset: 0.15,     // T: re-arms above this (spec)
          speedMs: 400,    // squat speed measured over this long
          rise: 0.25,      // T the hips come back up for a drive up
          driveMs: 400,    // within this long of the bottom (spec: 0.35 T in 400 ms)
        },
        fight: {
          shotMs: 800,       // drive up within this long of the shot (spec)
          topDepth: 0.2,     // squat depth that holds the top position (spec)
          scrambleMs: 300,   // standing out of it this long lets them scramble
          escapeMs: 3000,    // high knees this long escapes the fight (spec)
        },
      },
      // Speeds are in world units per second; games scale them to their world.
      locomotion: {
        walkSpeed: 1.4,
        runSpeed: 3.5,
        walkCadence: 70,       // below this cadence the player stops
        refCadence: 110,       // cadence that gives exactly walkSpeed
        walkScale: [0.8, 1.2], // walk speed range as a multiple of walkSpeed
        rampMs: 300,           // speed reaches its target over this long
        stopMs: 400,           // coast to a stop over this long
        stopAfterMs: 600,      // no step for this long (or 1.5 step intervals, if longer) stops you
        stopIntervals: 1.5,
        maxTurnRate: 90,       // degrees per second at full turn (free movement)
      },
      demo: {
        doubleTapMs: 350,
        runHoldMs: 250,
        runCadence: 170,
        cadenceWindowMs: 3000,
        topHoldMs: 6000,   // after a drive up, the demo holds a half squat this long
      },
      recorder: { maxMs: 30000, decimals: 4 },
      overlay: { eventLogSize: 10 },
    };
  };

  // Camera presets. mirrorDisplay only flips what the player sees; the math
  // uses anatomical sides, so it never depends on mirroring.
  RE.presets = Object.freeze({
    living_room: { id: 'living_room', label: 'Living room', facingMode: 'user', mirrorDisplay: true, distanceFt: 4 },
    garage: { id: 'garage', label: 'Garage', facingMode: 'user', mirrorDisplay: true, distanceFt: 6 },
    custom: { id: 'custom', label: 'Custom', facingMode: 'user', mirrorDisplay: true, distanceFt: null },
    // Back camera, screen mirrored to a TV. Prefers the ultra-wide lens (or the
    // widest zoom), falls back to the main back camera, then the front camera.
    tv: { id: 'tv', label: 'TV, back camera', facingMode: 'environment', wideLens: true, mirrorDisplay: true, distanceFt: 6 },
  });

  // Deep merge for config overrides (plain objects only).
  RE.mergeConfig = function merge(base, overrides) {
    if (!overrides) return base;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const key of Object.keys(overrides)) {
      const b = base ? base[key] : undefined;
      const o = overrides[key];
      out[key] = b && o && typeof b === 'object' && typeof o === 'object' && !Array.isArray(o)
        ? merge(b, o)
        : o;
    }
    return out;
  };
})(globalThis);
