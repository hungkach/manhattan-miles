# Manhattan Miles design notes

Mark's notes from play sessions, sorted into a backlog. Newest session first. Nothing here is built yet unless marked done.

## 2026-10-22 requests (built 10/22)

- Teep, Dutch rear low kick, knee: done (engine 0.11.0 `KickDetector`; game `FT.kick`, gym steps, touch buttons).
- Squat and bound in the walking warm-up, so chase obstacles register: done (squat, bound, hop; the warm-up squat sets the chase duck floor).
- Studio voices with a mix of women, men and accents: done. Device voices first (a cast from the device's English voices), Piper Studio voices opt in (l2arctic's second-language speakers for most of the city). Opponents are all men.
- Graphics direction (GTA3 or Vice City look): recommendation given in chat; not started.

## 2026-10-21 PM session (30:25, 339 kcal; built 10/22)

Mark: combat unplayable this session, rotational punches not registering. "We should mocap players during the gym tutorial, then that becomes their move: the coach teaches you how to throw a strike, the system captures it, and that's how it reads it." The combat needs to be perfected, not fine tuned.
- Done (engine 0.10.0): the gym teaches the engine your guard and three reps of each punch; your punches are read against your own samples from then on; the rules only read what was never taught. Synthetic tests: a low, tired guard reads nothing by the rules and everything once taught; a wide hook the rules call a straight reads as a hook once taught; waving still throws nothing.
- Sidestep a takedown (a bound during their shot): done; the shot misses and a hook from that side lands double.
- The AI reads head movement and level so the player can bait them: done for skilled types (slip twice and a boxer throws the hook; drop your level and readers throw the uppercut, stand back up and it misses for a counter; wrestlers shoot when you stand tall up close).
- Opponent types: done (thugs most of the time; boxers, wrestlers, tweakers, roidheads, turtles; bosses their own).
- Knees and kicks, the plan (engine first, then the game; knees-up framing means the feet are often out of view, so each reads from the knee and hips):
  - Knee (first): in a fight, one fast knee drive (a single high knee, not a march rhythm) is 'knee'. Counters a shot the way an uppercut does, and lands to the body.
  - Rear low kick (second): the rear knee swings across with the hips turning. Slows them (longer wind-ups) and stops a beaten opponent from running.
  - Lead teep (third): the lead knee lifts then thrusts toward the camera. Pushes them out of range, drops one mid wind-up (a tag switch in pairs), tops up your guard bar.
  - Each gets a synthetic leg move and tests in body-arcade, and joins the gym so it is taught like the punches.

## 2026-10-20 PM session (30:01, 386 kcal; built 10/21)

Mark: fun workout like yesterday, a fan of the increased fighting. Loves the level change bar. Main ask: improve the combat.
- Gym sequence bugged, the first stop's instructions played over it; it should be instanced: done (the route and first encounter wait for the gym to end, nothing from the street follows you in).
- Crime dens need a waypoint to the next group: done (route ribbon and a marker over the group's lead).
- Hit detection way off: the warm-up missed hooks and uppercuts, and waving the arms back and forth counted as hooks and overhands. "Perhaps it doesn't need to read the situation perfectly? Just guess based on the movement?" Done in engine 0.9.0: a punch is a fast move out from a set guard toward the camera, judged where it ends, with a guess (a straight) for anything else thrown at the camera; waving never sets the hand, so it never punches. The game stopped landing standing punches through the glove hitbox. Hooks and uppercuts thrown from mid range step you in instead of whiffing.
- Chases highly difficult, runners fast; QTEs should be slow motion with time to act, keep your speed for about 1.5 s after, maybe a speed bonus: done (slow motion about 3 s per prompt, speed held through the move, 15% faster for 1.5 s after a clean one, slower runners).
- Next: a real camera clip of the gym round (saved from the summary) would let the punch reading be tuned on real data instead of synthetic clips.

## 2026-10-19 PM session (30:10, 360 kcal; built 10/20)

Mark: felt really good, great sweat. Notes and what was done:
- No combat tutorial at the start, was surprised: "Gym round first" on the title, on by default.
- Hooks and uppercuts registering at the fight's start, on slips and level changes: they no longer count while the body itself moves, in the first second, or from a hand that was not up by the guard.
- Takedowns with no jump: engine 0.8.4, a jump needs 0.2 T (a hard drive up onto the toes reached the old 0.12).
- Summary showed high knees intervals 0 of 3 with 1 to 2 s run each: engine 0.8.4 runs from 120 spm (tired high knees run 130 to 150) and a missed step does not end a run.
- Fastest punch 22.9 S/s looked like a tracker spike: records use the median frame speed now.
- Crime centers at every stop (done): themed, instanced, linear like a SNES beat 'em up, groups with a march break between them, a boss at the end.
- Chases (done): optional (wave right within 4.5 s), auto-pathed along the runner's trail, obstacles as quick moves (bystander: bound, dog: jump, scaffold pipe: squat), a miss widens the gap.
- Should chases end in a fight? Yes: catching them starts a short fight with the runner gassed (a snatch win returns the bag).

## 2026-10-19 late: quick additions (done)

- Opponent and crowd comments during fights (bubbles, spoken when the voice is free).
- Dual stick mode for testing: left moves, right looks.
- More pedestrians and traffic, scaled to what the device keeps up with.
- Combos pay: each landed punch in a combo adds 8% damage, capped at 32%.

## 2026-10-19 PM honest reps v2 (done)

Mark: effort is subjective, output is objective, and the player's own fitness is the progression model. This replaces the morning's audit, which scaled rewards against the player's early reps.

- Absolute output in body units, floor to capped top. Punch power from fist speed in shoulder widths a second (2.5 floor still lands, 10 is the cap); takedown quality from squat depth, drive speed and jump height in torso lengths; slip size, duck depth and bound size the same. Nothing is compared to your first punches or minutes.
- XP from outcomes only: stops, wins (by clean shots, accuracy, hits taken), takedowns (by output), guard breaks, calls, runners caught, and new records. No per-minute XP, no interval XP, nothing for waving.
- Records in body units, saved across sessions (camera play only): best 30 s cadence, highest knees (engine 0.8.3 `knee_lift`), fastest punch, deepest level change, longest bound. The summary shows each with the previous best.
- Summary is plain facts: time, steps, distance, work and rest time, intervals with seconds run, fights, punches, takedowns. No early-vs-late percentages, no praise lines.
- No quality-drop rest offer. Rest is the player's choice: Take a breather (phone), cab, subway.
- No cheering voice, no scolding, no fatigue commentary. Humor aims at the city, never the player's effort or body.

## 2026-10-18 late: guard bar, gym, retries

- The camera misread a held guard, so blocking by holding your hands up is gone. Your guard bar blocks their punches by itself (the gloves come up), each block costing it (straight 1, hook and uppercut 1.5 of 6); it refills slowly, and slips, ducks, stuffed shots and knockouts top it up. Empty, punches land. A wind-up prompt says how to beat it (Slip, Duck, Stand tall).
- Their guard bar works the same way on your punches (a tenth gets through) until it breaks and they are open for 2 s. A punch within 1 s of your slip or level change, from a shift angle, or into their wind-up, shot, brace or stuffed shot skips it and lands clean.
- The combat tutorial happens at the gym, its own place: mats, a cage, heavy bags, your partner on pads, and the camera's stick figure in a panel on the side. Cover-up is out of it (no more guard reading); slip is in.
- Shoulder turns stopped registering in the warm-up. Two causes, both fixed: the 10/17 warm-up rewrite gave the turn steps no length, so they ended the moment they began (the real culprit); and hands up by the face switched off steering (engine 0.8.2).
- Every warm-up move and tutorial move repeats until it registers, at most three tries in a row.

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
  - Studio voices: done 10/22.
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
