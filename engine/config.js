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
      camera: { idealWidth: 1280, idealHeight: 720, wideWidth: 1920, wideHeight: 1440 }, // wide: the front camera's whole 4:3 picture (0.17.0)
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
          pitch: { on: 20, off: 10 },     // world: thigh angle from the calibrated vertical (degrees), above the other thigh's
          lift: { on: 0.12, off: 0.06 },  // world: knee height above standing (T), above the other knee's
          rise: { on: 0.12, off: 0.05 },  // image: knee height above its standing spot (T)
          lead: { on: 0.11, off: 0.04 },  // image: this knee's rise minus the other knee's (T)
        },
        need: 2,
        refractoryMs: 250,   // per leg, after it fires
        sameLegMinMs: 600,   // a same-leg repeat counts only after this gap (legs alternate)
        // Warm-up tuning (engine.apply_capture): each cue's on is set to tuneFrac of
        // the weakest captured round that reached seenFrac of the default on, kept
        // within [minFrac, maxFrac] of the default; off goes to half of that.
        tune: { tuneFrac: 0.4, seenFrac: 0.5, minFrac: 0.35, maxFrac: 1.5 }, // 0.6.0: 0.4 of the weakest round, room for tired knees
        // stride from knee height (0.6.0, Mark: higher knees, longer strides; a
        // tired player's lower knees still count, they just step shorter): each
        // step's peak thigh angle over refPitch, or peak knee lift over refLift,
        // averaged over the last `steps` steps, maps to a stride of min to max
        stride: { refPitch: 50, refLift: 0.3, gain: 1.5, min: 0.7, max: 2.2, steps: 4 }, // 0.18.0: 1 at a march, up to max for high knees
        squatPauseDrop: 0.2, // squat beats march: hip drop (T) past this pauses stepping
        liftSource: 'auto',  // 'auto' uses world landmarks when the profile has them, 'image' forces 2D
        cadenceWindowMs: 3000,
      },
      run: {
        lift: 0.5,      // peak knee lift (T) of a high-knee step (0.18.0: was 0.35, which a long-legged march reached; high knees lift about 0.8)
        pitch: 65,      // or peak thigh angle (degrees) of a high-knee step
        // 0.8.4 (Mark 10/19: high knees intervals read as 1 or 2 s of running): tired high knees
        // run 130 to 150 steps a minute, under the old 150; knee height is what makes it a run
        cadence: 100,   // steps per minute between high-knee steps to start a run (0.18.0, was 120)
        startSteps: 2,  // consecutive high-knee steps that start a run
        exitMs: 800,    // run ends after this long with no high-knee step (was 600)
        exitIntervals: 1.6, // or this many of its own step gaps, at a slower pace (0.18.0)
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
        raisedHoldMs: 600,   // and this long after a raised (waving) hand comes down
        raisedOut: -0.05,    // shoulder widths along the shoulder line: a raised wrist counts only out at its shoulder or wider (a guard is inside)
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
          // 0.9.0: a fast move out from a set hand toward the camera, judged where it ends
          // (StrikeDetector in combat.js). Meters and m/s scale with arm length (armScale).
          windowMs: 600,     // a move is given up (or guessed) after this long
          hipSpeed: 1.2,     // S/s: the hips moving sideways this fast (a bound) start no punch and drop one in progress (0.12.2)
          hipQuietMs: 250,   // and for this long after
          refractoryMs: 200, // per hand (spec: 200 ms jab/cross)
          setBelow: 0.3,     // m: a set hand's wrist no lower than this under its shoulder
          setWide: 0.4,      // m: and within this of the body's middle (not out to the side)
          setAngle: 130,     // degrees: and the elbow bent at least this much
          elbowDown: 0.12,   // m: with the elbow this far under its shoulder (a guard, not an arm swing)
          stillSpeed: 0.6,   // m/s: and still
          setMs: 70,         // for this long
          setWithinMs: 400,  // the punch starts within this long of the hand being set
          setReturn: 0.08,   // m: after a punch, back within this of where it was set (and slowing, under 2x stillSpeed) is set again
          setTravel: 0.15,   // m the fist moves from where it was set
          minSpeed: 1.6,     // m/s peak fist speed
          stopFrac: 0.35,    // a kind is judged when the fist slows under this share of its peak speed
          frontMin: 0.12,    // m: the far end is at least this far in front of its shoulder
          straightOn: 145,   // degrees: a straight ends with the elbow this straight
          fwdGain: 0.12,     // m nearer the camera than where it was set
          straightBelow: 0.15, // m: a straight lower than this under the shoulder is judged when the hand comes back
          upperRise: 0.12,   // m an uppercut rises from its lowest point
          upperShare: 0.75,  // mostly upward
          upperDip: 0.06,    // m: after dipping at least this far under where it was set, elbow bent
          upperLowest: 0.45, // m: but no lower than this under the shoulder (a hanging arm raised is not an uppercut)
          upperTo: 0.2,      // m: ending no lower than this under the shoulder
          hookTravel: 0.1,   // m a hook sweeps inward from its outermost point
          hookAngle: 150,    // degrees: hooks and uppercuts keep the elbow bent under this
          hookFront: 0.05,   // m in front of the shoulder (torso frame)
          hookHeight: 0.3,   // m: a hook stays within this of shoulder height
          fwdGuess: 0.1,     // m toward the camera: anything else thrown this far is a straight
          downDrop: 0.15,    // T hip drop: crouched, for down strikes
          downBelow: 0.3,    // m below the shoulder
          downTravel: 0.15,  // m down from where it was set
          downSpeed: 1.2,    // m/s downward
          refSpeed: 5,       // m/s of fist speed that is power 1
          overhand: true,    // a hook from the rear hand is 'overhand' (0.8.0)
        },
        punch: {
          // 0.14.0: a hand out of its guard is a punch (PunchDetector in combat.js), landed on the
          // way out. Meters and m/s scale with arm length (armScale).
          // 0.18.0 (Mark 10/24: "the middle zone should be just enough for the fighting stance, any fist
          // that comes out of it is a strike, narrow enough that it detects first from leaving"): the zone
          // is one fist around each fist's guard spot, and a punch lands as it leaves (exitMs), not at full reach
          dead: 0.1,         // m: the zone around home, about one fist (was 0.15)
          // 0.21.0 (Mark 10/25: "the player is a pillar; any hand that leaves the body outside a deadzone is a
          // strike"): the zone is a column around the body, `dead` past the farther guard fist in front and past
          // the shoulders (or the wider guard fist) at the sides; moving down or back inside it is not a punch
          pillar: true,
          pillarSide: 0.5,   // S: the pillar's sides before the room, the shoulders
          stallSpeed: 0.5,   // m/s: a trip that slows under this inside the pillar is over, no punch
          rearmSpeed: 0.8,   // m/s: back inside the pillar and slower than this, the hand is armed again
          farK: 2.5,         // or a fist this many zones from its guard spot and higher than it (a low guard's punch rises inside)
          farMin: 0.25,      // m: and at least this far
          fistM: 0.095,      // m: a fist's width; with a side camera the player sets the zone in fists on the phone (0.20.0)
          fireOnExit: true,  // land a punch as it leaves the zone (an uppercut still waits to rise)
          exitMs: 30,        // out of the zone this long first (0.21.0: was 50; a frame, once it is out of the pillar)
          dropK: 1.0,        // and leaving it more down than out (not rising as an uppercut) is the guard dropping
          exitElbow: 0.06,   // m: the elbow travels this far as the fist leaves (straights 0.12 and up, hooks 0.11 and up),
          exitExtend: 0.3,   // m: or the arm reaches this much farther; else a forearm swung out on a still elbow
          rearm: 0.1,        // m: back this near home re-arms the hand after a punch
          rearmFrac: 0.5,    // or back to this share of the last punch's farthest, and slowing
          leaveMs: 120,      // the fist crosses the dead zone within this long of being in it
          startSpeed: 1.0,   // m/s as it crosses
          minSpeed: 1.2,     // m/s peak (0.18.0: was 1.6; a tired punch out of the zone still counts)
          minFar: 0.2,       // m from home at its farthest
          frontMin: 0.1,     // m: somewhere in front of its shoulder
          lowest: 0.45,      // m: a hand lower than this under its shoulder is down, not punching
          minMs: 60,         // it lands no sooner than this after leaving
          maxMs: 450,        // and no later than this
          stopFrac: 0.4,     // when the fist slows under this share of its peak speed
          backFrac: 0.8,     // or is back to this share of its farthest
          rehomeMs: 250,     // after a punch, held still this long somewhere new makes that home
          extend: 0.14,      // m: the fist gets this much farther from its shoulder
          elbowMove: 0.1,    // m: or the elbow travels this far (a forearm wiping on a still elbow is not a punch)
          straightDip: 0.05, // m: a straight dips no more than this first (an uppercut dips 0.08 and more)
          straightFlare: 0.078, // m: and its elbow swings out sideways no more than this (a hook's 0.083 and more; 0.21.0: was 0.07, a rear straight read from rest swings 0.072)
          pathPoints: 8,     // points in a punch's path (0.16.0)
          wideOut: 0.35,     // S: a fist this far out to the side of where it left, elbow swung out, is a hook winding up
          sweepIn: 0.12,     // S: it lands once it has swept back in this far from its widest
          upRise: 0.06,      // m: a round punch that rises this far from its lowest point, elbow in, is an uppercut ('up')
          refractoryMs: 250, // per hand after a punch lands (a fist settling back into the guard is not another)
        },
        // kicks and knees (0.11.0, KickDetector in combat.js), from the thigh and the knee
        kick: {
          onPitch: 30,      // degrees of thigh angle: a leg is up
          offPitch: 18,     // and back down
          downFrac: 0.6,    // judged on the way down, once under this share of its peak
          maxMs: 1200,      // a kick is up for less than this
          plantMs: 450,     // the other leg made no step this long before the kick
          afterMs: 150,     // or this long after it (judged then)
          lowPitch: 25,     // a low kick: the rear thigh this high
          sweep: 0.2,       // with the knee sweeping this far (S) toward the lead side
          teepPitch: 55,    // a teep: the lead thigh this high
          kneePitch: 60,    // a knee: the rear thigh this high, straight up
          refRate: 300,     // degrees a second of thigh rise that is power 1
          liftPerDeg: 0.007, // T of knee rise per degree, when the world landmarks are missing
        },
        // taught strikes (0.10.0, StrikeDetector in combat.js): samples of the player's own punches
        teach: {
          keep: 6,           // samples kept per punch and hand (the newest)
          points: 8,         // a sample's path resampled to this many points
          backFrac: 0.7,     // a punch is over once the fist is back to this share of its farthest reach
          earlyTol: 0.12,    // or, as the fist slows at full reach, a match this close
          earlyGap: 2.5,     // with every other punch at least this many times farther
          angleW: 0.3,       // weight of the elbow angle in a sample (arm lengths per 180 degrees)
          tol: 0.3,          // a move within this of a sample (rms, arm lengths) is that punch
          fallbackK: 1.2,    // the rules' read of a taught punch counts within this times tol
          mirrorK: 1.15,     // the other hand's samples, mirrored, count a bit farther away
          lenRatio: [0.5, 2], // a sample only matches a path between these times its length
          startSpeed: 1.2,   // m/s: while teaching, a move starts here from rest (no guard needed)
          calmMs: 300,       // from a rest within this long
          minSpeed: 1.0,     // m/s peak, for a sample to count
          minMs: 150,        // a sample ends back at rest (backM, m) after at least this long
          backM: 0.12,
          maxMs: 800,        // or after this long
          guardTol: 0.15,    // m: a hand this near its learned guard is set
          guardFrames: 10,   // still frames needed to learn a hand's guard
        },
        // arm depth from foreshortening (ArmDepth in combat.js)
        depth: {
          decay: 0.02,    // m/s the reference segment length shrinks back
          inPlane: 0.88,  // a segment at least this share of its reference reads as in the image plane
          behind: 0.05,   // m: world depth saying the segment points back this much is kept
          minLen: 0.15, maxLen: 0.42, // m, reference length bounds
          fovDeg: 75,     // camera field of view on the long side of the frame (front cameras run 65 to 80)
        },
        slip: {
          deadzone: 0.25,  // S, nose off the hip midpoint
          full: 0.55,
          eventLevel: 0.5,
          eventReset: 0.2,
        },
        // a bound out to one side and back (0.8.0): hip midpoint in S from where it was at calibration
        bound: {
          center: 0.35,  // S: starts from within this of the middle
          out: 0.9,      // S: gets this far to one side
          outMs: 600,    // within this long of leaving the middle
          back: 0.4,     // S: and comes back within this of the middle
          backMs: 900,   // within this long of its furthest point
        },
        // head movement (0.13.0): a weave is a U from one side, down, up to the other side.
        // side (S): the nose this far across from the hips (a slip reads from 0.25); low (T):
        // the shoulders this far below standing; legMs: each half of the U; maxMs: the whole;
        // holdMs: still weaving this long after it ends
        weave: { side: 0.3, low: 0.15, legMs: 700, maxMs: 1600, holdMs: 400 },
        level: {
          squat: 0.3,      // T level drop that is a squat (spec 0.35; 0.4.2 eased for a fighting crouch)
          reset: 0.15,     // T: re-arms above this (spec)
          speedMs: 400,    // squat speed measured over this long
          rise: 0.2,       // T the level comes back up for a drive up
          driveMs: 400,    // within this long (spec: 0.35 T in 400 ms), however long the squat was held; a slow stand is not a drive
          holdFrac: 0.8,   // a squat counts as held while the level stays past this share of squat
          jump: 0.2,       // T above standing that is a jump (a hop off the floor); 0.8.4: was 0.12, which a fast drive up onto the toes reached (Mark: takedowns with no jump)
        },
        fight: {
          jumpWaitMs: 300,   // after a drive up, how long a jump can still add to the shot
          weaveJumpMs: 300,  // 0.13.0: a jump while weaving, or this long after, is the shot
          // 0.7.0 (Mark: the squat is the level change, the jump is the takedown): with
          // requireJump only a jump off the drive up shoots; a drive up with no jump inside
          // requireJumpWaitMs is just a 'level_change'
          requireJump: false,
          requireJumpWaitMs: 500,
          refRise: 2.0,      // T/s of drive up speed that is shot power 1 (a 0.4 s rise out of a 0.6 T squat is about 1.8)
          jumpBonus: 0.5,    // shot power a jump off the drive adds
          gnpMs: [2000, 5000], // the ground and pound burst, weakest to strongest takedown
          escapeMs: 3000,    // high knees this long escapes the fight (spec)
        },
      },
      // Speeds are in world units per second; games scale them to their world.
      locomotion: {
        // 0.18.0 (Mark: speed is stride times how often): one speed from walk to run, walkSpeed times
        // cadence over refCadence (within walkScale) times the stride (march.stride: 1 at a march, up
        // to 2.2 for high knees); 'run' is the state while the knees stay high
        walkSpeed: 1.4,
        walkCadence: 70,       // below this cadence the player stops
        refCadence: 110,       // cadence that gives exactly walkSpeed
        walkScale: [0.8, 1.6], // the cadence part of speed, as a multiple of walkSpeed (1.6 at 176 a minute)
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
        squatHoldMs: 1500, // the demo squat button holds a squat this long (touch cannot hold a crouch)
        weaveMs: 900,      // 0.13.0: a demo weave counts as weaving this long (a jump in it is the shot)
      },
      // a second camera at the side (0.12.0, side.js): a sample is fresh for maxAgeMs; without
      // a clock sync it is taken to be leadMs older than its arrival (the link's delay); landmarks below
      // minVis are not used; the arms are swapped to match the main camera's when that fits
      // swapMargin (T) better on average
      // alignMs: the main frame used with a side frame is at most this far from it in time
      // swapFrames: frames of wrist height evidence averaged; flipMargin (T): the other pairing of
      // the phone's labels has to fit each fist's (or knee's) predicted place by this much better
      // peer: PeerJS options for the signaling server (null: PeerJS's free public one)
      // standPitch, standMs, standFrames (0.12.1): the side's standing hip height and thigh angle
      // come from frames with both thighs within standPitch degrees of straight down, the last
      // standMs, at least standFrames of them
      side: { maxAgeMs: 180, leadMs: 40, minVis: 0.5, swapMargin: 0.12, swapFrames: 12, flipMargin: 0, alignMs: 25, standPitch: 12, standMs: 20000, standFrames: 15, peer: null,
        // the zone the player should stand in, in picture fractions (RE.sideZone, 0.14.1): head to
        // knees at least minH of the height (about 2.5 m away on a phone's front camera)
        zone: { x0: 0.12, x1: 0.88, y0: 0.04, y1: 0.96, minH: 0.25, cy0: 0.32, cy1: 0.68, minVis: 0.5 },
        // the stance box the side phone draws (0.20.0, RE.SideBox): the room in front of the lead fist
        // and behind the rear one, in fists (the player sets it on the phone; it sizes the punch zone)
        box: { fists: 1.5, minFists: 0.5, maxFists: 4, fistT: 0.2, restSpeed: 0.6, restK: 0.15, headT: 0.45 } },
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
    // Front camera, its widest view (0.17.0): the whole 4:3 picture, zoomed all the way out where the
    // browser allows (an iPad's front camera is an ultra-wide). Its own calibration profile.
    front_wide: { id: 'front_wide', label: 'Front camera, widest', facingMode: 'user', wideLens: true, mirrorDisplay: true, distanceFt: 4 },
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
