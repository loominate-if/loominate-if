# 0038. Message parameters for English

- **Status:** Accepted, 2026-11-22
- **Issue:** [#70](https://github.com/loominate-if/loominate-if/issues/70)
- **Design:** [TypeScript modules](../DESIGN.md#typescript-modules), [ADR 0013](0013-text-templates.md)

## Context

ADR 0013 gave `t` templates adv3Lite-style message parameters, `{the ${door}}`, looked up by name in a registry that core leaves empty. The world model wrote its own messages by gluing names together, and names carried their article ("the cellar door"), so "North, to the library" and "The cellar door is locked." only worked by convention. Templates need to adapt to the plural, person, and gender of what they refer to.

## Decision

### Names and grammar

- A thing's `name` is its bare noun: "cellar door", "Mira". The world model's examples and messages are rewritten to match. A name with its article written in reads "the the cellar door".
- Grammar is optional properties on the thing:
  - `isProper`: defaults to whether the name starts with a capital.
  - `isPlural`
  - `article`: the indefinite article, when "a" or "an" guessed from the spelling is wrong, or "some".
  - `pronoun`: "she", "he", "they", or "it". It defaults to "they" for a plural or a body, so a person is never "it", and to "it" otherwise.
- The player's current body is "you", with "you" verbs, following the player's mind through switches and swaps. A mind given to a parameter is named by its body. A game-wide first or third person belongs to narration person (#66).

### Parameters

- `the`, `The`, `a`, `A` name a thing with an article, capitalized as the parameter is.
- `he`, `him`, `his`, `himself`, and their capitals, are the four pronoun forms, registered under every word for them (`she`, `they`, `it`, `them`, `their`, `its`, `herself`, `themselves`, `itself`), so an author writes the word that reads naturally. `her` isn't registered, being both `him` and `his`.
- Any parameter takes `subj` and at most one thing. `subj` makes the thing the subject, which later parameters without a thing refer to: `{The subj ${cat}} {sleeps}. {He} {snores}.`. `{subj ${cat}}` marks one without printing.
- A subject pronoun becomes the subject, and verbs after it agree with the pronoun. Verbs agree with the word used: a "they" person is "Sam falls" but "they fall".

### Verbs

- Any word in braces that isn't a registered parameter is a verb, written as for "it" ("falls", "is", "carries", "doesn't"). It agrees with the subject, or with the thing it's given, as in `{is ${door}}`. A plural, "you", or the pronoun "they" takes the plain form: by a short table for irregulars (is, was, has, does, goes, and their negatives), and by spelling otherwise ("carries" to "carry", "touches" to "touch", "falls" to "fall").
- To allow an open set of verbs, core gains `messageFallbacks`: a registry of parameters for names nobody registered, tried in order. A name none renders is still an error.
- Core also gives parameters `shared`, a map the parameters of one rendering share, which is how a subject reaches later verbs.

## Consequences

- A misspelled parameter now prints as a verb instead of failing, such as `{teh ${door}}` printing "teh". The compile-time check (#235) will need to know which words are parameters and treat the rest as verbs, perhaps warning on unknown words.
- The library message table (#71) can write its messages as `t` templates with these parameters, so a theme or translation changes the words without losing agreement.
- Other languages register their own parameters and fallbacks; English isn't built into core.
