# 0003. UI rendering approach

- **Status:** Superseded by [ADR 0079](0079-preact-for-presentation.md), 2026-11-24
- **Issue:** [#6](https://github.com/loominate-if/loominate-if/issues/6)
- **Design:** [Layouts, regions, and widgets](../DESIGN.md#layouts-regions-and-widgets), [Open questions](../DESIGN.md#open-questions)

## Context

`presentation` needs a way to put passages, layouts, and widgets on screen. The candidates were vanilla DOM, or a small framework such as Preact or Solid.

The deciding principle is "Use it or not": a plain branching story must never pay for what it doesn't use, in bundle size or in concepts. Widgets are headless by design, meaning the runtime supplies their logic and state and presentation is separate. That makes it possible to keep the rendering choice out of the widget model.

### Measurements

[`bench/ui-rendering/`](../../bench/ui-rendering/) builds the same small story three ways on the real `@loominate-if/core`. Each variant has the same features:

- passage text, link buttons, and a continue button;
- a guarded link shown disabled with its reason;
- undo, and a "story so far" drawer built from the event record;
- an `aria-live` main region, with focus moved to it after each move.

A jsdom script plays one walkthrough through all three and checks they behave identically.

Builds use esbuild 0.28.2, minified ES2022, with core bundled in. The frameworks are Preact 11.1.1 with hooks, and Solid 1.9.18 compiled with babel-preset-solid 1.9.16. Sizes are in bytes, measured 2026-11-15:

| Variant | Minified | gzip | brotli | UI cost over runtime (brotli) |
| --- | ---: | ---: | ---: | ---: |
| Runtime only, no UI | 9,800 | 3,965 | 3,570 | — |
| Vanilla DOM | 10,678 | 4,334 | 3,857 | +287 |
| Preact | 24,334 | 9,893 | 8,943 | +5,373 |
| Solid | 25,328 | 9,942 | 9,030 | +5,460 |

- Preact and Solid cost about the same here: roughly 5.4 KB compressed, which is more than the whole core runtime. Either one would more than double the JavaScript a plain story ships.
- All three are small in absolute terms, smaller than a typical web font. Bundle size alone doesn't rule a framework out, but the principle does: plain stories shouldn't carry it.
- A framework's real benefit is less hand-written update code in complex widgets such as inventory lists, the compass, and conversation topics. It doesn't help with the page itself, because accessibility and keyboard handling are hand-built either way.

## Decision

- **`presentation` renders with vanilla DOM.** The page, layouts, regions, and the built-in widgets use the DOM directly, with small internal helpers as needed. `presentation` has no UI framework dependency.
- **Widget views are framework-agnostic.** A widget's logic and state stay headless. Its view meets a small lifecycle contract: mount into an element, update when its state changes, unmount. The exact API belongs to [#38](https://github.com/loominate-if/loominate-if/issues/38).
- **Authors and kits may write views in any framework** (Preact, Solid, Lit, or anything else) through a thin adapter that meets the same contract. Only games that use a framework ship it.
- **Revisit at Gate 2,** when the compass, inventory, and conversation widgets exist. Rerun `bench/ui-rendering/`. If the built-in widgets have grown enough update code that a framework would be clearly simpler, reconsider the internal choice. The widget contract means a change wouldn't break author widgets.

## Consequences

- A plain branching story pays about 0.3 KB compressed for its UI, on top of the runtime.
- `presentation` has to implement its own efficient updates for lists and other changing regions, for example keyed updates. Those helpers are internal, not public API.
- The widget contract is public API from Phase 1, so it needs care in #38: it must suit both hand-written DOM views and framework adapters.
- `bench/` is a new top-level folder for benchmarks that inform decisions. It isn't part of the pnpm workspace, so its dependencies stay out of the project. It is linted and formatted with the rest of the repo.
