# UI rendering benchmark

The measurements behind [ADR 0003](../../docs/decisions/0003-ui-rendering-approach.md) and [ADR 0079](../../docs/decisions/0079-preact-for-presentation.md): how much a plain branching story pays for its UI with vanilla DOM, Preact, Preact with signals, or Solid.

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

`baseline` is the runtime and story with no UI, so "UI cost" is each variant's size minus the baseline.

At Gate 2 (ADR 0079), the UI cost, gzipped, was 0.36 KB for vanilla DOM, 6.0 KB for Preact, 8.6 KB for Preact with signals, and 6.0 KB for Solid. Presentation moved to Preact with signals.
