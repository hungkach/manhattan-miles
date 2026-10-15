# manhattan-miles

First-person walking game on Midtown's grid. Play: https://hungkach.github.io/manhattan-miles/

## Now playable (touch controls)

- Grid: 12th Ave to 1st Ave, 14th St to 59th St, at Manhattan's real block proportions (about 80 m uptown blocks, 180 to 280 m crosstown blocks). Buildings are generated, taller in Midtown.
- March to walk, high knees (or cadence over 150) to run, turn your shoulders to drift across the sidewalk (touch: drag the right zone).
- Point left or right any time on a block; the turn happens at the next corner. At the grid's edge you stop until you point.
- Both hands overhead turns you around.
- Walk to destinations at real intersections (Herald Square, Times Square, Grand Central, Columbus Circle and more). HUD shows the street sign, next cross street, distance to the corner, direction to the destination and a minimap.
- Movement runs at 3x real walking pace so blocks pass at a game pace; distance in the summary is city distance.
- Summary names the S&C payoff: aerobic base from marching, intervals from high knees.

## Camera mode

Runs on rep-engine 0.2.0: marching, high knees, pointing, turning around and torso turn drift all work on camera.

Add `?loco=engine` to the URL to try the milestone 5 prototype: movement runs on the engine's locomotion state machine, and you point at the corner itself (within 15 m) instead of anywhere on the block.

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
