# 0073. The inspector's World tree

- **Status:** Accepted, 2026-11-24
- **Issue:** [#82](https://github.com/loominate-if/loominate-if/issues/82)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0028](0028-inspector-shell.md), [ADR 0055](0055-inspecting-fuses-and-daemons.md)

## Context

The inspector should show containment, mind/body links, and each mind's knowledge, as a navigable tree. The State tab lists objects flat, by ID, with no sense of where anything is or who knows of it.

## Decision

- **A World tab,** registered by the world model's inspector module, so a game without the world model never has it.
- **The tree** is each place with what's in it, nested, then what's out of the world, then minds with no body.
  - A body shows the mind in it now, and a stack its count.
  - It's an ARIA tree with a roving tab stop. Up and Down move, Right opens or moves in, Left closes or moves out, Home and End go to the ends, and Enter, Space, or a click chooses.
- **Details beside the tree** for the chosen node:
  - what it's in, out to its place, and its mind or body;
  - its properties, from core's `describeObjects`.
  - **Knowledge, both ways:** a mind, or a body with a mind in it, lists the facts it knows with where it learned each, the things it has seen, and the things it knows of. A thing lists the minds that have seen it and those that know of it.
  - Names in the details jump to that node, opening the way.
- **Following the player:** the tree starts open on the player's place, then keeps what's been opened as the game moves. **Show the player** opens the way again.
- **The data is the world model's:** internal `_worldTree`, `_worldDetails`, and `_playerPath` read the world and change nothing. They're tested without a page, and the panel only draws them.

## Consequences

- Working out what a mind knows of goes through every thing for every mind, which is fine at inspector speed for hand-made worlds. A generated world with thousands of things may want it worked out only for nodes on show.
