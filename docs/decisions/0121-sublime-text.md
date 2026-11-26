# 0121. Sublime Text support

- **Status:** Withdrawn, 2026-11-25. Sublime Text support was removed ([#423](https://github.com/loominate-if/loominate-if/issues/423)): testing on Windows, its LSP plugin failed silently (the server never registered, [#421](https://github.com/loominate-if/loominate-if/issues/421)), and Sublime and its LSP package report only to the console, so each problem was slow to find. Zed, BBEdit, and VS Code remain.
- **Issue:** [#413](https://github.com/loominate-if/loominate-if/issues/413)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0118](0118-language-server.md), [ADR 0120](0120-bbedit.md)

## Context

Sublime Text colors a language with a `.sublime-syntax` file, and talks to language servers through the third-party LSP package (sublimelsp). That package runs a configured command, one per window, in which the game's own server has to be found, as in Zed and BBEdit (ADRs 0119 and 0120).

## Decision

- **A package,** `packages/sublime`, linked into Sublime's Packages folder as `Loominate IF`, so updates to a checkout apply without copying.
- **The syntax** follows ADR 0004. It embeds Sublime's TypeScript syntax in inline code, in code after a directive's `:`, and in directives' arguments, and knows the grammar's directives (ADR 0119), longest first. A test keeps the list in step. It comes with a syntax test file, which Sublime runs.
- **A small LSP plugin,** `plugin.py`, registers `LSP-loominate` with the LSP package, with its settings in `LSP-loominate.sublime-settings`. It does nothing when the LSP package isn't installed, so highlighting works on its own.
- **The same proxy as BBEdit:** the server command runs `loominate-proxy.mjs` with Node. The proxy reads the project folder from `initialize` and hands the connection to the nearest language server at or above it. A test keeps the two copies the same.

## Consequences

- An inline expression holding its own `{ … }`, such as `{on enter: if (x) { y() }}`, ends its TypeScript coloring at the first `}`. Sublime's embedding stops at the first match of its escape pattern.
- Node.js must be on the PATH Sublime Text sees.
