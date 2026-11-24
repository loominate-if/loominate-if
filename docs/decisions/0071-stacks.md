# 0071. Stackable quantities

- **Status:** Accepted, 2026-11-24
- **Issue:** [#98](https://github.com/loominate-if/loominate-if/issues/98)
- **Design:** [Storylets and stackable items](../DESIGN.md#storylets-and-stackable-items), [ADR 0042](0042-contents-listings.md)

## Context

Countable stacks should split and merge, so ninety-nine turnips are one stack, not ninety-nine objects. Things made during play are templates with IDs from their origin, and listing already groups alike things with a count.

## Decision

- **A kind is a template.** `stackable("turnip", { name: "turnip", plural?, merges? })` defines a thing template whose instances carry a `count` and the kind's name.
- **An authored stack takes an ID.** `stack("crate", turnip, { count: 99, location: barn })` defines one thing with a count. The discussion's sketch had no ID, but authored things need stable ones.
- **Splitting** with `split(stack, n)` spawns a new stack of the kind, with an ID from the stack it came from (`gen:crate:turnip-1`), in the same place. It doesn't merge back until it's moved. Splitting the whole count returns the stack itself.
- **Merging** happens whenever a stack is moved to a holder with another stack of its kind directly in it: the one already there takes the count, and the moved one empties and leaves the world. A kind with `merges: false` never merges, as for numbered tickets.
- **Counting:** `countOf` and `setCount`. A stack at 0 leaves the world. `stackIn(holder, kind)` finds one.
- **Text follows the count.** A stack's `name`, `isPlural`, and `article` are worked out from its count: "the turnips", "99 turnips", plural verbs; at one, "the turnip", "a turnip". Listing gives each stack its own count, rather than grouping stacks.
- **Menus:** the standard take and drop take the whole stack, labelled "Take all 99 turnips" and "Drop all 99 turnips". The new `takeOne` and `dropOne` offer "Take a turnip" and "Drop a turnip" for a stack of more than one. Each label and report is a message a game can reword.

## Consequences

- Choosing how many, with a number the player enters, is [#335](https://github.com/loominate-if/loominate-if/issues/335).
- A reference to a stack that merged into another is to an empty stack out of the world. Code that moves a stack and needs where its count went asks `stackIn`.
