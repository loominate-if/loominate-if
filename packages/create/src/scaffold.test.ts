// @vitest-environment jsdom
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, dev, test } from "@loominate-if/cli";
import { afterAll, describe, expect, it, vi } from "vitest";
import { gameId, scaffold } from "./scaffold.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packages = path.resolve(here, "../..");
const temp = mkdtempSync(path.join(packages, "create/__run-scaffold-"));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

/** Installs this repository's packages into a scaffolded game, as `npm install` would. */
function install(root: string): void {
  const scope = path.join(root, "node_modules/@loominate-if");
  mkdirSync(scope, { recursive: true });
  for (const pkg of ["core", "presentation", "testing"]) {
    symlinkSync(path.join(packages, pkg), path.join(scope, pkg), "dir");
  }
}

/** jsdom's document, typed narrowly, since this package is compiled without DOM types. */
type Page = {
  body: { innerHTML: string };
  querySelector(selector: string): { textContent: string | null } | null;
};
const page = (): Page => (globalThis as unknown as { document: Page }).document;

describe("scaffolding a game", () => {
  it("writes one passage file, one module, its config, and its page", () => {
    const root = path.join(temp, "Lantern Road");
    expect(scaffold(root, { version: "1.2.3" })).toEqual([
      "package.json",
      "loominate.config.ts",
      "story.ts",
      "start.weft",
      "walkthrough.test.ts",
      "index.html",
      "tsconfig.json",
      ".gitignore",
    ]);
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(pkg).toMatchObject({
      name: "lantern-road",
      scripts: {
        dev: "loominate dev",
        build: "loominate build",
        "build:single": "loominate build --target single",
        test: "loominate test",
      },
      dependencies: { "@loominate-if/core": "^1.2.3", "@loominate-if/presentation": "^1.2.3" },
      devDependencies: {
        "@loominate-if/cli": "^1.2.3",
        "@loominate-if/testing": "^1.2.3",
        vitest: "^5.1.0",
      },
    });
    const config = readFileSync(path.join(root, "loominate.config.ts"), "utf8");
    expect(config).toContain('game: { id: "lantern-road", version: "0.1.0" }');
    expect(config).toContain('title: "Lantern Road"');
  });

  it("makes IDs from folder names", () => {
    expect(gameId("Lantern Road")).toBe("lantern-road");
    expect(gameId("Café_Noir 2!")).toBe("cafe-noir-2");
    expect(gameId("***")).toBe("my-game");
  });

  it("never writes into a folder that has files", () => {
    const root = path.join(temp, "taken");
    mkdirSync(root);
    writeFileSync(path.join(root, "notes.txt"), "mine");
    expect(() => scaffold(root)).toThrow(
      /taken isn't empty\. Choose a new folder for the game, so nothing in this one is overwritten\.$/,
    );
    expect(readFileSync(path.join(root, "notes.txt"), "utf8")).toBe("mine");
  });

  it("builds, runs, and passes its walkthrough", async () => {
    const root = path.join(temp, "first-game");
    scaffold(root);
    install(root);
    const options = {
      root,
      conditions: ["source"],
      vite: { configFile: false as const, logLevel: "silent" as const },
    };
    await build(options);
    expect(readFileSync(path.join(root, "dist/index.html"), "utf8")).toContain(
      "<title>First Game</title>",
    );

    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = await dev({
      ...options,
      vite: { ...options.vite, server: { middlewareMode: true } },
    });
    try {
      page().body.innerHTML = '<div id="app"></div>';
      await server.ssrLoadModule("/@loominate/main");
      expect(page().querySelector(".loominate-passage")?.textContent).toContain(
        "You wake in a small, quiet room.",
      );
    } finally {
      await server.close();
      errors.mockRestore();
    }

    const quiet = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      expect(await test(options)).toEqual({ passed: true, tests: 1, failed: 0 });
    } finally {
      quiet.mockRestore();
    }
  }, 120_000);
});
