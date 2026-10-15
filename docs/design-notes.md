# Manhattan Miles design notes

Mark's notes from play sessions, sorted into a backlog. Newest session first. Nothing here is built yet unless marked done.

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

**Punch trade-offs**

- Straights (jab, cross): longer range, less power.
- Hooks: more power, shorter range. This needs a middle range band, not just in or out.
- Uppercuts: land to the body, with bonus damage when the opponent is level changing.

**Guards can break.** Done 10/15 (`FT.guard`, turtle opponents). An opponent who covers up the whole time can be beaten by volume: guard damage builds up until the guard breaks. That's the fitness point: there's an efficient way (body shots, uppercuts, timing) and a brute-force way (sheer work rate), and both pay off.

**Fight aftermath**

- Fights gather a crowd, with people filming on their phones.
- Opponents are knocked out or run away.
- Victims thank or criticize you, with humor mixed in.

### City and world

- **Map:** a street-by-street accurate Manhattan with real businesses, like the San Diego game. Real business names come out of any commercial release.
- **Businesses:** they can be entered. Whether interiors are instanced is still open.
- **Transit:** accurate MTA schedules. Public transit and taxis are the fast travel (and logged rest).
- **Pedestrians:** wave to interact.
- **Tone:** blue, crude humor.

### Phone and interaction

- Wave the right hand to interact with an NPC.
- Wave the left hand to open the in-game phone: the menu, the police radio, and fast travel for testing. Menu navigation still needs a gesture (torso turn to move, point to pick is the likely fit).
- The engine already emits `wave` with `{ hand }`, so this is game work.

### Police radio and crimes in progress

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
