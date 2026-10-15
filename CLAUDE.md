# Manhattan Miles: notes for Claude

First-person walking game on a Midtown grid (12th to 1st Ave, 14th to 59th St) at real block proportions: march to walk, high knees to run, steer by turning your shoulders like a steering wheel, walk to real destinations. Play: https://hungkach.github.io/manhattan-miles/

## How this repo works

- `src/index.html` is the game. Edit it, then `npm run build` writes the playable page to `index.html` at the repo root (GitHub Pages serves that). Commit both.
- `engine/` is a locked copy of rep-engine from `hungkach/body-arcade`; `engine/SOURCE.json` says which commit. Never edit `engine/` here. Engine changes happen in body-arcade, then this game takes them with `node scripts/update-engine.mjs ../body-arcade` when Mark chooses.
- `npm test` must pass before every push; it also fails if `index.html` is out of date with a fresh build.
- No dependencies. Single self-contained HTML file. Plain canvas.
- `window.__game` exposes state for headless browser checks.

## Engine contract

- Read `engine.signals()` each frame; subscribe with `engine.on(event)`. Never touch landmarks.
- Touch demo mode (`engine.enable_demo(container)`) must keep the game fully playable; it emits the same events as the camera.
- Engine spec: https://claude.ai/code/artifact/a394f929-94ab-43c0-b06c-4d4b2cc50559

## Hard constraints

- Phone or iPad only, no accessories; living room preset, phone propped about 4 ft away, knees-up framing.
- Fitness first: the game names its S&C payoff, matches a work-to-rest rhythm, sessions 10 to 20 minutes.
- Names stay neutral and fitness oriented.

## Working with Mark

- He tests on his phone and often works from mobile: short replies, lead with the answer, committed recommendations.
- Decision logic and pseudocode as Python if/elif/else blocks with instructions in comments.
- No em dashes and no all-caps emphasis in docs or chat; sentence case.

## Status and next steps

- Engine 0.3.0: four-cue step trigger (after Homecoming Hero) with warm-up tuning, `tv` back-camera preset, rails points that wait for the next intersection, `speech: false`, stick-figure-only overlay.
- Playable with touch and camera: free walking on streets and sidewalks (buildings block), steering-wheel torso turn, run, point for a quick 90 degree turn, turn around, destinations, street sign HUD, minimap, summary with S&C payoff.
- Setup modes (`SETUPS`): phone or tablet, upright or sideways (the device's actual orientation picks which), and TV (engine `tv` preset: back camera, ultra-wide when it can; `engine.camera()` says what opened and the spoken placement adapts).
- Voice: the engine is created with `speech: false`; the game's `say()` queue voices everything with 2 s gaps between instructions.
- Movement runs on `engine.locomotion()` in the free model (Mark's call after the TV test: a steering wheel, not rails). Hold a torso turn to keep turning (engine `locomotion.maxTurnRate`, 90 degrees a second at full turn), face front to go straight; marching or high knees set speed (times `T.speedScale`). Self-centering settles you onto a street's direction within 12 degrees when you stop steering. A point is a quick 90 degree turn via `set_facing`; turn around is the engine's +180. Running widens the view and says "Running".
- Camera setup: framing and baseline via `engine.calibrate(preset, { moveTest: false })`, then the game's own timed warm-up (march, turn left, turn right; `Warm` in src/index.html) over the engine's `DebugOverlay` (stick figure only; mid-walk a three-finger tap shows it with the signal panel). Each march round is captured (`capture_start('step', round)`) and `apply_capture()` tunes the step thresholds after it, so a round the defaults miss is caught in the next; tuned cues live in the engine profile. The warm-up clip is saved from the end screen. Headless check: `__game.runCamera(() => engine.start_replay(clip))` with a synthetic clip from body-arcade's `test/helpers/synth.mjs`.
- Next (roadmap): robustness across bodies in the engine, short returning-player setup, a real 10 to 20 minute session (route, spoken turn-by-turn, run intervals), then swap in Mark's existing street-by-street Manhattan map; subway, bus and taxi as fast travel and logged rest; combat mode after body-arcade milestone 4.
