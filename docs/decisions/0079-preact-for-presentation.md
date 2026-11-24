# 0079. Preact, with signals, for presentation

- **Status:** Accepted, 2026-11-24
- **Issue:** [#347](https://github.com/loominate-if/loominate-if/issues/347)
- **Supersedes:** [ADR 0003](0003-ui-rendering-approach.md)
- **Design:** [Layouts, regions, and widgets](../DESIGN.md#layouts-regions-and-widgets), [Open questions](../DESIGN.md#open-questions)

## Context

ADR 0003 chose vanilla DOM for `presentation`, so a plain story paid about 0.3 KB compressed for its UI, and said to revisit at Gate 2. Gate 2's game now exists, and presentation has grown: menus and the number form, the inventory, compass, clock, save menu, and start screen. Each of those updates its own DOM by hand when the game changes. The one DOM bug so far, a menu choice whose click closed the form it opened (#335), came from that.

Measured at Gate 2 (gzip, `bench/ui-rendering/`, `npm run build`):

| | UI cost in the benchmark story | Gate 1 game | Gate 2 game |
| --- | --- | --- | --- |
| Vanilla DOM | 0.36 KB | 31.4 KB | 47.9 KB |
| Preact | 6.0 KB | about 37.4 KB (+19%) | about 53.9 KB (+13%) |
| Preact with signals | 8.6 KB | about 40.0 KB (+27%) | about 56.5 KB (+18%) |
| Solid | 6.0 KB | about 37.4 KB | about 53.9 KB |

Presentation itself is 15.9 KB compressed, the whole shell included, in 3,570 lines of source.

## Decision

- **`presentation` moves to Preact, with `@preact/signals`.** Components are declarative, and those that read game state, such as the compass, inventory, and clock, update when what they read changes, through signals, without redrawing the rest.
- **Components are written in TSX,** compiled by TypeScript with Preact's JSX runtime, so markup is type-checked and there's no extra build step.
- **All at once:** presentation's views are rewritten in one change, keeping their behaviour, tests, and accessibility checks.
- **Widget views stay framework-agnostic.** The widget contract (`mount`, `update`, `destroy` on an element) doesn't change, so a game or kit can still write a widget's view in anything. Presentation's own views are Preact components behind that contract.
- **The cost is accepted:** about 8.6 KB more per game, a plain branching story included. Preact is a runtime dependency of `presentation` only. `core` stays DOM-free, and a game still depends only on core and presentation.

## Consequences

- Design principle 1 ("use it or not") now has an exception for presentation's framework: a plain story pays for it. Smaller games can still replace presentation's views, but not drop Preact from the bundle without replacing presentation.
- Phase 3's conversation widgets, the largest UI to come, are written as components from the start.
- `bench/ui-rendering/` keeps all its variants, signals included, so the cost can be checked again.
