# 0108. Shareable seeds

- **Status:** Accepted, 2026-11-25
- **Issue:** [#132](https://github.com/loominate-if/loominate-if/issues/132)
- **Design:** [Randomness](../DESIGN.md#randomness), [ADR 0008](0008-random-streams.md)

## Context

The design says seeds are shown as memorable words ("amber-lantern-fog") and tied to the game's version, that authors can fix the seed or hide its entry, and that a seed of the day is possible. Until now a new game's master seed was two random base-36 numbers, never shown. Most stories have nothing random in them, so a seed would be noise to their players and a cost to their bundles.

## Decision

- **Opt in, with one setting:** `seeds` in the game config, passed to `playGame` as `PlayOptions.seeds`.
  - `false`, the default: nothing is shown, and a new game's seed is as before.
  - `true`: a new game's seed is memorable words. The player sees it, shares it, and plays one of their own.
  - `"daily"`: today's seed, the same for everyone that day. It's shown, but not taken.
  - Any other text: the seed every game starts from, shown nowhere.
  - `PlayOptions.seed`, a function making the seed, still takes precedence, for tests.
- **Memorable words.** A seed is three words from a list of 570 short, concrete words, easy to spell and say: over 185 million seeds. Each word is drawn without bias from the browser's `crypto.getRandomValues`, as the old seed was. The list is its own module, imported only by games that show seeds, so other games don't carry it.
- **A seed is its words.** The words are the master seed's text, so changing the list later changes no existing seed. A seed the player types is read in lowercase, with spaces, hyphens, or underscores between words: "Amber Lantern Fog" is `amber-lantern-fog`.
- **Tied to the version.** A seed is shared with the game's version, `amber-lantern-fog@1.2.0`. One from another version still plays, after a note that its world may differ; refusing it would stop players sharing across an update for a difference that's often nothing.
- **Today's seed** is three words chosen by an FNV-1a hash of the date in UTC, so players everywhere share it on the same day. The date chooses the seed as fresh randomness otherwise would, before the game begins; the seed is stored with the game, so the game itself never reads the clock.
- **Where it's seen:**
  - The game menu's **Seed** opens a dialog with the seed and its version, **Copy**, **Copy link** (a link with `?seed=`), and, with `seeds: true`, a field to play another. Playing one starts a new game, as Restart does.
  - The start screen offers **New game with a seed…**, which opens the dialog at its field.
  - A link with `?seed=` shows the start screen with **Play this seed** first, beside Continue when there's a game in progress, so a link never replaces a game unasked. The seed is taken out of the address once read, so a reload carries on.

## Consequences

- Same seed and version give the same world, as named streams already promised (ADR 0008); a test plays it.
- A game turning seeds on later changes only how new games get their seed; saves carry their own.
- A shared seed on a game whose code has changed may give a different world. Only the note says so: nothing can check that two versions draw alike.
