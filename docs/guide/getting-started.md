# Getting started

This guide sets up a game and shows what's in it. To learn by writing a whole story, follow it with the [tutorial](tutorial.md).

## Create a game

```sh
npm create @loominate-if my-game
cd my-game
npm install
npm run dev
```

That gives you a small game, with the dev server showing it in your browser. Edit a file and the page reloads as you save, back at the passage you were on, with the game's state as it was, showing your edited text. If an edit means that can't work, for example because you renamed the passage you were at, the page says so and offers a new game.

When your game has errors, `loominate` shows the ones that matter: one broken expression can make TypeScript report dozens as it recovers, so it shows at most five per file, holding back those that follow from an earlier one, and says how many more there are. Fix those and build again, or run with `--verbose`, as in `npm run build -- --verbose`, to see every error.

When your code throws, the page says so rather than going quiet. An error during play, such as `{on enter: move(box, box)}`, shows at the top of the passage, where the game stays, as it was before the choice. An error while the game loads, such as in `story.ts`, shows "The game couldn't start." with the error, and its stack in the dev server. Either way, the terminal running `npm run dev` prints it too.

Errors in passages or code are reported against your own lines, in the terminal and over the game in the browser. Fix the last one and the terminal says the game has no problems.

The **Inspector** button in the corner, or Control+\`, opens the [inspector](inspector.md) beside the game, showing every object's state as you play.

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

  `game.id` keeps your game's saves apart from other games'; don't change it once players have saves. Raise `game.version` when you release a new version, and players loading an older save are told. `start` is the passage a new game starts in. Add `author: "Your Name"` to show a byline on the start screen and put it in story log exports.
- `walkthrough.test.ts` is a walkthrough test, which plays the game and checks what happens.
- `assets.d.ts` lets `story.ts` import images, sound, and fonts ([below](#images-and-other-files)).
- `index.html` is the page the game runs in. It loads `/@loominate/main`, which plays every passage file with the player shell: saves, autosave, undo, and the save menu ([playing guide](playing.md)).

## Images and other files

`story.ts`, and the modules it imports, can import an image, a sound, or a font. The import is the file's URL, a string:

```ts
import keyIcon from "./icons/key.svg";

export const key = thing("key", { name: "brass key", onMap: { label: "key", icon: keyIcon } });
```

The build copies the file into `dist/` under a name that changes when it does, so browsers never show an old copy; small files, under 4 KB, and every file in a single-file build, are inlined in the game itself. A missing file is a build error.

`assets.d.ts` is what tells TypeScript that `./icons/key.svg` is a string. It declares the common image (`.svg`, `.png`, `.jpg`, `.webp`, `.gif`, `.avif`, …), sound and video (`.mp3`, `.ogg`, `.wav`, `.m4a`, …), and font (`.woff2`, `.woff`, `.ttf`, `.otf`) files; add a line for another kind:

```ts
declare module "*.glb" {
  const url: string;
  export default url;
}
```

A game made before this file existed can copy it from a new game. The compiler reads every `.d.ts` file in the game, so it can declare other types the same way.

Files in `public/` are the other way: the build copies them as they are, under their own names, and a game names them by their path, as `"icons/key.svg"`. Use it for files a game names by path, as music and sound do ([playing guide](playing.md#sound)), and for files that keep their name, as a favicon.

## Test it

`walkthrough.test.ts` plays the game and checks what happens, as a player would:

```sh
npm test
```

Add a walkthrough for each path through your story, and they'll catch it when an edit breaks one ([walkthrough guide](walkthroughs.md)). `npm run coverage` says what players can't reach, and what your walkthroughs never reach ([coverage reports](walkthroughs.md#coverage-reports)).

## Build it

```sh
npm run build
```

This writes the game to `dist/` as a static site, which can be hosted anywhere or opened from a local web server. Its URLs are relative, so it works from any folder: GitHub Pages, itch.io, Netlify, or your own site.

To share the game as one file that opens by double-click, with no server:

```sh
npm run build:single
```

This writes `dist/my-game.html`, with everything inlined. Browsers differ in how they keep saves for files opened from disk, so moving the file or opening it in another browser can start afresh; players can carry saves across with the save menu's export and import.

Either build fails if the game has errors.

## See it

While `npm run dev` runs, the **Story map** address it prints shows your passages and the links between them, redrawn as you edit, with an outline for keyboards and screen readers. `npx loominate map` writes the map as one HTML file ([the story map](story-map.md)).

## Editing

`@loominate-if/language-server` gives your editor the compiler's errors and TypeScript completion inside passage files ([editing passage files](editors.md)).

## Extensions

Packages that add passage syntax, such as the world model, are listed in the config, in the order they load:

```ts
export default defineConfig({
  game: { id: "my-game", version: "0.1.0" },
  start: "Start",
  extensions: ["@loominate-if/world"],
});
```

Install each one with npm too. A package that's listed but not installed is an error naming it. Listed packages can also add tabs to the [inspector](inspector.md#adding-your-own), and so can your game, with `inspector: "inspector.ts"`.

The list sets the order everything loads in: the compiler's syntax, the inspector's tabs, and the game itself, whose entry loads each listed package first, in this order, then your `story.ts`. Whatever registers a name first, such as a widget, a rule, an action, or a direction, owns it. If a later package, or your `story.ts`, registers the same name, that's an error before the game is built, or as `loominate dev` starts, naming both:

```
loominate.config.ts: @acme/seasons, listed second in `extensions`, registers a name that's taken: registry "widgets": "forecast" is already registered by @acme/weather; use replace() to substitute it.
```

To take a name over on purpose, use `replace()`, as in `widgets.replace("forecast", …)`, which isn't a clash. Otherwise rename one of them, or remove a package from the list.
