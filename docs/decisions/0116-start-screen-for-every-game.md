# 0116. A start screen for every game

- **Status:** Accepted, 2026-11-25
- **Issue:** [#407](https://github.com/loominate-if/loominate-if/issues/407)
- **Design:** [Core runtime](../DESIGN.md#core-runtime), [ADR 0022](0022-player-shell-and-browser-saves.md)

## Context

`playGame` showed a start screen only to a player returning to a game in progress, offering Continue or New game; a first-time player went straight into the story. Discussing audio (#146), the start screen was wanted as the first thing every game shows: a place for the author's cover art, for loading a save before playing, and for choosing whether sound is on before any plays, which is also the interaction browsers need before they'll play sound.

## Decision

- **Every game opens on its start screen:** the title, the byline, the cover if there is one, then the choices.
  - **Continue,** if there's a game in progress.
  - **Load a saved game,** if there are saves besides the autosave. It opens the save menu at loading.
  - **New game.** For a first-time player, it's the one choice, styled as the continue point.
  - Nothing begins until the player chooses, so `player.story` is undefined until then.
  - **Focus starts on the title,** as the page's does when a game loads. The cover's alt text and the byline are its description, so a screen reader reads the title, the cover, and who wrote it, before the choices. The next Tab reaches the first choice.
- **Cover art:** `cover: { image, alt }` in `PlayOptions` and the game config, an image by path, as from the game's `public/` folder, with alt text required.
- **A reload in the same tab carries straight on,** past the start screen, as before; only a return opens on it.
- **`startScreen: false`** keeps the old behavior: straight into a new game, with Continue offered only to a returning player. It's for games embedded in another page, and for tests.

## Consequences

- Every existing game gains a start screen with no change to its code; its title and byline come from its config.
- Tests that played through `playGame` and expected the story at once now choose New game, or pass `startScreen: false`.
- Audio's on/off switch (#146) has a home before any sound plays.
