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
| `examine.label`, `take.label`, `drop.label`, `open.label`, `close.label`, `lock.label`, `unlock.label` | `thing` | The standard actions' labels: "Take the iron key" |
| `take.done`, `drop.done`, `open.done`, `close.done`, `lock.done`, `unlock.done` | `thing` | What they report: "You take the iron key." |
| `stack.takeAll`, `stack.dropAll` | `thing`, `count` | A whole stack's labels: "Take all 99 turnips" |
| `stack.takeOne`, `stack.dropOne` | `thing`, `one` ("a turnip") | Taking or dropping one: "Take a turnip" |
| `stack.takeOne.done`, `stack.dropOne.done` | `thing`, `one` | "You take a turnip." |
| `stack.takeSome`, `stack.dropSome` | `thing`, `plural` | Choosing how many: "Take some turnips…" |
| `stack.takeSome.confirm`, `stack.dropSome.confirm` | `thing` | Their buttons: "Take", "Drop" |
| `stack.takeSome.done`, `stack.dropSome.done` | `thing`, `count`, `some` ("ten turnips") | "You take ten turnips." |
| `stack.howMany` | `thing` | What they ask: "How many?" |
| `examine.nothing` | `thing` | "You see nothing special about the statue." |
| `take.held`, `drop.notHeld`, `open.already`, `close.already`, `lock.already`, `unlock.notLocked` | `thing` | Why they aren't offered |
| `open.locked`, `lock.open` | `thing` | "The oak chest is locked.", "You'll have to close the oak chest first." |
| `lock.noKey` | `thing`, `key` | "You need the iron key." |
| `inventory.title` | | "You carry" |
| `action.noBody` | | "You have no body to act with." |
| `action.outOfReach` | `thing` | "The barrel is out of reach." |
| `list.empty` | | "nothing" |
| `list.join` | `items` | "a brass key, a map, and two mice" |
| `list.group` | `count`, `plural` | "three gold coins" |
| `number.words` | `count` | "three", up to twelve, then digits |
| `clock.time` | `day`, `hour`, `minute` | "9:45 pm" |
| `clock.label` | | What the clock widget is, for screen readers: "Time" |
| `stat.notEnough` | `who`, `stat`, `need`, `have` | "You don't have enough energy." |
| `compass.short` | `direction` | A compass button's label: "N", "NE", "Up" |
| `hours.closed` | `place`, `opens`?, `when`? | "The bakery is closed until 9:00 am on Monday." |
| `hours.onDay` | `weekday` | "on Monday" |
| `calendar.date` | `day`, `weekday`?, `month`?, `date`?, `year`? | "Wednesday, 31 October 1923", or "Day 3" |
| `schedule.repeated` | `source`, `lines`, `count` | What a daemon without a `summary` says when it repeats in a jump: empty, which keeps each line |
| `wait.label`, `waitUntil.label` | `minutes`; `what` | "Wait 10 minutes", "Wait until 6:00 am" |
| `wait.done`, `waitUntil.came` | `minutes` | "You wait ten minutes." |
| `waitUntil.done`, `wait.interrupted`, `waitUntil.gaveUp` | `time` | "You wait until 6:00 am.", "Your wait ends at 5:45 am.", "You give up waiting at 5:50 am." |
| `waitUntil.now`, `waitUntil.notComing`, `waitUntil.holds` | `what` | Why a wait isn't offered |
| `wait.menu` | | The Wait menu's button: "Wait" |

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
| `compass.label` | | What the compass is, for screen readers: "Compass" |
| `menu.undo`, `menu.save`, `menu.load`, `menu.restart` | | "Undo", "Save", "Load", "Restart" |
| `menu.nothing` | | A thing's menu with nothing in it: "Nothing to do with it." |
| `menu.ask.confirm` | | The button that takes an action once its numbers are given, when it has no `confirm`: "OK" (core) |
| `menu.ask.back` | | Going back from the numbers to the menu: "Back" |
| `menu.ask.of` | `max` | The limit beside a number: "of 99" |
| `menu.ask.problem` | `min`, `max` | Why a number won't do: "Choose a whole number from 1 to 99." |
| `things.nothing` | | An empty inventory: "nothing" |
| `menu.confirmRestart`, `menu.confirmRestartLabel` | | "Confirm restart", and what a screen reader hears for it |
| `menu.undoTip`, `menu.cannotUndoTip`, `menu.saveTip`, `menu.loadTip`, `menu.restartTip`, `menu.confirmRestartTip` | | Each button's tooltip, which says what it does whatever it's called, such as "Start the story over from the beginning. Your saves are kept." Screen readers read it as the button's description. |
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

## Translating

The library ships in English. To translate a game, replace every message, as above, and the world model's grammar: its message parameters (`{the}`, `{a}`, the pronouns) and its verb fallback are registries too, so a language package replaces them with `messageParameters.replace` and `messageFallbacks.replace`. A test in the world model replaces all of them and plays a game through the player shell, so no player-facing word can slip past them. Errors for authors, and the inspector, stay in English.

## Parameters of your own

A game can register message parameters of its own, as `messageParameters.register("shout", ({ args }) => …)`. Registered with a literal name in the game's code, it's known when the game compiles, so `t` templates that use it aren't reported.

A package's parameters are known from its compiler extension, which lists them in `messageParameters`, with any `fallback` that reads other names, as the world model's verbs:

```ts
messageParameters: {
  names: ["the", "The", "a", "A"],
  fallback: { reads: "a verb", words: ["is", "has"] },
},
```

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
