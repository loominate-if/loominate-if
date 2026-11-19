# 0020. Named effects

- **Status:** Accepted, 2026-11-19
- **Issue:** [#42](https://github.com/loominate-if/loominate-if/issues/42)
- **Design:** [Effects](../DESIGN.md#effects), [Accessibility](../DESIGN.md#accessibility), [ADR 0012](0012-rulebooks-hooks-registries.md), [ADR 0015](0015-compiler-extensions.md)

## Context

The design calls for fades, typewriter text, and shakes as named effects that passages use, with an API to register new ones, and raw DOM only as an escape hatch. Reduced-motion preferences must disable animated effects. Core is DOM-free and rendering is pure, so a passage can only ask for an effect; presentation has to play it.

## Decision

### In passages

- Core's compiler extension has one directive, `{effect name}`, with an optional `duration:` and `options:`: `{effect typewriter, duration: 2s}`. It's a content directive, like `{continue}`, so it ends the paragraph and compiles to a call of core's `namedEffect()`.
- `namedEffect()` returns a `NamedEffectNode`, `{ type: "effect", name, duration?, options? }`, a new member of `PassageNode` and `RenderedNode`. Rendering passes it through in order. It changes no state and isn't written to the event record, so the story so far, replays, and transcripts are unaffected.
- The name `NamedEffectNode` keeps it apart from a passage's state-changing `effects` (`on enter` and the other phases).
- One generic directive was chosen over one directive per effect, so an effect a game registers at runtime works in passages with no compiler extension, and effect names can't clash with variables (ADR 0004). The cost is that an unregistered name is caught when the passage is shown, not at compile time, as with layouts and widgets.

### In presentation

- `effects` is a registry (ADR 0012) of `{ target?, play, reduced? }`. Presentation registers `fade`, `typewriter`, and `shake`.
- `target: "next"`, the default, plays on the element drawn for the passage's next paragraph, link, or continue point. `target: "page"` plays on the page's root. An effect with nothing after it plays on nothing.
- `play(element, { duration?, options, page })` starts the effect and may return a finish function that ends it at once, in its final state. Effects use the Web Animations API, and do nothing where it's missing.
- **When effects play.** They play when a story starts on the page and after each move made on it. Undo, `refresh()`, and mounting a page over a loaded game show the passage without them.
- **Finishing early.** A click or key press anywhere on the page finishes every effect still playing, and so does the next move, so the player is never kept waiting.
- **Reduced motion.** When the player prefers reduced motion, the page plays an effect's `reduced` variant if it has one, and otherwise skips it. That's the default for effects a game registers too, so they're accessible without extra work. The built-in effects have no reduced variant: their text appears at once.
- **Screen readers.** The typewriter wraps each character in a transparent span and reveals them in turn. The text is in the live region from the start, so it's announced whole and at once.

## Consequences

- Beats (#41) can build on the same nodes and the same finish-early behavior.
- The core render output gained a node type. Code that switches over `RenderedNode` has to handle `effect`; presentation's page is the only consumer so far.
- Effect names aren't checked at compile time. A later compiler check could compare them against the effects a game registers, if the CLI learns them.
