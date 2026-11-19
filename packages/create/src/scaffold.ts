/**
 * Scaffolds a new game (#52, ADR 0023): one passage file, one TypeScript
 * module, the game's configuration, and the page that loads it, ready for
 * `npm install` and `npm run dev`.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Options for {@link scaffold}. */
export type ScaffoldOptions = {
  /** The game's title. Defaults to one made from the folder's name: `lantern-road` is "Lantern Road". */
  readonly title?: string;
  /** The version of the `@loominate-if` packages to depend on. Defaults to this package's own. */
  readonly version?: string;
};

/** The game's ID, from its folder's name: lowercase words joined by hyphens. */
export function gameId(name: string): string {
  const id = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id === "" ? "my-game" : id;
}

/** A title from a game ID: `lantern-road` is "Lantern Road". */
function titleFrom(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** This package's version, which the scaffolded game's packages match. */
function ownVersion(): string {
  const pkg = createRequire(import.meta.url)("../package.json") as { version: string };
  return pkg.version;
}

/** The files of a new game, by path, for {@link scaffold}. */
export function templateFiles(id: string, title: string, version: string): Record<string, string> {
  const range = `^${version}`;
  return {
    "package.json": `${JSON.stringify(
      {
        name: id,
        version: "0.1.0",
        private: true,
        type: "module",
        scripts: { dev: "loominate dev", build: "loominate build" },
        dependencies: { "@loominate-if/core": range, "@loominate-if/presentation": range },
        devDependencies: { "@loominate-if/cli": range },
      },
      null,
      2,
    )}\n`,
    "loominate.config.ts": `import { defineConfig } from "@loominate-if/cli";

export default defineConfig({
  game: { id: ${JSON.stringify(id)}, version: "0.1.0" },
  title: ${JSON.stringify(title)},
  start: "Start",
});
`,
    "story.ts": `// Everything this module exports can be used in the game's passages.
import { object } from "@loominate-if/core";

export const lamp = object("lamp", { lit: false });
`,
    "start.weft": `:: Start
You wake in a small, quiet room.
{if lamp.lit}The lamp throws a warm light over everything.{else}An unlit lamp sits on the table.{/if}

[[Light the lamp -> Lit]]{when !lamp.lit}
[[Look around -> Room]]

:: Lit
{on enter: lamp.lit = true}
You turn the little brass switch, and the room fills with light.
{continue -> Start}

:: Room
Bare walls, a table, and a door you haven't opened yet.
{continue -> Start}
`,
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/@loominate/main"></script>
  </body>
</html>
`,
    "tsconfig.json": `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2023", "DOM", "DOM.Iterable"],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["*.ts"],
      },
      null,
      2,
    )}\n`,
    ".gitignore": "node_modules/\ndist/\n",
  };
}

/**
 * Writes a new game into `dir`, which must be empty or not exist yet, and
 * returns the files written, relative to it.
 * @throws Error if `dir` has files in it already.
 */
export function scaffold(dir: string, options: ScaffoldOptions = {}): readonly string[] {
  const root = path.resolve(dir);
  if (existsSync(root) && readdirSync(root).length > 0) {
    throw new Error(
      `${root} isn't empty. Choose a new folder for the game, so nothing in this one is overwritten.`,
    );
  }
  const id = gameId(path.basename(root));
  const files = templateFiles(id, options.title ?? titleFrom(id), options.version ?? ownVersion());
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return Object.keys(files);
}
