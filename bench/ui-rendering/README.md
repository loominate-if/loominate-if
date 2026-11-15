# UI rendering benchmark

The measurements behind [ADR 0003](../../docs/decisions/0003-ui-rendering-approach.md): how much a plain branching story pays for its UI with vanilla DOM, Preact, or Solid.

Every variant renders the same four-passage story on this checkout's `@loominate-if/core`, with the same features:
- passage text, link buttons, and a continue button;
- a guarded link shown disabled with its reason;
- undo, and a "story so far" drawer built from the event record;
- an `aria-live` main region, with focus moved to it after each move.

This folder isn't a workspace package. It has its own `package-lock.json` so the framework versions stay pinned, and nothing here becomes a project dependency.

```sh
cd bench/ui-rendering
npm ci
npm run build   # bundles each variant with esbuild and prints minified, gzip, and brotli sizes
npm run smoke   # plays one script through each variant in jsdom; fails if they behave differently
```

`baseline` is the runtime and story with no UI, so "UI cost" is each variant's size minus the baseline. Run it again at Gate 2, when the compass, inventory, and conversation widgets exist, to decide whether to revisit the ADR.
