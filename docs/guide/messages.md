# Rewording the library

Every message the player sees from a library, from "The cellar door is locked." to the Restart button, is looked up by key in core's message table. A game rewords any of them in `story.ts`, to give the game a voice or to translate it, without changing the library. [ADR 0039](../decisions/0039-message-table.md) records the decisions behind this guide.

## Replacing a message

`messages.replace(key, text)` rewords a message for the whole game. The key is checked, so a misspelled one is a type error, and so is a text that names something the message isn't about:

<!-- example: packages/world/src/messages.test.ts#pirate -->
```ts
messages.replace("door.locked", t`Arr, {the door} be locked tight!`);
messages.replace("direction.label", ({ direction }) =>
  direction === "down" ? "Below decks" : direction === "up" ? "Topside" : direction,
);
messages.replace("actor.arrives", t`{The subj actor} {flutters} in, squawkin'.`);
```

A message's text is one of three things:
- **Plain words**, such as `"Walk the plank"`, for a message about nothing in particular.
- **A `t` template.** It names what the message is about by name, as `{the door}`, rather than with `${}`, since it's written before anything happens. The world model's grammar applies, so `{The subj actor} {flutters}` agrees with whoever arrives ([Writing about things](world.md#writing-about-things)).
- **A function of the message's context**, for anything else, such as `({ count }) => \`${count} moves\``.

`message(key, context)` renders one, as the library does, and `messages.entries()` lists every message with the package or game that set it last.

## The messages

### The world model

| Key | About | Default |
| --- | --- | --- |
| `door.locked` | `door` | "The cellar door is locked." |
| `door.closed` | `door` | "The cellar door is closed." |
| `actor.arrives` | `actor`, `from`? | "Mira arrives from outside." |
| `actor.leaves` | `actor`, `toward`? | "Mira leaves upstairs." |
| `exit.label` | `direction`, `room`, `visited` | "North", or "North, to the library" once visited |
| `direction.label` | `direction` (its name) | The label it was registered with, "North" |
| `direction.toward` | `direction` | "to the north", "upstairs" |
| `direction.from` | `direction` | "from the north", "from above" |

An actor can still give its own `arrives` and `leaves`, which win over these.

### The page and the player shell

| Key | About | Default |
| --- | --- | --- |
| `page.continue` | | "Continue" |
| `page.skip` | | "Skip" |
| `page.storySoFar` | | "Story so far" |
| `history.nextPage`, `history.afterBeat` | | "Next page", "After a beat" |
| `history.goTo` | `passage` | "Go to Cellar" |
| `status.moves` | `count` | "Moves: 3" |
| `menu.undo`, `menu.save`, `menu.load`, `menu.restart` | | "Undo", "Save", "Load", "Restart" |
| `menu.confirmRestart`, `menu.confirmRestartLabel` | | "Confirm restart", and what a screen reader hears for it |
| `start.continue`, `start.newGame` | | "Continue", "New game" |
| `start.inProgress`, `start.inProgressAt` | `where` | "You have a game in progress, at the cellar." |
| `start.cannotContinue` | | "Your game in progress can't be continued with this version of the game." |
| `start.savedByVersion` | `version` | "It was saved by version 1.0 of the game." |
| `saves.title`, `saves.name`, `saves.save`, `saves.import`, `saves.close`, `saves.closeLabel`, `saves.autosave`, `saves.empty` | | The save menu's heading, labels, and buttons |
| `saves.load`, `saves.saveHere`, `saves.export`, `saves.delete`, `saves.confirmDelete` | | A slot's buttons |
| `saves.loadLabel`, `saves.saveHereLabel`, `saves.exportLabel`, `saves.deleteLabel`, `saves.confirmDeleteLabel` | `name` | What a screen reader hears for them, "Load “Before the storm”" |
| `saves.saved`, `saves.savedNamed`, `saves.savedOver`, `saves.deleted`, `saves.exported`, `saves.imported` | `name` | What the save menu announces |
| `saves.cantLoad` | `problem` | "Can't be loaded: …" |
| `saves.savedByVersion` | `version` | "Saved by version 1.0 of the game." |
| `saves.loadFailed`, `saves.saveFailed`, `saves.exportFailed`, `saves.deleteFailed`, `saves.importFailed` | `error` | "Loading failed: …" |

`mountPage`'s `continueLabel`, `skipLabel`, and `drawerLabel` options still win over the messages, for one page.

The game is played through presentation, so these keys type-check in `story.ts` though it never imports presentation: `loominate` includes presentation's declarations when it checks the game. A rewording in `story.ts` can come before presentation has loaded, as in a walkthrough test, which never loads it; the rewording is kept.

## Messages of your own

A kit or a game's own library registers its messages the same way, declaring each key and what it's about on the `Messages` interface:

```ts
declare module "@loominate-if/core" {
  interface Messages {
    "spell.fizzles": { readonly caster: ObjectRef };
  }
}
messages.register("spell.fizzles", t`{The subj caster} {mutters}, but nothing happens.`);
```

Error messages for authors, such as a mistake in `story.ts`, aren't in the table: they stay in English.
