# Manhattan Miles: notes for Claude

First-person walking game on a Midtown grid (12th to 1st Ave, 14th to 59th St) at real block proportions: march to walk, high knees to run, point to turn at the next corner, walk to real destinations. Play: https://hungkach.github.io/manhattan-miles/

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

- Engine 0.2.0: step, run, point, turn_around and torso turn all work on camera and in demo mode.
- Playable with touch and camera: sidewalk rails, run, torso turn drifts you across the sidewalk (`signals().turn`), queued turns at corners, turn around, destinations, street sign HUD, minimap, summary with S&C payoff.
- Next: body-arcade milestone 5 moves this game's locomotion onto `engine.locomotion()` with `set_movement({ rails: true, at_intersection, branch_bearing })`; swap in Mark's existing street-by-street Manhattan map; subway, bus and taxi as fast travel and logged rest; combat mode after body-arcade milestone 4.
