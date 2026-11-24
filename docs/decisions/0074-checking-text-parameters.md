# 0074. Checking `t` templates' parameters at compile time

- **Status:** Accepted, 2026-11-24
- **Issue:** [#235](https://github.com/loominate-if/loominate-if/issues/235)
- **Design:** [TypeScript modules](../DESIGN.md#typescript-modules), [ADR 0013](0013-text-templates.md), [ADR 0038](0038-message-parameters.md)

## Context

`t` templates write message parameters in braces, as `{The ${door}}`. Core parses the braces when the text is made and looks up each name when it renders, so mistakes show only at runtime. Worse, with the world model, any name nobody registered is read as a verb, so a misspelled `{teh ${door}}` prints "teh" rather than failing. Design principle 6 asks for these to be caught at compile time.

## Decision

- **Packages declare their names** in their compiler extension's `messageParameters`: the names they register, and any fallback that reads other names, with what it reads them as and the words it knows.
  - The world model declares its articles, `subj`, and pronouns, and its verb fallback with its irregular verbs.
  - Its extension imports nothing, so it keeps its own copy, and a test checks it matches what the world model registers.
- **The compiler doesn't run packages' code** to find names, so the language server can check text the same way.
- **A game's own names** are those its code registers with a literal, as `messageParameters.register("shout", …)`.
- **The check** runs after type-checking, over every `t` template in the game's TypeScript and in passages' inline code, mapped back to the passage's lines. A template counts if its tag resolves to core's `t`, however it's imported.
  - Braces are parsed as core parses them. A `}` with no `{`, a `{` with no `}`, a `{` inside a parameter, and a parameter whose first word isn't a name are errors.
  - With no fallback, an unregistered name is an error, with the closest registered name, if one is near.
  - **With a fallback, an unregistered name is read by it, as before.** The check warns only when the name is one or two edits from a registered one, counting a swap of neighbouring letters as one edit, as "teh" for "the". It doesn't warn when the name is a word the fallback knows, so `{is}` is never taken for `{its}`, or `{has}` for `{his}`.

## Consequences

- A verb one or two letters from a pronoun or article, and not among the irregular verbs, is warned of, as a rare `{be}` would be for `{he}`. A fallback can list more words it knows.
- A parameter registered with a name worked out at runtime isn't known to the check. A game registering one that way gets errors for its uses, without the world model, or near-miss warnings, with it.
