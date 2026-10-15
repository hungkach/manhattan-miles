# manhattan-miles

First-person walking game on Midtown's grid. Play: https://hungkach.github.io/manhattan-miles/

## Now playable (touch controls)

- Grid: 12th Ave to 1st Ave, 14th St to 59th St, at Manhattan's real block proportions (about 80 m uptown blocks, 180 to 280 m crosstown blocks). Buildings are generated, taller in Midtown.
- March to walk, high knees (or cadence over 150) to run, turn your shoulders to steer like a steering wheel: hold the turn to keep turning, face front to go straight (touch: hold a drag on the right zone). You walk anywhere on the streets and sidewalks; buildings block you, and letting go near a street's direction settles you onto it. The pace readout under the timer shows walking or running and your steps per minute: marching faster walks faster (0.6 to 1.25 times walking pace), and high knees or 150+ steps per minute runs at 2.5 times walking pace.
- Point left or right for a quick 90 degree turn onto the cross street.
- Both hands overhead turns you around.
- Walk to destinations at real intersections (Herald Square, Times Square, Grand Central, Columbus Circle and more). HUD shows the street sign, next cross street, distance to the corner, direction to the destination and a minimap.
- Movement runs at 3x real walking pace so blocks pass at a game pace; distance in the summary is city distance.
- Summary names the S&C payoff: aerobic base from marching, intervals from high knees.

## Fights

Every minute and a half or so of walking, an opponent (later sometimes two) waits on the street ahead. Walk up to them and the fight starts: you lock on, they manage the range.

- Punch for real: jab, cross, hook, uppercut. Your gloves on screen follow your actual fists.
- Guard up (fists by your face) blocks. Slip your head off the center line to dodge a straight and land a counter.
- When they shoot for your legs (they glow low and you hear "Sprawl"), squat to sprawl, then hit them while they recover.
- When they step back, march in place to close in.
- Squat then drive up fast for a double leg takedown, then stay low and strike down. Stand up and they scramble free.
- Three seconds of high knees escapes.

Fights run about 20 to 40 seconds; the walking between them is the active recovery. Touch play swaps to fight buttons during a fight.

## Camera mode

Pick a camera setup on the title screen: phone or tablet, upright or sideways (auto-picked, remembered). Standing the device the other way switches to the matching setup. Each setup has its own placement line and distance. The TV setup uses the back camera (the ultra-wide lens when the browser offers it) with the screen mirrored to the TV; without a back camera it falls back to the front camera and says so.

Every camera session starts with a one minute setup, like Homecoming Hero's:

1. Framing check and a 3 second stand-still baseline, on the full camera view with the engine's stick figure on top.
2. Warm-up, two rounds: march (8 s, then 6 s), turn your shoulders left, turn right. Each move shows big words, one line on how to do it, a timer bar, a looping figure (mirrored, so "left" moves to your left) and live feedback (steps seen, turn percent). Anything still missed gets a short third round, then the walk starts by itself.
3. Each march round tunes the engine's step thresholds to your own steps (half of your weakest round), so if round 1 counts nothing, round 2 usually does; you hear "I tuned to your steps". The tuning is saved for this setup.

Spoken instructions wait their turn and leave 2 s between lines, so you have time to move the phone or step back; a move's timer starts once its instruction has been said. Everything is spoken, since the screen is hard to read from 4 ft: each move, a count of detected steps (one, two, three, got it), a nudge when nothing registers (knees higher, turn further), "step back" whenever the camera loses your knees (also during the walk), and a full result at the end.

The warm-up records up to 28 s of camera landmarks. After the walk, "Save warm-up clip" downloads it so the engine can be tuned on real data. During the walk, a three-finger tap shows the stick figure again.

Runs on rep-engine 0.2.0: marching, high knees, pointing, turning around and torso turn drift all work on camera.

## Not built yet

- The existing street-by-street Manhattan map (swap in for the generated grid).
- Subway, bus and taxi as fast travel and logged rest.
- Combat mode, NPCs, traffic.
- Locomotion still lives in the game; body-arcade milestone 5 moves it onto the engine's locomotion state machine (`engine.locomotion()`).

## Repo layout

| Path | What it is |
| --- | --- |
| `src/index.html` | The game source |
| `index.html` | Built, playable page (GitHub Pages serves it) |
| `engine/` | Locked copy of rep-engine; `engine/SOURCE.json` names the body-arcade commit |
| `build/build.mjs` | Inlines the engine into `src/index.html` and writes `index.html` |
| `scripts/update-engine.mjs` | Takes a newer engine from a body-arcade checkout, then rebuilds |
| `test/` | Build and engine checks |

```
npm run build                      # rebuild index.html after editing src/
npm test                           # must pass before pushing
npm run update-engine ../body-arcade   # take engine updates, only when you choose
```
