# 0118. The language server

- **Status:** Accepted, 2026-11-25
- **Issue:** [#148](https://github.com/loominate-if/loominate-if/issues/148)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0001](0001-repository-layout.md), [ADR 0005](0005-passage-modules.md)

## Context

The design asks for a language server for passage files, built the way Svelte and Vue tooling are, for type checking, completion, and go-to-definition inside inline code. ADR 0001 named the stack, Volar.js, and placed it in `packages/language-server`. The compiler already turns each passage file into a TypeScript module with mappings back to the author's text (ADR 0005), and reports every problem at the author's lines. The author doesn't use VS Code, so the server has to work for any editor, with each editor's client a task of its own (#411 to #414).

## Decision

- **Editor-agnostic:** `@loominate-if/language-server`, run as `loominate-language-server --stdio`, for any LSP client. It's published with the other packages.
- **Volar.js for TypeScript:** each passage file is a virtual code whose embedded TypeScript is the compiler's generated module, with the compiler's verbatim mappings. `volar-service-typescript` gives completion, hover, and go-to-definition through them.
- **Diagnostics from the compiler,** not from TypeScript's check of the generated code. TypeScript's own diagnostics on passage files are off, since mappings carry `verification: false`. A plugin reports the compiler session's diagnostics for each passage file, as the dev server does, leaving out those that follow from another.
- **A game per `loominate.config.ts`:** the server finds a project's game by walking up to its config, loads it with the CLI's `loadConfig` before any of its files are read, and keeps a compiler session over its files. Passage files are updated as they're edited; TypeScript files are read again from disk as they're saved.
- **The compiler's passage-names module** isn't given to TypeScript: Volar wants an extra file to belong to one passage file, while this one is shared, and only the generated code's types use it.
- **Tested in process:** the server can talk over given streams, so tests drive it with an LSP client in the same process, on sources.
- **Dependencies:** `@volar/language-server`, `@volar/language-core`, `@volar/typescript`, `volar-service-typescript`, `vscode-languageserver`, and `vscode-uri`, all tooling, never in a game's bundle.

## Consequences

- Every editor client is thin: it colors `.weft` files and starts the server.
- Passage-aware features are a plugin on the same server (#410): completion of passage names, directives, and tag roles, from the compiler session's parsed files and its packages' syntax, and go-to-definition and find-references for passage names. TypeScript's completions in inline code are marked additional, so they merge with these, and leave out the generated modules' own names (`$`-prefixed helpers and `passages`).
- An unsaved change to `story.ts` reaches passage files' diagnostics only on save.
