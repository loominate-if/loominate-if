# Editing passage files

`@loominate-if/language-server` is a language server for passage files, for any editor that speaks the Language Server Protocol. It gives `.weft` files:

- **The compiler's diagnostics** as you type: parse errors, unknown passages, mistakes in inline code, and packages' checks, at the lines the dev server would report them.
- **TypeScript inside inline code:** completion, hover with types and doc comments, and go-to-definition, inside `{ … }`, from your `story.ts` and the packages you use.
- **Passages:** completion of passage names after `[[` and `->`, from all your passage files; go-to-definition from a link to its passage's header; and find-references, listing every link to a passage.
- **Directives and tag roles:** completion of directives right after `{`, and of tag roles such as `room:` in a passage's header, including those your packages add.

[ADR 0118](../decisions/0118-language-server.md) records the decisions behind it.

## Running it

Install it beside the CLI, and have your editor start it for `.weft` files:

```sh
npm install --save-dev @loominate-if/language-server
npx loominate-language-server --stdio
```

- **It finds your game** from the file you open, by the nearest `loominate.config.ts` above it, and loads the packages that config lists, so their directives and checks work as they do in builds.
- **Passage files** are read as you edit them, unsaved. **TypeScript files**, such as `story.ts`, are read again when you save them.

## Zed

The Zed extension in `packages/zed` colors passage files, with TypeScript coloring inside `{ … }`, and starts the language server. It lists your passages in the outline (**outline: toggle** in the command palette) and in symbol search.

- **Install it** as a dev extension until it's in Zed's extension gallery: in Zed, open the command palette, run **zed: install dev extension**, and choose the `packages/zed` folder of a Loominate IF checkout. Zed builds it with Rust, which you install from [rustup.rs](https://rustup.rs) first.
- **Open your game's folder**, the one with `loominate.config.ts` and `node_modules`. The extension starts the language server your game depends on, so its compiler matches your game's. In a Loominate IF checkout, it uses the checkout's own server, after `pnpm build`. Otherwise it installs `@loominate-if/language-server` from npm.

## BBEdit

BBEdit (tested with 16.1) colors passage files through a language module in `packages/bbedit`: headers, directives, links, comments, and escapes. It lists your passages in the function menu, and starts the language server for errors, completion, and go to definition (Command-double-click, or **Go > Go to Definition**). BBEdit doesn't show hover information when you rest the mouse on a word.

- **Install it** from a Loominate IF checkout: run `packages/bbedit/install.sh`, then quit and reopen BBEdit. It copies the language module and the server's launcher into BBEdit's Application Support folder. Run it again after updating the checkout.
- **Open your game's folder** as a project, or any file in it. The launcher finds the language server your game depends on, in its `node_modules`, or a Loominate IF checkout's own, after `pnpm build`. It finds Node.js through your login shell, so version managers such as nvm work.

## VS Code

The extension in `packages/vscode` colors passage files, with TypeScript colors inside `{ … }`, and starts the language server for errors, completion, hover, and go to definition.

- **Build and install it** from a Loominate IF checkout until it's on the Marketplace: run `npx pnpm --filter loominate package`, then, in VS Code, **Extensions: Install from VSIX…** and choose `packages/vscode/loominate.vsix`.
- **Open your game's folder** (**File > Open Folder**). The extension finds the language server your game depends on, or a Loominate IF checkout's own, after `pnpm build`. It runs the server with the Node.js on your PATH, or the one the `loominate.nodePath` setting names.

## Other editors

Any other editor that can start a language server for a file type can use it now, with the command above.
