# 0072. Actions that ask for numbers

- **Status:** Accepted, 2026-11-24
- **Issue:** [#335](https://github.com/loominate-if/loominate-if/issues/335)
- **Design:** [ADR 0046](0046-context-menus.md), [ADR 0071](0071-stacks.md)

## Context

A stack's menu offered taking one or all (ADR 0071). Players should be able to choose how many. Other actions want a number too, such as a bet or a wait of so many minutes, so this shouldn't be only for stacks.

## Decision

- **Core:** an action can ask for numbers before it's taken.
  - `asks` gives each argument it asks for, with a `label` and `min`, `max`, and `start`, as numbers or worked out from the action's things.
  - `confirm` names the button that takes it. Without it, the button is the `menu.ask.confirm` message, "OK".
  - `statusOf` gives the numbers asked for, worked out for that call, and the button's text, while the action can be taken.
  - `perform` refuses a call whose number is missing, not whole, or outside its limits, with an error naming which. The menu checks first, so a player never sees it.
- **Presentation:** choosing an action that asks swaps its menu for a form, in the same place.
  - The form has a heading, a labelled number field for each number with its limit beside it ("of 99"), and buttons to take it or go back.
  - Enter takes it, and Escape or Back returns to the menu, on the choice that asked.
  - A number that won't do keeps the form open and says why, in an alert, with the field marked invalid.
  - It's a form, not part of the `role=menu` list, which can only hold menu items.
- **The world model:** `takeSome` and `dropSome` ask how many, from one to the whole stack, for a stack of more than two. Taking or dropping one or all is enough for two.
- **A fix along the way:** a click that removed the element it was on, as a menu choice giving way to the form, was taken for a click outside the menu, which closed it. The page now ignores clicks on elements no longer there.

## Consequences

- An asked number is an ordinary argument, so it's logged with the action, and undo, saves, and replays repeat it.
- Only whole numbers are asked for. A game wanting another kind of answer, such as words, needs its own input.
