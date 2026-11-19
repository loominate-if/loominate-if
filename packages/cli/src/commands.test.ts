// @vitest-environment jsdom
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { build, dev } from "./commands.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packages = path.resolve(here, "../..");
const temp = mkdtempSync(path.join(packages, "cli/__run-commands-"));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

let games = 0;
/**
 * A game folder with this repository's presentation package installed. The
 * config's CLI is a stand-in with `defineConfig`, as in config.test.ts.
 */
function game(files: Record<string, string>): string {
  const root = path.join(temp, `game-${String(++games)}`);
  const all = {
    "package.json": '{"type":"module"}',
    "node_modules/@loominate-if/cli/package.json":
      '{"name":"@loominate-if/cli","type":"module","exports":{".":"./index.js"}}',
    "node_modules/@loominate-if/cli/index.js": "export const defineConfig = (config) => config;\n",
    "loominate.config.ts": `import { defineConfig } from "@loominate-if/cli";
export default defineConfig({ game: { id: "test-game", version: "0.1.0" }, title: "Test Game", start: "Start" });
`,
    "index.html":
      '<!doctype html><html lang="en"><head><title>Test</title></head><body><div id="app"></div><script type="module" src="/@loominate/main"></script></body></html>\n',
    "story.ts":
      'import { object } from "@loominate-if/core";\nexport const lamp = object("lamp", { lit: false });\n',
    ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  for (const pkg of ["core", "presentation"]) {
    symlinkSync(
      path.join(packages, pkg),
      path.join(root, `node_modules/@loominate-if/${pkg}`),
      "dir",
    );
  }
  return root;
}

/** jsdom's document, typed narrowly, since this package is compiled without DOM types. */
type Page = {
  body: { innerHTML: string };
  querySelector(selector: string): { textContent: string | null } | null;
};
const page = (): Page => (globalThis as unknown as { document: Page }).document;

const options = (root: string) => ({
  root,
  conditions: ["source"],
  vite: { configFile: false as const, logLevel: "silent" as const },
});

const START =
  ":: Start\n{if lamp.lit}Light.{else}You wake in the dark.{/if}\n[[Light the lamp -> Lit]]\n:: Lit\n{on enter: lamp.lit = true}\nIt glows.\n";

describe("loominate build", () => {
  it("builds the game as a static site, with relative URLs", async () => {
    const root = game({ "start.weft": START });
    await build(options(root));
    const html = readFileSync(path.join(root, "dist/index.html"), "utf8");
    expect(html).toMatch(
      /<script type="module" crossorigin src="\.\/assets\/[^"]+\.js"><\/script>/,
    );
    const js = readdirSync(path.join(root, "dist/assets")).filter((f) => f.endsWith(".js"));
    const code = js.map((f) => readFileSync(path.join(root, "dist/assets", f), "utf8")).join("\n");
    expect(code).toContain("You wake in the dark.");
    expect(code).toContain("test-game");
  }, 60_000);

  it("fails on errors in the game, naming them", async () => {
    const root = game({ "start.weft": ":: Start\n{nope}\n" });
    await expect(build(options(root))).rejects.toThrow(/start\.weft:2:2 error: .*nope/);
    expect(existsSync(path.join(root, "dist"))).toBe(false);
  }, 60_000);
});

describe("loominate dev", () => {
  it("plays every passage file through the generated entry point", async () => {
    const root = game({ "start.weft": START, "scenes/lit.weft": "" });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = await dev({
      ...options(root),
      vite: { ...options(root).vite, server: { middlewareMode: true } },
    });
    try {
      page().body.innerHTML = '<div id="app"></div>';
      await server.ssrLoadModule("/@loominate/main");
      expect(page().querySelector(".loominate-passage")?.textContent).toContain(
        "You wake in the dark.",
      );
      expect(page().querySelector("h1")).toBeNull();
    } finally {
      await server.close();
      errors.mockRestore();
    }
  }, 60_000);
});
