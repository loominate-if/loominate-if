# 0046. Things' menus and standard actions

- **Status:** Accepted, 2026-11-22
- **Issue:** [#77](https://github.com/loominate-if/loominate-if/issues/77)
- **Design:** [Dynamic context menus](../DESIGN.md#dynamic-context-menus), [ADR 0044](0044-action-pipeline.md), [ADR 0045](0045-reason-tooltips.md)

## Context

Opening a thing's menu gathers the actions that apply to it. Each action decides whether it's hidden, shown, or disabled with a reason, and computes its own label. Menus must be keyboard-operable. Actions (ADR 0044) existed, but only as links a passage wrote out one by one.

## Decision

### Opening a menu

- A thing's name in the text opens its menu: `[[brass bell]]{menu bell}`. `{menu}` is a core guard directive, `stays` like `{act}`. Its runtime, `menuLink`, marks the link's guard with the thing's ID, and the page makes the link a menu button instead of following it. A name sits mid-sentence, where a content directive can't, so it's a link.
- Following a menu link with `story.follow` is an error that says to take one of its actions instead.

### Which actions a menu offers

- An action's `on` names the things whose menus offer it, and `for` is a function that says yes to the things it suits. `actionsFor(thing)` lists the actions a menu offers, in the order they were defined, each called with the thing as `thing`. The thing is looked up as a handle, so a `for` can read its properties.
- The menu runs `statusOf` on each: verify failures aren't listed, check failures are listed disabled with the reason beneath, and labels come from the actions.
- `story.act(call)` takes an action as the same `act` move an action link makes. It refuses, saying why, if the action is hidden or disabled.

### The menu

- It's the menu button pattern:
  - The name is a button with `aria-haspopup="menu"` and `aria-expanded`, and Down or Up opens the menu too.
  - The menu is `role="menu"` with `menuitem`s. The arrow keys, Home, and End move through it, and Enter or a click takes an item.
  - Escape closes it and returns focus to the name, and Tab or a click elsewhere closes it.
  - A disabled item has its reason under it, as its description.
  - An empty menu says "Nothing to do with it."
- A move from a menu reaches `onMove` as `{ type: "action", label }`, so the undo history labels it.
- Widgets get `host.menu(anchor, thing)` to make their own buttons open menus. `thingsWidget` lists things that way, and `addToHeader(name)` lets a package add a widget to the default header.

### The world model

- Standard actions:
  - `examine`, for every thing that isn't a place, reading `description`;
  - `take` and `drop`, for things that can be carried;
  - `open` and `close`, for openable things;
  - `lock` and `unlock`, for lockable things, needing their `key` if they have one. `lockable` gains `key`.
- Each is an ordinary action with its words in the message table. A thing can't be carried if it's a place, a body, a door or obstacle, or `isFixed`.
- An `inventory` widget in the header lists what the player carries, each name opening its menu. The world model now depends on presentation for it, as the layering allows (core ← presentation ← world). Its own code stays free of DOM types: presentation's `thingsWidget` draws, and the world model says what to list.

## Consequences

- A game's own action can't take a standard action's name. The error says to rename it, or to change the standard one with its rules.
- Names in listings (`listContents`) aren't menus yet: listings return text.
- Multi-object actions (#78) offer "Put the coin in the chest" on both things' menus. Implicit actions, such as opening a door before going through it, can be rules on these actions.
- The inspector (#80) explains menu actions with `statusOf`, as it explains action links.
