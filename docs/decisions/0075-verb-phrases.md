# 0075. Verb phrases

- **Status:** Accepted, 2026-11-24
- **Issue:** [#79](https://github.com/loominate-if/loominate-if/issues/79)
- **Design:** [Future parser](../DESIGN.md#future-parser), [ADR 0043](0043-vocabulary.md)

## Context

A parser and an autocomplete command line are later optional packages. To keep them possible with no change to game logic, actions should carry verb phrases from version one, as things carry vocabulary (ADR 0043). They should be typed and optional.

## Decision

- **A phrase is a pattern:** words, a slot for each of the action's things by role, as `{thing}` or `{tool}`, and optional words in parentheses: `verbs: ["unlock {thing} with {tool}", "pick (up) {thing}"]`.
- **The compiler checks the slots.** TypeScript's types can't reject a stray slot inside a string. So, as with `t` templates (ADR 0074), the compiler finds each call of core's `action` with a type argument, and reports a slot that isn't one of that type's keys at the phrase.
- **Core reads phrases as the game loads,** into parts (`action.verbs`), and rejects unmatched braces or parentheses and a phrase with no words. It doesn't check roles. An action's roles are its type argument's keys, which core can't see: a role may come only from code, with no `with` for it.
- **Phrases are lowercased** in their parts, as written in `text`.
- **The world model's standard actions** come with the usual IF phrases: examine ("examine", "x", "look at", "inspect"), take ("take", "get", "pick up"), drop ("drop", "put down"), open, close ("close", "shut"), lock, unlock, and the stack actions, such as "take {count} {thing}".

## Consequences

- A package written in JavaScript gets no role check for its phrases, only the syntax check as the game loads.
- How a parser matches phrases, by vocabulary and scope, and how it disambiguates, is for the parser package.
