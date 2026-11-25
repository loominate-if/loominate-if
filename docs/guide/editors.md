# Editing passage files

`@loominate-if/language-server` is a language server for passage files, for any editor that speaks the Language Server Protocol. It gives `.weft` files:

- **The compiler's diagnostics** as you type: parse errors, unknown passages, mistakes in inline code, and packages' checks, at the lines the dev server would report them.
- **TypeScript inside inline code:** completion, hover with types and doc comments, and go-to-definition, inside `{ … }`, from your `story.ts` and the packages you use.

[ADR 0118](../decisions/0118-language-server.md) records the decisions behind it.

## Running it

Install it beside the CLI, and have your editor start it for `.weft` files:

```sh
npm install --save-dev @loominate-if/language-server
npx loominate-language-server --stdio
```

- **It finds your game** from the file you open, by the nearest `loominate.config.ts` above it, and loads the packages that config lists, so their directives and checks work as they do in builds.
- **Passage files** are read as you edit them, unsaved. **TypeScript files**, such as `story.ts`, are read again when you save them.
- **Your `tsconfig.json`** should include the passage files, as `"include": ["*.ts", "*.weft"]`, so TypeScript sees them with the rest of the game.

## Editors

Each editor needs a small client that colors `.weft` files and starts the server. They're on their way:

- Zed ([#411](https://github.com/loominate-if/loominate-if/issues/411))
- BBEdit ([#412](https://github.com/loominate-if/loominate-if/issues/412))
- Sublime Text, with the LSP package ([#413](https://github.com/loominate-if/loominate-if/issues/413))
- VS Code ([#414](https://github.com/loominate-if/loominate-if/issues/414))

Any other editor that can start a language server for a file type can use it now, with the command above.
