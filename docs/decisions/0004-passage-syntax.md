# 0004. Passage syntax

- **Status:** Accepted, 2026-11-15
- **Issue:** [#5](https://github.com/loominate-if/loominate-if/issues/5)
- **Design:** [Passage files](../DESIGN.md#passage-files), [Inline code and effect phases](../DESIGN.md#inline-code-and-effect-phases), [Open questions](../DESIGN.md#open-questions)

## Context

The design shows passage files by example: Tweego-style `::` headers, prose by default, and expressions and directives in `{ }`. The parser ([#29](https://github.com/loominate-if/loominate-if/issues/29)), the virtual TypeScript modules ([#30](https://github.com/loominate-if/loominate-if/issues/30)), line IDs ([#34](https://github.com/loominate-if/loominate-if/issues/34)), and the compiler extension API ([#187](https://github.com/loominate-if/loominate-if/issues/187)) all need the exact rules. The examples left these open:

- `{station.theName}` prints a value, while `{beat 1.5s}` and `{wait}` are directives. Both start with a plain word.
- Directive arguments appear in several forms: `{beat 1.5s}`, `{ask: letter, when: …}`, `{show mira smiling, dissolve}`, and `{on enter: …}`.
- There was no way to write a literal brace in prose.
- Link forms, guard options, tag separators, comments, paragraphs, and formatting weren't specified.

Kits register their own directives, so the set of directive names isn't fixed. The rules have to stay unambiguous as kits are loaded, and mistakes should be compile errors (design principle 6).

## Decision

### Passage headers

```
:: Name [tag, role: value, …]
```

- A line starting with `::` begins a passage. Everything until the next header belongs to it.
- Names may contain letters, digits, spaces, and punctuation other than `[ ] { } \`, and may not contain `->`. Leading and trailing spaces are trimmed. Names are unique within a game.
- The tag list is optional and **comma-separated**, because roles use `key: value`: `[scene]`, `[room: platform]`, `[actor: butler, state: onDuty]`. Twee 3 separates tags with spaces; an importer ([#157](https://github.com/loominate-if/loominate-if/issues/157)) converts them.
- Nothing else may follow the tag list. Twee 3's position metadata is reserved for an importer to drop or translate.

### Prose

- **Paragraphs** are separated by one or more blank lines. A single line break inside a paragraph becomes a space, so prose can be wrapped freely.
- **Indentation** at the start of a line is removed.
- A line holding only a directive or a comment produces no text and doesn't split a paragraph by itself. Blank lines still do.
- The paragraph is the unit #34 assigns line IDs to, unless that ADR splits it further.
- **Formatting:** `*emphasis*` and `**strong**` only. An opening `*` must be followed by a non-space and a closing `*` preceded by one, so `5 * 3` stays literal. An opening `*` with no closing one is a compile error.
- **No raw HTML.** All output goes through the event record, so it stays accessible and every view (page, story log, transcript) can render it.

### Escapes

- A backslash before any ASCII punctuation character makes it literal: `\{`, `\}`, `\[`, `\*`, `\@`, `\\`.
- A backslash before anything else is a compile error that names the character.
- A `}` in prose that doesn't close a directive is a compile error that suggests `\}`.
- Only `[[` starts a link. A single `[` or `]` is literal.

### Comments

- `/* … */` anywhere in prose, and across lines.
- `//` only at the start of a line, after any indentation, so URLs in prose still work.
- Inside `{ }`, TypeScript code uses TypeScript comments as usual.

### Inside `{ }`: directives and printed values

```
{name}                      directive with no arguments
{name arg, arg, key: value} directive with arguments
{name: code}                directive whose argument is code (effect phases)
{expression}                anything else: a TypeScript expression, printed
```

- **Directive or expression.** The text after `{` is a directive when it starts with a registered directive name followed by a space, `,`, `:`, or `}`. Otherwise it's a TypeScript expression. `{station.theName}` is an expression even if `station` were a directive name, because `.` follows it.
- **Multi-word names** such as `on enter`, `on first visit`, and `else if` are registered as a whole; the longest matching name wins.
- **Clashes with code are errors.** If a directive name is also a binding in the passage's scope, `{name …}` is a compile error naming the package that registered the directive, for example: "`show` is a directive from @loominate-if/vn and also a variable here. Write `{(show)}` to print the variable, or rename it." Wrapping an expression in parentheses always prints it.
- **Printed values** must be `string` or `number`. Anything else is a type error, so `{station}` can't print `[object Object]`.
- **Braces in code are matched by TypeScript's scanner**, so `{on enter: if (x) { y() }}`, string literals, and template literals containing braces all work.

### Directive arguments

- Arguments are separated by top-level commas (commas outside brackets, strings, and template literals).
- Each argument is either positional or named (`key: value`).
- Each directive declares its arguments when it registers through the extension API (#187): their names, order, and what kind each takes, such as a TypeScript expression, a duration (`1.5s`, `300ms`), a passage target, or a list of words (`mira smiling`). The compiler checks arguments against that declaration and reports errors at the argument's position.
- A **passage target** is written `-> Name`, as in `{continue -> Platform}`.
- A colon directly after the directive name means the rest, up to the matching `}`, is TypeScript statements. Only the effect phases take this form: `{on enter: …}`, `{on first visit: …}`, `{on leave: …}`.
- Directives may be **scoped to passage roles**. Topic entries (`{ask …}`, `{tell …}`, `{show …}`, `{give …}`) are registered for `actor:` passages only. Two packages registering the same name in the same scope is a compile error ([#187](https://github.com/loominate-if/loominate-if/issues/187) said "warn"; an error is safer, because the meaning would otherwise depend on load order).

This changes the topic examples in the design from `{ask: letter, …}` to `{ask letter, …}`.

### Conditional blocks

```
{if cond} … {else if cond} … {else} … {/if}
```

- Blocks nest, and work across whole lines or inside a sentence: `You see {if lit}a lamp{else}nothing{/if}.`
- A block that begins inside a paragraph must end inside it.
- An `{if}` with no `{/if}`, or a `{/if}` with no `{if}`, is a compile error at the opening directive's line.
- For a short choice inside a sentence, an expression works too: `{lit ? "a lamp" : "nothing"}`.

### Links

```
[[label -> Target]]
[[Target]]
[[label -> Target]]{when cond}
[[label -> Target]]{when cond, disabled}
[[label -> Target]]{when cond, reason: "It's too dark to go down."}
```

- `[[Target]]` uses the passage name as the label. Twine's `[[label|Target]]` form isn't supported; an importer converts it.
- Labels may contain printed values and formatting: `[[Ask about {topic.name} -> Hall]]`. A literal `->` in a label is written `-\>`.
- Targets are passage names and are checked at compile time. Choosing a target at runtime is done in code, with `goTo`.
- Links may appear inside a paragraph or on their own line.
- **Guards** follow the link directly, on the same line, with only spaces between. They compile to core's `LinkGuard`:
  - `{when cond}` uses the game-wide default mode (hidden, unless the game sets another).
  - `{when cond, hidden}` or `{when cond, disabled}` sets the mode for this link.
  - `{when cond, reason: "…"}` shows the link disabled with the reason. The reason is prose and may contain printed values.
- A `{when}` that doesn't follow a link is a compile error.
- **No state changes on clicking a link.** That would need a new effect phase. Put the change in the target passage's `on enter`.

### Line forms

Packages may register forms recognized at the start of a line, such as the VN kit's `@speaker (expression) "…"` ([#176](https://github.com/loominate-if/loominate-if/issues/176)). Without a registered form, a leading `@` is plain prose. With one, write `\@` for a literal `@`.

### Example

```
:: Cellar Stairs [room: stairs]
/* The lantern matters here. */
{on enter: if (!player.has(lantern)) player.fear += 1}

The steps go down *further* than they should.
{if lantern.isLit}
  Your lantern throws long shadows against the stone.
{else}
  You can't see the bottom. Somewhere below, {rat.theName} \{scratches\}.
{/if}

[[Go down -> Cellar]]{when lantern.isLit, reason: "It's too dark to go down."}
[[Back up -> Kitchen]]
```

## Consequences

- The parser (#29) has a complete grammar to implement. Directives other than `if`/`else`, links, and the header are defined by registration, so core's own directives (`if`, the effect phases, `beat`, `wait`, `continue`, `when`) use the same extension API as kits.
- Loading a kit can make an existing passage fail to compile, if the kit's directive name clashes with a variable. The error names the package and the fix, so the clash is never silent.
- Topic entries in the design move from `{ask: …}` to `{ask …}`. Scoping them to `actor:` passages lets the VN kit's stage `{show …}` coexist with the `{show …}` topic entry.
- Tags and links differ from Twee 3 and Twine (comma-separated tags, no `|` links), so importing Twine stories (#157) needs a conversion step rather than reading files as-is.
- Changing this grammar later breaks existing games, so changes after Phase 1 need a migration path.
