# Manhattan Miles design notes

Mark's notes from play sessions, sorted into a backlog. Newest session first. Nothing here is built yet unless marked done.

## 2026-10-18 notes

- A jump without a deep enough squat: only a jump, never a takedown (engine 0.8.1 tests; the shot needs a squat past 0.3 torso lengths, the drive up, then the jump). The touch Jump button now shoots only out of a held Squat. In a fight a lone jump says "Level change first, then jump".
- Level changes duck hooks ("Ducked it: counter!"); opponents now throw uppercuts too (the rear hand drops, the knees dip), more often after you have been changing levels, and an uppercut that catches you low counts double ("Caught low!"). The guard still blocks it.
- Shift feels strong: left as is until the garage test.
- Crime-ridden New York (a modern Death Wish): encounters every 40 to 70 s, as scenes: thugs hassling someone, a purse snatcher already running (chase him down, bag recovered), a car break-in with the alarm going (he fights or runs), two guys brawling with a crowd filming (both turn on you), a corner deal (the buyer scatters, the dealer fights or runs), a tagger at a wall (he runs). Police cars with light bars and sirens drive by; sirens off in the distance; loitering groups on corners heckle you as you pass (wave at them for more); up to 34 pedestrians.

## 2026-10-17 notes and the graphics pass

- 10/18 fix (Mark: the player punched the air; it should attack from a 45 degree angle, not head on): the view now swings 45 degrees around the opponent, facing them, while they still face where you were. Before, the view slid sideways and they turned away.
- Shifts: done. A bound out and back (engine 0.8.0 'bound') takes an angle like Dillashaw or Cruz: the opponent is turned away for 1 to 4 s (a quicker bound, longer), every punch does 1.4x (less than a ground and pound, but free), a punch in flight misses, 2.5 s cooldown. Touch: Bound L and Bound R. The tutorial ends with it.
- The rear hook is the overhand: done (engine 0.8.0 and the glove hitbox). Damage 1.7, goes over a cover-up, close range.
- The cover-up fills the view: done. Two big padded gloves with cuffs and forearms take most of the screen, a gap to peek through at the top.
- Graphics pass (Mark: Vice City level, better models):
  - Looks: golden hour (default; the sun low in the west-southwest lights the cross streets), day, night. Title screen and phone. Graphics high or low.
  - Sky: gradient, sun or moon with glow, clouds, stars, horizon haze; distance haze in the look's color.
  - Light: cool ambient in shadow plus warm sun on the walls that face it; everything (people, cars, props) lit the same way.
  - Buildings: glass curtain walls on towers, punched windows on brick, storefronts with awnings, cornices, shading at the base, lit windows at night, rooftop water tanks.
  - Streets: curbs and gutters, lane lines, zebra crossings at intersections.
  - Street furniture: lamp posts (glowing at night with pools of light), trees on residential streets and in parks, hydrants, subway entrances with green globes.
  - People: new bodies (waist and chest, shoulders, hair, hands, shoes), varied skin, hair and clothes, round shading, ground shadows; opponents in tank tops with taped fists.
  - Cars: bumpers, roofs, head and tail lights that glow at night.
  - Anything behind a building is hidden. Dynamic resolution keeps it smooth on busy blocks.
- Next for graphics: textured walls (brick, stone), better park ground, shadows cast by buildings, rain, neon signs at night.

## 2026-10-16 PM test (20:02, 180 kcal, "actually pretty fun")

- Warm-up like Homecoming Hero: low knees, high knees, wave left, wave right, turn left, turn right, two rounds. Done.
- Jabs and crosses read as uppercuts. Fixed in the glove hitbox (it called anything rising faster than it extended an uppercut): an uppercut now has to start below the shoulder with a bent elbow; the engine's stricter classifier relabels a glove hit for the same hand. The combat tutorial records labeled moves to tune it further.
- Route on screen: done, a blue ribbon with chevrons down the street to the next stop.
- Faking the takedown into an uppercut did not work: fine, takedowns first.
- Opponents break your guard: done (`FT.myGuard`: blocks wear it, at 0 it breaks for 1.4 s).
- Guard cue should be immersive: done, both gloves rise into view in front of your face and the edges darken (peek-a-boo); a block jolts and flashes them; a broken guard knocks them apart. The HUD shields are gone.
- Strike words: kept (they show what each punch read as).
- Multiple opponents: tag team, one at a time like a kung fu movie (`FT.tag`): the other circles at the edge and subs in when the guard of the one in front breaks, after a takedown, or every 14 to 22 s; each keeps their own health. A takedown with the friend standing is risky: half the ground and pound, and they hit you.
- Runners can be chased (`FT.chase`): the fight ends, they run down the street tiring, high knees to catch them within 25 s.
- Takedowns need a jump (engine 0.7.0 `requireJump`): the squat is the level change; a jump out of it is the shot.
- Two-hand high guard only (`FT.oneHand` false): the one-hand ear block is off for smoothness.
- Combat tutorial: done. Stance (orthodox or southpaw, lead and rear follow), jab, cross, lead and rear hooks, lead and rear uppercuts, cover-up (held), level change, level change into a jump. Pads partner, two reps each, what each punch read as, 25 s per move then it moves on; runs once after the first camera warm-up and from the phone; the camera run is saved as "Save tutorial clip".
- Not yet:
  - Major graphics pass (Mark: Vice City level): next session. Plan: textured facades with lit windows, sidewalks with curbs, street furniture (lamps, hydrants, trees, subway entrances), sky and sun with time of day, fog, better people (proportions, clothes, hair), cars with wheels and lights, a quality setting.
  - Enter buildings, including the subway (long term).
  - Studio voices (distant future).
  - The bound out and back from Homecoming Hero to start a "shift" (Dillashaw or Cruz angle change, a 1 to 4 s burst window): Mark's note was cut off; needs a bound detector in the engine.

## 2026-10-15 PM iPad test (8:47, 83 kcal, very light)

- Blocking felt clunky with no cue. Done: a shield per hand on the HUD, glowing gloves at the guard, the needed hand pulses during their wind-up, and a block flashes a big shield with a clack.
- Level change works perfectly.
- Raising or waving a hand turned him. Done in engine 0.6.2: a hand raised like a wave switches off steering.
- On iPad the text must read from across the room. Done: the HUD, phone and notes scale up on a tablet, more in camera mode.
- Testing: teleport and spawn an opponent from the phone. Done.
- It should feel like a busy NYC. Done: more pedestrians, texting, chatter, vendors, cars and cabs, horns. Next: enterable businesses, buses, a subway platform crowd.
- More reward for strikes. Done: sparks, damage numbers, combos, shake, crowd ooh, knockout bell.

## 2026-10-15 second camera test

- Hooks and uppercuts land; straights did not. Fixed in engine 0.6.0 (arm depth from foreshortening; MediaPipe squashes depth toward the camera).
- Takedown works nicely; ground and pound did not. Mark: targeting on the ground is not important. Done: any fast extending punch lands on top.
- A one-arm block (hand by the ear) stopped a punch from the side. It was not designed (the guard check was both hands); now it is a feature: hooks come from either side and the hand on that side blocks.
- Marching: knee height should be forgiving when tired; higher knees, longer strides; faster knees, faster strides. Done (engine stride, easier thresholds).
- The timer suits Homecoming Hero, not this game: this is an RPG, explore but stay active. Done: no countdown, always a next stop, intervals, idle nudges, active-minute milestones (20 is a full session).

## 2026-10-15 camera test (build "glove hitbox, level changes with knees out of view")

### What worked

- Glove hitbox works on camera.
- The core loop (walk, meet an opponent, fight, walk on) looks decent.

### Fight changes

**Takedowns: split the squat into defend and attack.** Done 10/15 (engine 0.5.1 and the game's `resolveShot`), including the brace read and the uppercut bonus on a level change. Today a takedown needs a fast drive up and then a held half squat, which feels strange. New model:

```python
# the squat is the level change; what you do from it decides the outcome
if squat_held and opp.shooting:
    sprawl()                       # holding the crouch defends their takedown
elif squat_held and opp.reading_shot:
    # they expect the double and drop their hands or level change themselves:
    # an uppercut here does bonus damage (the read)
    open_uppercut_window()
elif drive_up_from_squat:
    power = rise_speed             # engine: speed of the level coming back up
    if jumped:                     # hips and shoulders rise above standing height
        power += jump_bonus        # a vertical jump is the strongest takedown
    if opp.expecting_shot and power < strong_enough:
        stuffed()                  # a plain squat into a waiting opponent gets stuffed
    else:
        takedown()
        # ground and pound is a timed burst, not a held squat:
        # 2 s for a weak entry up to 5 s for a well-timed, powerful one
        gnp_seconds = 2 + 3 * timing_quality(power, opp.state)
        start_ground_and_pound(gnp_seconds)   # then they scramble up
else:
    pass                           # no level change
```

- Engine work (body-arcade): a jump signal (the level rising above standing; ankles are not needed), and rise speed on `drive_up`. Both read from the hips, or from the shoulders when the hips are hidden.
- Wrestling is the hook: most opponents are strikers, so the player's takedowns are what make this game different.

**Punch trade-offs** Done 10/15: they drift between close (1.6 m) and mid (2.3 m) range and step in to punch; straights reach mid range, hooks and uppercuts only land close (`FT.reach`); damage jab 0.7, cross 1.0, hook 1.5, uppercut 1.3 to the body.

- Straights (jab, cross): longer range, less power.
- Hooks: more power, shorter range. This needs a middle range band, not just in or out.
- Uppercuts: land to the body, with bonus damage when the opponent is level changing.

**Guards can break.** Done 10/15 (`FT.guard`, turtle opponents). An opponent who covers up the whole time can be beaten by volume: guard damage builds up until the guard breaks. That's the fitness point: there's an efficient way (body shots, uppercuts, timing) and a brute-force way (sheer work rate), and both pay off.

**Fight aftermath** Done 10/15 (`gatherCrowd`, `aftermath`, `LINES`, `drawPerson`, flee in `FT.flee*`).

- Fights gather a crowd, with people filming on their phones.
- Opponents are knocked out or run away.
- Victims thank or criticize you, with humor mixed in.

### City and world

Done 10/15: subway fast travel between real Midtown stations with the ride logged as rest (rough train times; real MTA schedules come with the real map), and an RPG layer (XP, levels, titles, tougher opponents, saved progress).

- **Map:** a street-by-street accurate Manhattan with real businesses, like the San Diego game. Real business names come out of any commercial release.
- **Businesses:** they can be entered. Whether interiors are instanced is still open.
- **Transit:** accurate MTA schedules. Public transit and taxis are the fast travel (and logged rest).
- **Pedestrians:** wave to interact.
- **Tone:** blue, crude humor.

### Phone and interaction

- Wave the right hand to interact with an NPC.
- Done 10/15: wave left opens the phone (`Phone`, `PHONE_ITEMS`), shoulder turn moves the highlight, wave right picks, wave left closes. Items so far: back to the walk, repeat directions, skip this stop, end session; police radio and fast travel go here later.
- Wave the left hand to open the in-game phone: the menu, the police radio, and fast travel for testing. Menu navigation still needs a gesture (torso turn to move, point to pick is the likely fit).
- The engine already emits `wave` with `{ hand }`, so this is game work.

### Police radio and crimes in progress

Done 10/15: the phone's police radio (`radio`, `CALL_TYPES`, `Calls`), timed calls you run to, officers who arrive after the fight (`OFFICER_LINES`), as recommended below. Pedestrians with a right-hand wave are done too (`Peds`, `greet`, `PED_LINES`).

- An in-game police radio lets you hear crimes in progress and go stop them.
- Police interactions (Claude's recommendation, Mark to confirm):

```python
# police are allies who show up after you have done the work; never opponents
if crime_stopped_by_player:
    officers_arrive()              # take the opponent away, a short dry thank-you
    # humor lands on the player, the crowd or the opponent, never on the officers
elif player_starts_a_fight_with_no_crime:
    officers_break_it_up()         # a warning and the fight ends; no arrest scenes
else:
    pass                           # no police on screen
# never: fighting police, police as villains, arrests of the player
# use generic "police" uniforms and cars, not the NYPD name, shield or logo
# (city trademarks, and it keeps the respect without depicting the real department)
```
