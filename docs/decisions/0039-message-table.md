# 0039. The library message table

- **Status:** Accepted, 2026-11-22
- **Issue:** [#71](https://github.com/loominate-if/loominate-if/issues/71)
- **Design:** [Extensibility](../DESIGN.md#extensibility), [ADR 0013](0013-text-templates.md), [ADR 0038](0038-message-parameters.md), [ADR 0022](0022-player-shell-and-browser-saves.md)

## Context

The design routes every built-in message through an overridable table, for theming ("You can't go that way" in a pirate voice) and localization. The world model wrote its messages inline, as `t` templates since ADR 0038, and the player shell's words were literals, a few of them overridable through page options. ADR 0022 left localizing the shell's text for later.

## Decision

### The table

- Core has a message table, `messages`. Each library registers its messages with their default text when it's imported, and declares each key on the `Messages` interface, by declaration merging, with what the message is about: `"door.locked": { door: ObjectRef }`. A misspelled key, or a context missing a value, is a type error.
- `message(key, context)` renders one. A message with nothing to be about takes no context.
- A game rewords a message in `story.ts` with `messages.replace(key, text)`, which is typed by the key too, so a misspelled key is a type error. It works before the library registers the message: `story.ts` can run before presentation loads, and walkthrough tests never load presentation. A rewording made first is kept when the library registers.
- `messages.entries()` gives each message with its source, the package or game that set it last. An inspector panel for it can come later.
- Registering a message that's already set does nothing, so a package loaded twice, as presentation is in the dev server's inspector and in the game, registers once, and a library never undoes a game's rewording.
- A game sees the message keys of the packages it's played with even if `story.ts` doesn't import them: the compiler takes `ambient` packages whose declarations apply to the game, and the CLI passes presentation, so `messages.replace("menu.restart", …)` type-checks.

### What a message's text is

- Plain words, a `t` template, or a function of the context. A `t` template is a function of its context, so the types are a string or a function.
- A template names what it's about by name: a word in a message parameter that's a name in the context refers to that value, as in `{The subj door} {is} locked.` rendered with `{ door }`. This is adv3Lite's style, and it's needed because a reworded message is written before there's anything to put in `${}`. A word that isn't in the context is an error listing the names it can use. Grammar parameters, including verbs, take names this way.
- Strings and numbers in a context are used by function texts. Templates have no parameter to print them yet.

### What goes in it

- Everything the player sees from a library:
  - the world model's messages: doors, arrivals and departures, exit labels, and direction words;
  - the page's Continue, Skip, and Story so far;
  - the history's move labels and the status line;
  - the game menu, the start screen, and the save menu, including its announcements and screen-reader labels.
- `mountPage`'s `continueLabel`, `skipLabel`, and `drawerLabel` options stay, and win for their page.
- Author-facing error messages, such as a mistake in `story.ts`, stay in English and out of the table.
- Grammar itself, English articles and verb agreement, is the world model's English parameters, not messages. A translation registers its own parameters (ADR 0038).

## Consequences

- A theme or translation replaces messages in `story.ts`, or in a package the game loads after the libraries.
- Localization scope (#60) decides whether version one ships a second language. The table is ready either way.
- Every message a library adds from now on goes through the table. A new player-visible literal in a library is a review finding.
- The compile-time check of message parameters (#235) can check a template's names against its message's declared context.
