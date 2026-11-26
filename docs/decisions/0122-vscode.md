# 0122. The VS Code extension

- **Status:** Accepted, 2026-11-25
- **Issue:** [#414](https://github.com/loominate-if/loominate-if/issues/414)
- **Design:** [Tooling](../DESIGN.md#tooling-1), [ADR 0001](0001-repository-layout.md), [ADR 0120](0120-bbedit.md)

## Context

ADR 0001 placed a thin VS Code client in `packages/vscode`: a TextMate grammar and an LSP client. VS Code bundles TypeScript's TextMate grammar, so passage files can embed it. The server must be the game's own, as in the other editors (ADRs 0119 and 0120).

## Decision

- **A TextMate grammar** after ADR 0004, embedding `source.ts` in inline code and directives, with `meta.embedded.weft` marked as TypeScript so VS Code's brackets and comments follow it there. It knows the grammar's directives (ADR 0119), longest first, and a test keeps the list in step. Its nested braces come out right, because TypeScript's own rules match them before the inline code's closing brace.
- **Tested as VS Code tokenizes,** with `vscode-textmate` and `vscode-oniguruma`, against a stand-in for the TypeScript grammar.
- **The client** is `vscode-languageclient`, bundled with esbuild into `dist/extension.js`. It starts the same proxy as BBEdit with Node.js: the one on PATH, or the `loominate.nodePath` setting. The proxy reads the workspace folder and hands the connection to the nearest language server. It uses that Node, not VS Code's own, because loading `loominate.config.ts` needs the Node the CLI supports.
- **Packaged as a `.vsix`** with `vsce`, by `pnpm --filter loominate package`. It's private, not on the Marketplace yet, and named `loominate`, as VS Code requires an unscoped name.
- **The language server's paths** are kept in one form, resolved and with a capital drive letter on Windows, since VS Code sends `c:`.

## Consequences

- Publishing to the Marketplace (or Open VSX) is a step of its own, needing a publisher account.
- Authors need Node.js on PATH, as they do for the CLI.
