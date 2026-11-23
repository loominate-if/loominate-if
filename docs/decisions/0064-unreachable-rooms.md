# 0064. Warning about rooms no exit leads to

- **Status:** Accepted, 2026-11-24
- **Issue:** [#72](https://github.com/loominate-if/loominate-if/issues/72)
- **Design:** [Compilation and checking](../DESIGN.md#compilation-and-checking), [ADR 0015](0015-compiler-extensions.md), [ADR 0033](0033-rooms-and-regions.md), [ADR 0034](0034-exits-and-directions.md)

## Context

The compiler should report references to undefined objects, topics, or facts, and passages tagged as rooms that aren't connected. Undefined objects and facts were already errors at the author's line, since inline code, directive arguments, and tag values are type-checked:

```
manor.weft:3:15 error: Property 'letterMising' does not exist on type '{ … }'. Did you mean 'letterMissing'?
```

Topics don't exist yet. Room passages are left out of the unreachable-passage warning, since exits lead to them, so a room nothing leads to went unnoticed. Exits are made by `connect(…)` in the game's code, which compiler checks couldn't see.

## Decision

- **What checks can see:** a check's context gains:
  - `start`, the start passage;
  - `isNamed(name)`, whether a link, a directive, or a string in code names a passage;
  - `uses(name)`, where a name is used in the game's TypeScript files and passages' inline code. Each use comes with the nearest call it's an argument of, and which argument, counting uses inside an object or array there. It's read from syntax alone, with no type checking, so it's cheap and package-agnostic. A name's own declaration, a property's key, and a member's name aren't uses.
- **The world model's check, "unreachable rooms":** it warns at a room passage's `room:` tag when all of these hold:
  - the room is a plain name;
  - nothing uses that name except its own definition and the first argument of `connect`, the room exits lead *from*;
  - no link or code names the passage;
  - it isn't the start passage.
- **No guessing:** the check reads code without running it, so it only warns when it's sure. Any other use, such as an exit's `to:`, a journey's `stopsAt:`, `move(you, attic)`, or a loop over rooms, might be a way in, so it stays quiet. It's a warning, not an error.

## Consequences

- Exits made only through code the check can't follow, such as rooms reached through an object's property, aren't warned about.
- Topics' references will be type-checked like facts when conversations add them.
