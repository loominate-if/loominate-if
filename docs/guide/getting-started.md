# Getting started

## Create a game

```sh
npm create @loominate-if my-game
cd my-game
npm install
npm run dev
```

That gives you a small game, with the dev server showing it in your browser. Edit a file and the page reloads as you save, back at the passage you were on, with the game's state as it was, showing your edited text. If an edit means that can't work, for example because you renamed the passage you were at, the page says so and offers a new game.

Errors in passages or code are reported against your own lines, in the terminal and over the game in the browser. Fix the last one and the terminal says the game has no problems.

## What's in it

- `start.weft` holds passages: prose, links, and the code that changes the story. Add as many `.weft` files as you like; every one in the folder is part of the game.
- `story.ts` holds objects and functions. Everything it exports can be used in passages.
- `loominate.config.ts` is the game's configuration:

  ```ts
  import { defineConfig } from "@loominate-if/cli";

  export default defineConfig({
    game: { id: "my-game", version: "0.1.0" },
    title: "My Game",
    start: "Start",
  });
  ```

  `game.id` keeps your game's saves apart from other games'; don't change it once players have saves. Raise `game.version` when you release a new version, and players loading an older save are told. `start` is the passage a new game starts in.
- `index.html` is the page the game runs in. It loads `/@loominate/main`, which plays every passage file with the player shell: saves, autosave, undo, and the save menu ([playing guide](playing.md)).

## Build it

```sh
npm run build
```

This writes the game to `dist/` as a static site, which can be hosted anywhere or opened from a local web server. Its URLs are relative, so it works from any folder: GitHub Pages, itch.io, Netlify, or your own site.

To share the game as one file that opens by double-click, with no server:

```sh
npm run build:single
```

This writes `dist/my-game.html`, with everything inlined. Saves in it are kept by the browser for that file's location, so moving the file starts afresh; players can carry saves across with the save menu's export and import.

Either build fails if the game has errors.

## Extensions

Packages that add passage syntax, such as the world model, are listed in the config, in the order they load:

```ts
export default defineConfig({
  game: { id: "my-game", version: "0.1.0" },
  start: "Start",
  extensions: ["@loominate-if/world"],
});
```

Install each one with npm too. A package that's listed but not installed is an error naming it.
