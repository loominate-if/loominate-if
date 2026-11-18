# 0013. Tagged-template text

- **Status:** Accepted, 2026-11-18
- **Issue:** [#27](https://github.com/loominate-if/loominate-if/issues/27)
- **Design:** [TypeScript modules](../DESIGN.md#typescript-modules), design principles 3 (rendering is pure) and 7 (open library)

## Context

Printed text in TypeScript modules is written with a `t` tagged template, and the world model adds adv3Lite-style message parameters for articles, pronouns, plurals, and verb agreement (#70). Two things had to be settled first: when a template's values are read, and how message parameters are written.

JavaScript evaluates every `${…}` when the template is created. A description written as `t`The lamp is ${lamp.isLit ? "lit" : "dark"}.`` in an object definition would be fixed when the module loads, and an object definition only accepts state values or functions.

## Decision

### `t` returns a lazy, pure `Text`

- `t`…`` returns a `Text`: a function that renders the template each time it's called, as `text(context?)`, and returns a string. Object definitions treat it as behavior, so `description: t`…`` is allowed and never stored as state.
- In `${}`, strings and numbers print, another `Text` renders with the same context, and a function runs at render time with the context, so `${() => (lamp.isLit ? "lit" : "dark")}` stays current. Anything else (`undefined`, booleans, objects outside a message parameter) is an error naming the value, and the types already reject most of them.
- Rendering is pure: an object or random stream changed while a text renders is an error, in a passage or an effect alike. An effect changes state first, then prints.
- A text whose function reads the object being defined needs the function's return type written, `${(): string => …}`, because TypeScript can't infer a type that refers to itself.

### Message parameters are adv3Lite braces

- `{name args…}` in the template is a message parameter: `{The ${door}}`, `{subj actor}`. The first word is its name (case-sensitive, so `the` and `The` are separate parameters). The rest are arguments: words as written, and `${}` values, which is how a parameter receives an object with its type checked.
- Parameters are looked up by name in the `messageParameters` registry (ADR 0012) when the text renders, so a kit that loads after a text is written can still supply one. A parameter gets its name, its arguments, the render context, and the text, and returns a string.
- The render context (`text({ actor: bob })`) is how the world model passes the actor and the objects of the current action; core only passes it on.
- Core registers no parameters. An unregistered one is an error at render time naming it.
- `{{` and `}}` print a literal brace. An unmatched brace, a brace inside a parameter, or a parameter without a name is an error when the template is created, at module load.

## Consequences

- Plain stories pay nothing: `t` is a small core module, and parameters cost nothing until a kit registers them. Braces are reserved in `t` text, though not in passage prose.
- A misspelled parameter fails only when the text renders. Checking names at compile time needs the compiler to know what's registered, which is [#235](https://github.com/loominate-if/loominate-if/issues/235).
- `t` text has no line ID, so skip-read, voice, and translation can't key on it yet. That belongs to localization ([#60](https://github.com/loominate-if/loominate-if/issues/60)).
- `t` renders plain strings. Emphasis and links in `t` text would need it to render to prose parts instead, which can come later without changing how templates are written.
