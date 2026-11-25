import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../..");
const temp = mkdtempSync(path.join(cli, "__run-config-"));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

let games = 0;
/** A game folder with `files`. */
function game(files: Record<string, string>): string {
  const root = path.join(temp, `game-${String(++games)}`);
  const all = {
    "package.json": '{"type":"module"}',
    ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  return root;
}

/** An installed package providing a compiler extension, written as a published one would be. */
const extensionPackage = (name: string, entry = "./extension.js", module?: string) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({
    name,
    type: "module",
    exports: { ".": "./index.js" },
    ...(entry !== "" && { loominate: { extension: entry } }),
  }),
  [`node_modules/${name}/extension.js`]:
    module ?? `export default { name: ${JSON.stringify(name)}, directives: [] };`,
});

const config = (body: string) => ({
  "loominate.config.ts": `import { defineConfig } from "@loominate-if/cli";\nexport default defineConfig(${body});\n`,
});
const options = {};

describe("loominate.config.ts", () => {
  it("is read with its types, and loads extensions in the order listed", async () => {
    const root = game({
      ...config(
        '{ game: { id: "lantern-road", version: "1.0.0" }, title: "Lantern Road", author: "A. Writer", start: "Road", extensions: ["kit-b", "@scope/kit-a"] }',
      ),
      ...extensionPackage("@scope/kit-a"),
      ...extensionPackage("kit-b"),
    });
    const loaded = await loadConfig(root, options);
    expect(loaded).toMatchObject({
      root,
      game: { id: "lantern-road", version: "1.0.0" },
      title: "Lantern Road",
      author: "A. Writer",
      start: "Road",
    });
    expect(loaded.loaded.map((e) => e.name)).toEqual(["kit-b", "@scope/kit-a"]);
  });

  it("explains a game folder without one", async () => {
    await expect(loadConfig(path.join(temp, "nowhere"))).rejects.toThrow(
      /^There's no loominate\.config\.ts in .*nowhere\. Run this in a game's folder, or create one with `npm create @loominate-if`\.$/,
    );
  });

  it("explains a config that's missing or mistypes a field", async () => {
    const problem = async (body: string) =>
      loadConfig(game(config(body)), options).then(
        () => "",
        (e: unknown) => (e as Error).message,
      );
    expect(await problem('{ start: "Road" } as never')).toBe(
      'loominate.config.ts: `game` needs an `id` and a `version`, like `game: { id: "lantern-road", version: "1.0.0" }`.',
    );
    expect(await problem('{ game: { id: "g", version: "1" } } as never')).toBe(
      'loominate.config.ts: `start` names the passage a new game starts in, like `start: "Start"`.',
    );
    expect(
      await problem('{ game: { id: "g", version: "1" }, start: "S", extensions: "kit" } as never'),
    ).toBe(
      'loominate.config.ts: `extensions` lists package names, like `extensions: ["@loominate-if/world"]`.',
    );
    expect(
      await problem('{ game: { id: "g", version: "1" }, start: "S", author: 3 } as never'),
    ).toBe('loominate.config.ts: `author` must be a string, like `author: "A. Writer"`.');
    expect(
      await problem('{ game: { id: "g", version: "1" }, start: "S", seeds: 3 } as never'),
    ).toBe(
      'loominate.config.ts: `seeds` must be `true`, `false`, `"daily"`, or the seed every game starts from, like `seeds: true`.',
    );
    const noDefault = game({ "loominate.config.ts": "export const config = {};\n" });
    await expect(loadConfig(noDefault, options)).rejects.toThrow(
      "loominate.config.ts: export the game's configuration as the default: `export default defineConfig({ … })`.",
    );
  });

  it("finds packages' inspector modules in order, then the game's own", async () => {
    const root = game({
      ...config(
        '{ game: { id: "g", version: "1" }, start: "S", extensions: ["panels-only", "both"], inspector: "tools/inspector.ts" }',
      ),
      "node_modules/panels-only/package.json": JSON.stringify({
        name: "panels-only",
        loominate: { inspector: "./inspector.js" },
      }),
      "node_modules/both/package.json": JSON.stringify({
        name: "both",
        type: "module",
        loominate: { extension: "./extension.js", inspector: "./dist/inspector.js" },
      }),
      "node_modules/both/extension.js": 'export default { name: "both", directives: [] };',
      "tools/inspector.ts": "export {};\n",
    });
    const loaded = await loadConfig(root, options);
    expect(loaded.loaded.map((e) => e.name)).toEqual(["both"]);
    expect(loaded.inspectorModules).toEqual([
      path.join(root, "node_modules/panels-only/inspector.js"),
      path.join(root, "node_modules/both/dist/inspector.js"),
      path.join(root, "tools/inspector.ts"),
    ]);
  });

  it("finds a linked package's inspector module at its real path, so the browser doesn't cache it for good (#332)", async () => {
    const root = game({
      ...config('{ game: { id: "g", version: "1" }, start: "S", extensions: ["linked"] }'),
      "packages/linked/package.json": JSON.stringify({
        name: "linked",
        loominate: { inspector: "./dist/inspector.js" },
      }),
      "packages/linked/dist/inspector.js": "export {};\n",
    });
    mkdirSync(path.join(root, "node_modules"), { recursive: true });
    symlinkSync(path.join(root, "packages/linked"), path.join(root, "node_modules/linked"), "dir");
    const loaded = await loadConfig(root, options);
    expect(loaded.inspectorModules).toEqual([
      realpathSync(path.join(root, "packages/linked/dist/inspector.js")),
    ]);
  });

  it("explains a game inspector module that's missing or mistyped", async () => {
    const root = game(
      config('{ game: { id: "g", version: "1" }, start: "S", inspector: "inspector.ts" }'),
    );
    await expect(loadConfig(root, options)).rejects.toThrow(
      `loominate.config.ts: \`inspector\` names inspector.ts, which isn't in ${root}. Create it, or remove \`inspector\`.`,
    );
    await expect(
      loadConfig(
        game(config('{ game: { id: "g", version: "1" }, start: "S", inspector: 3 } as never')),
        options,
      ),
    ).rejects.toThrow("loominate.config.ts: `inspector` must name a module, like `inspector.ts`.");
  });

  it("names an extension package that isn't installed, or doesn't provide one", async () => {
    const listing = (names: string) =>
      config(`{ game: { id: "g", version: "1" }, start: "S", extensions: [${names}] }`);
    await expect(loadConfig(game(listing('"@loominate-if/world"')), options)).rejects.toThrow(
      "loominate.config.ts: the package @loominate-if/world isn't installed. Install it with `npm install @loominate-if/world`, or remove it from `extensions`.",
    );
    await expect(
      loadConfig(game({ ...listing('"plain"'), ...extensionPackage("plain", "") }), options),
    ).rejects.toThrow(
      'loominate.config.ts: plain provides neither a compiler extension nor an inspector module; its package.json has no `"loominate": { "extension": "…" }` or `"loominate": { "inspector": "…" }`. Remove it from `extensions`.',
    );
    await expect(
      loadConfig(
        game({
          ...listing('"odd"'),
          ...extensionPackage("odd", "./extension.js", "export const x = 1;"),
        }),
        options,
      ),
    ).rejects.toThrow(
      "loominate.config.ts: odd's extension module, ./extension.js, must export its compiler extension as the default.",
    );
  });
});
