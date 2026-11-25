# 0119. The Tree-sitter grammar and the Zed extension

- **Status:** Accepted, 2026-11-25
- **Issue:** [#411](https://github.com/loominate-if/loominate-if/issues/411)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0004](0004-passage-syntax.md), [ADR 0118](0118-language-server.md)

## Context

Zed colors a language only through a Tree-sitter grammar, which it fetches from a git repository at a commit, and starts language servers from an extension written in Rust and compiled to WebAssembly. The language server (ADR 0118) gives diagnostics and completion but no coloring. Passage syntax (ADR 0004) can't be parsed exactly without the game's packages: whether `{name …}` is a directive or a printed value depends on the directive names they register.

## Decision

- **The grammar lives in this repository,** as `packages/tree-sitter-weft`, with its generated parser committed, as Tree-sitter grammars do. Its corpus and highlighting tests run in `pnpm test`, which also checks the generated parser is up to date. One place holds the syntax, and other Tree-sitter editors (Neovim, Helix) can use it later. It's private, not published to npm.
- **It's for coloring, not meaning.** The compiler's parser decides what a file means. The grammar keeps the shapes: headers and tags, links, `{ … }` with nested braces and strings, comments, escapes, and single-line `*emphasis*` and `**strong**`.
- **Directives it knows by name:** `if`, `else if`, and `else`, and those core and the world model register. A test keeps the list in step with the packages. Others, from kits, read as code, which is what they'd look like without the kit.
- **Inline code is TypeScript,** injected into `{ … }` expressions, code after `:`, and directives' arguments.
- **The Zed extension is `packages/zed`:** the language's settings, queries (highlights and injections copied from the grammar, which a test checks), brackets, and an outline of passages. Its Rust code starts the server.
- **The server comes from the game first.** The extension runs the opened folder's own `node_modules/@loominate-if/language-server`, so the compiler matches the game's. In a Loominate IF checkout, it runs the checkout's `packages/language-server`. Otherwise it installs the latest release from npm into its own folder.
- **A Node launcher picks it.** Zed doesn't show extensions every file (ignored folders such as `node_modules` among them), so the extension starts a small script in Node that checks the real file system, in that order, and explains what to install when none is there.
- **The grammar's commit:** `extension.toml` names the commit Zed builds the grammar from. A test checks that commit's generated parser is the current one, so a grammar change needs two commits: the change, then the `rev` pointing at it. CI fetches the full history for this.

## Consequences

- Zed users install the extension as a dev extension until it's published to Zed's gallery, which needs the extension in a repository Zed's registry can build.
- A kit's directives color as code until the grammar learns them; adding a kit's names to the grammar is a one-line change, with the test naming what's missing.
- Emphasis across lines colors as plain prose.
