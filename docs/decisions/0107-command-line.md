# 0107. The autocomplete command line

- **Status:** Accepted, 2026-11-24
- **Issue:** [#131](https://github.com/loominate-if/loominate-if/issues/131)
- **Design:** [Autocomplete command line](../DESIGN.md#autocomplete-command-line), [ADR 0075](0075-verb-phrases.md)

## Context

The command line is a keyboard command line that accepts only currently offered actions, with autocompletion, and never says "I don't understand". It must be accessible and use action verb phrases. A note on the issue asked for it to be an accessibility feature for every game:
- focus stays in the field;
- the response is read through a live region;
- speech tools type into it like a keyboard.

## Decision

- **Every game gets it,** in presentation, off by default.
  - The game menu's **Command line** button (`aria-pressed`) turns it on and off.
  - `PageOptions.commandLine` starts it on, and `Page.showCommandLine(on)` shows or hides it.
  - The player's choice is kept in `localStorage`, under one key for every game: it's how the player likes to play, not part of any game. It isn't kept in the persistent store, which the game reads. Where storage is blocked, it lasts the visit.
- **Its commands are what the page offers now:**
  - the passage's links and continue points, including links in the text, by label, with a disabled link's reason;
  - for each menu whose button is on the page, its actions by label and by verb phrase, the things named by their `name`, with each optional word in and out;
  - a layout's action-list buttons, such as a conversation's topics;
  - and the `commandSources` registry, for games and kits.
  - A label offered twice is one command.
  - An action that asks for numbers is left to its menu.
- **Matching:** case, punctuation, and articles aside, each typed word must start a word of the label or a phrase, in order.
  - A match from the start ranks above one in the middle, then the order offered.
  - It's sure of a command said exactly, or of the only match.
- **Enter:**
  - does the suggestion picked, or the command it's sure of;
  - with several matches, says "Did you mean …?" and opens the list;
  - with none, says "That isn't something you can do here. You could: …", with up to six;
  - for something disabled, says its reason.
  - Nothing that isn't done is a move.
- **The combobox pattern:** the field (`role="combobox"`) controls a listbox of up to eight suggestions, with `aria-activedescendant`.
  - Up and Down move through the list.
  - Tab completes the suggestion picked, and Escape closes the list or clears the field.
  - With the list closed, Up and Down recall earlier commands.
  - What it says is in a status region.
  - Screen readers echo the typing but not the list that appears, so half a second after typing pauses the status reads the count and the first three: "2 suggestions: Ring the bell, Ring for help." Picking or taking one before then cancels it.
- **Focus stays in the field:** while a command runs, the page reads what's new through its live region instead of moving focus to the passage heading. A link followed by mouse or keyboard behaves as before.

## Consequences

- A branching story is playable from one text field, with no world model.
- The world model needs no changes: its menus' actions carry verb phrases, and conversation topics are action lists.
- Things are named by their `name` property. A thing's other vocabulary, from `vocabOf`, isn't matched yet; that's for the parser.
