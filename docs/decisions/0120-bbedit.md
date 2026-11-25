# 0120. BBEdit support

- **Status:** Accepted, 2026-11-25
- **Issue:** [#412](https://github.com/loominate-if/loominate-if/issues/412)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0118](0118-language-server.md), [ADR 0119](0119-tree-sitter-grammar-and-zed.md)

## Context

BBEdit colors a language through a language module and starts a language server named in it. It looks the server up by command name: in its Language Servers folder, in packages, then on the login shell's PATH. Codeless modules (plists) color only comments, strings, and whole words from a list, and a list of directive names would color "in", "no", and "if" wherever they appear in prose. The server must also be the game's own, as in Zed (ADR 0119), but BBEdit runs one command for every project.

## Decision

- **A declarative language module,** `packages/bbedit/Loominate IF.bbdlm` (tested with BBEdit 16.1; Bare Bones doesn't say which version added them), rather than a codeless one. Its pattern runs color headers, directive names right after `{`, links, line-start comments, and escapes. A delimited run colors block comments. Its function patterns list passages in the function menu.
- **Directives it knows** are the grammar's (ADR 0119), longest first, so `{on first visit` isn't read as a shorter name. A test keeps the two lists the same.
- **The server is a proxy,** `loominate-language-server` in BBEdit's Language Servers folder. It reads the project folder from the `initialize` request, finds the nearest language server at or above it (the game's `node_modules/@loominate-if/language-server`, or a checkout's `packages/language-server`), and hands the connection to it. When there's none, it answers `initialize` with an error that says what to install.
- **Node.js is found** on PATH, then through the login shell (so nvm and other version managers work), then in nvm's folder, because apps opened from the Dock don't get the shell's PATH.
- **Installed with a script,** `packages/bbedit/install.sh`, which copies the module and the proxy into BBEdit's Application Support folder.

## Consequences

- Inline code isn't colored as TypeScript: a declarative module can't embed another language outside HTML templates.
- BBEdit doesn't ask for hover information when the mouse rests on a word, so the server's hovers don't show there.
- Updating the checkout needs the install script again, as BBEdit keeps copies.
- A kit's directives color as prose until the grammar and module learn them.
