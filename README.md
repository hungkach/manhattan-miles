# manhattan-miles

First-person walking game on Midtown's grid. Play: https://hungkach.github.io/manhattan-miles/

## Now playable (touch controls)

- Grid: 12th Ave to 1st Ave, 14th St to 59th St, at Manhattan's real block proportions (about 80 m uptown blocks, 180 to 280 m crosstown blocks). Buildings are generated, taller in Midtown.
- March to walk, high knees (or cadence over 150) to run, turn your shoulders to steer like a steering wheel: hold the turn to keep turning, face front to go straight (touch: hold a drag on the right zone). You walk anywhere on the streets and sidewalks; buildings block you, and letting go near a street's direction settles you onto it. The pace readout under the timer shows walking or running and your steps per minute: marching faster walks faster (0.6 to 1.25 times walking pace), and high knees or 150+ steps per minute runs at 2.5 times walking pace.
- Point left or right for a quick 90 degree turn onto the cross street.
- Both hands overhead turns you around.
- No countdown: explore. There is always a next stop at a real intersection (Herald Square, Times Square, Grand Central, Columbus Circle and more), about a solid walk away. Directions are spoken as you near each corner ("At 7th Ave, turn left", "Turn left here", or "Wrong way"), and the HUD shows the stop, blocks to go and the next turn. Every two minutes of walking a 30 s high knees interval is called, with a countdown bar; walking is the recovery. The clock counts active minutes (moving or fighting); standing around gets a nudge, and 10, 15, 20 and 30 active minutes get a line (20 is a full session, the fitness target).
- Speed is cadence times stride: faster knees step faster, higher knees step longer (the HUD shows your stride). Tired, lower knees still count; they just step shorter.
- Wave your left hand to open the phone (touch: the Phone button): turn your shoulders to move the highlight, wave your right hand to pick, your left to close. Back to the walk, police radio, repeat directions, skip this stop, end session. The walk and the clock pause while it is open.
- Police radio (phone menu): dispatch puts out a crime in progress at a corner a few blocks away, with a time limit you need some high knees to beat. Directions switch to the call; get there in time and the fight is on the corner, and afterwards two officers walk up and take it from there. Miss it and another unit got it. Police are allies here: generic uniforms, no department names, and the jokes are on you.
- Subway: at a station entrance (real Midtown stations: Herald Sq, Penn Station, Times Sq, Port Authority, Bryant Park, Grand Central, Rockefeller Ctr, Columbus Circle, Lexington Av-59 St, 23 St, Union Sq, 8 Av-14 St) the phone offers the subway. Pick a station (the one nearest your stop is first), march in place on the platform while you wait, then ride: the ride is logged rest. Train times are rough for now; real schedules come with the real map.
- Levels: XP for active minutes, stops, intervals, fights, takedowns, guard breaks, police calls and saying hi. Each level brings a title (Tourist, Commuter, Bodega Regular ... King of New York) and tougher opponents (more health, quicker punches, pairs sooner). Progress and lifetime totals are saved on the device.
- Pedestrians walk the sidewalks. Wave your right hand at someone a few meters ahead (touch: the Wave button) and they stop, wave back and say something.
- Movement runs at 3x real walking pace so blocks pass at a game pace; distance in the summary is city distance.
- Summary names the S&C payoff: aerobic base from marching, intervals from high knees.

## Fights

Every minute and a half or so of walking, an opponent (later sometimes two) waits on the street ahead. Walk up to them and the fight starts: you lock on, they manage the range.

- Punch for real: jab, cross, hook, uppercut. Your gloves on screen follow your actual fists, and a glove that drives fast onto their head or body lands, with a burst, a thump and their head snapping back. Body shots get through a high guard.
- Guard up (fists by your face) blocks. Hooks come from either side (watch which hand glows): the hand on that side up by your ear is enough to block one. Slip your head off the center line to dodge a straight and land a counter.
- Squat to change levels. Holding the squat defends: when they shoot for your legs (they glow low and you hear "Sprawl"), you sprawl, then hit them while they recover.
- When they step back you can't reach them; they step back in on their own a moment later.
- Drive up out of the squat for a double leg. The faster you drive, the longer your ground and pound (2 to 5 s, no aiming: any fast punch lands); jump off the drive for the biggest takedown. Shoot while they wind up a punch for a longer one.
- Hold the crouch too long and they read it: they brace, and a plain drive gets stuffed. Jump into it, or catch them low with an uppercut (double damage).
- Straights reach further but hit softer. Hooks hit hardest but only land close, so throw them when they step in to punch. Uppercuts dig into the body.
- Some opponents just cover up. Body shots, hooks and uppercuts go around the guard; straights wear it down until it breaks.
- Three seconds of high knees escapes.
- Every opponent is hassling someone. A crowd gathers and films on their phones; a beaten opponent may run off instead of going down; afterwards the person you helped thanks you or roasts you (the humor is blue), and the crowd cheers a knockout.

The fighters are 3D: the opponent is a jointed figure that moves between guard, punches, shots and falls, and your own arms come up from the bottom of the screen, following your real shoulders, elbows and fists. Your view follows your body: a slip moves and tilts it, a squat drops it, a double leg lunges it in at their hips, and on top you look down at them.

Fights run about 20 to 40 seconds; the walking between them is the active recovery. Touch play swaps to fight buttons during a fight.

## Camera mode

Pick a camera setup on the title screen: phone or tablet, upright or sideways (auto-picked, remembered). Standing the device the other way switches to the matching setup. Each setup has its own placement line and distance. The TV setup uses the back camera (the ultra-wide lens when the browser offers it) with the screen mirrored to the TV; without a back camera it falls back to the front camera and says so.

Every camera session starts with a one minute setup, like Homecoming Hero's (returning players, whose marching a warm-up on this setup already saw, get a quick check instead: framing, then one march round; a miss runs the full warm-up, and the "Full warm-up" box forces it):

1. Framing check and a 3 second stand-still baseline, on the full camera view with the engine's stick figure on top.
2. Warm-up, two rounds: march (8 s, then 6 s), turn your shoulders left, turn right. Each move shows big words, one line on how to do it, a timer bar, a looping figure (mirrored, so "left" moves to your left) and live feedback (steps seen, turn percent). Anything still missed gets a short third round, then the walk starts by itself.
3. Each march round tunes the engine's step thresholds to your own steps (half of your weakest round), so if round 1 counts nothing, round 2 usually does; you hear "I tuned to your steps". The tuning is saved for this setup.

Spoken instructions wait their turn and leave 2 s between lines, so you have time to move the phone or step back; a move's timer starts once its instruction has been said. Everything is spoken, since the screen is hard to read from 4 ft: each move, a count of detected steps (one, two, three, got it), a nudge when nothing registers (knees higher, turn further), "step back" whenever the camera loses your knees (also during the walk), and a full result at the end.

The warm-up records up to 28 s of camera landmarks, and so does the start of each camera fight. After the walk, "Save warm-up clip" and "Save fight clip" download them so the engine can be tuned on real data. In a fight, the level bar on the left shows how low you are and the mark a shot needs. During the walk, a three-finger tap shows the stick figure again.

Runs on rep-engine 0.2.0: marching, high knees, pointing, turning around and torso turn drift all work on camera.

## Not built yet

- The existing street-by-street Manhattan map (swap in for the generated grid).
- Subway, bus and taxi as fast travel and logged rest.
- Traffic, enterable businesses, buses and taxis, real MTA schedules.
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
