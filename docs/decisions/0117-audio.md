# 0117. Audio

- **Status:** Accepted, 2026-11-25
- **Issue:** [#146](https://github.com/loominate-if/loominate-if/issues/146)
- **Design:** [Audio](../DESIGN.md#audio), [ADR 0116](0116-start-screen-for-every-game.md)

## Context

The design asks for music, ambience, and sound-effect channels with crossfades, a volume control, handling of browsers' autoplay restrictions, and sounds triggered by beats. Runtime logic never touches the DOM, all output goes into the event record, and anything that changes must go through the store so undo, saves, and replays see it. A plain story must pay nothing for sound.

## Decision

- **Core cues, presentation plays.** Core is DOM-free:
  - `music` and `ambience` are looping channels; `play(src, { fade, volume })` and `stop({ fade })` set what each plays in core's `$audio` state, so undo, saves, and replays restore it.
  - `sound(src, { caption, volume })` records a `sound` event, played once as the move is shown.
  - Passages cue them as arrival directives, after beats too: `{music "…"}`, `{music stop}`, `{ambience "…"}`, `{ambience stop}`, `{sound "…", caption: "…"}`.
- **Files are named by path,** as from the game's `public/` folder, which Vite copies into builds as it is.
- **Opt in:** `audio: true` in the game config and `PlayOptions`. Only then does the player shell load the audio player and offer the controls. A game that cues sound without it gets an error through `onError`, saying how to turn it on.
- **The player** follows the store: after a move, each channel crossfades to what the state says, and the move's new sounds play once. After a jump (undo, travel, loading, a replay), the channels follow, but no past sound plays.
- **Autoplay:** nothing plays until the player's first click or key press, which the start screen's New game is. Then whatever should be playing starts.
- **The player's settings,** kept for this game in the browser as the default for its later games, and not in saves, since they're the player's, not the story's:
  - sound on or off, a switch on the start screen and in the game menu's **Sound** dialog;
  - volumes for music, ambience, and effects;
  - captions, which show each sound's `caption` as a notice, "[A door slams.]".
- **Reduced motion:** with prefers-reduced-motion, crossfades cut.

## Consequences

- Sound is reproducible: a replay or a loaded save plays what the story says should be playing.
- The audio player and its dialog are loaded on demand, so a game without sound carries neither.
- The single-file build can't carry sound files; a game with sound is served with its `public/` folder.
- The issue named the cross-playthrough store for settings; they're kept per game in the browser instead, as the player's preference, decided on #146.
