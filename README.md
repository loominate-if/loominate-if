# Loominate IF

An authoring system for interactive fiction, for writers who are happy in code. You write prose in passage files and objects and behavior in TypeScript, and the compiler type-checks them together, reporting mistakes against your own lines. Games run in the browser, as a static site, a single HTML file, or a portable `.loom` archive.

An optional world model, inspired by TADS 3 and adv3Lite, adds rooms, things, light, knowledge, NPCs, conversations, and time. A plain branching story doesn't need it, and pays nothing for it.

Loominate IF is young, at 0.x: expect changes between versions, each noted in its release.

## Quick start

With [Node.js](https://nodejs.org/) 22.18 or later:

```sh
npm create @loominate-if my-game
cd my-game
npm install
npm run dev
```

The new game's `start.weft` holds passages:

```
:: Start
You wake in a small, quiet room.
{if lamp.lit}The lamp throws a warm light over everything.{else}An unlit lamp sits on the table.{/if}

[[Light the lamp -> Lit]]{when !lamp.lit}
[[Look around -> Room]]

:: Lit
{on enter: lamp.lit = true}
You turn the little brass switch, and the room fills with light.
{continue -> Start}
```

and `story.ts` the objects they use:

```ts
import { object } from "@loominate-if/core";

export const lamp = object("lamp", { lit: false });
```

## The guide

- [Getting started](docs/guide/getting-started.md): a new game, what's in it, testing, and building
- [Tutorial: The Last Watch](docs/guide/tutorial.md): a whole story, step by step
- [Editing passage files](docs/guide/editors.md): errors and completion in VS Code, Zed, and BBEdit
- [Walkthrough tests](docs/guide/walkthroughs.md): play your game in tests
- [The inspector](docs/guide/inspector.md) and [the story map](docs/guide/story-map.md)
- [Playing a game in the browser](docs/guide/playing.md): saves, undo, and what players get
- [Storylets](docs/guide/storylets.md), [beats and cut scenes](docs/guide/beats.md), and [effects](docs/guide/effects.md)
- [Theming](docs/guide/theming.md) and [rewording the library](docs/guide/messages.md)
- [The world model](docs/guide/world.md) and [actions](docs/guide/actions.md)

## Packages

| Package | What it is |
| --- | --- |
| [`@loominate-if/create`](packages/create) | `npm create @loominate-if`: a new game |
| [`@loominate-if/cli`](packages/cli) | `loominate`: the dev server, builds, tests, the story map, and the player |
| [`@loominate-if/core`](packages/core) | The runtime: state, passages, saves, undo, and random streams |
| [`@loominate-if/presentation`](packages/presentation) | The page: layouts, widgets, themes, beats, audio, and accessibility |
| [`@loominate-if/world`](packages/world) | The optional world model |
| [`@loominate-if/testing`](packages/testing) | Walkthrough tests |
| [`@loominate-if/inspector`](packages/inspector) | The in-game inspector |
| [`@loominate-if/compiler`](packages/compiler) | The compiler, which `loominate` runs |
| [`@loominate-if/archive`](packages/archive) | `.loom` archives and the sandboxed player |
| [`@loominate-if/language-server`](packages/language-server) | Errors and completion for editors |

## Contributing

[DESIGN.md](docs/DESIGN.md) is the design, and [docs/decisions](docs/decisions) records each decision. [AGENTS.md](AGENTS.md) has the principles, the commands, and how work is tracked in issues. [Releasing](docs/releasing.md) is for maintainers.

## License

[MIT](LICENSE)
