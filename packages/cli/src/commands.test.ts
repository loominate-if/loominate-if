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
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import { build, dev, test } from "./commands.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packages = path.resolve(here, "../..");
const temp = mkdtempSync(path.join(packages, "cli/__run-commands-"));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

let games = 0;
/** A game folder with this repository's packages installed. */
function game(files: Record<string, string>): string {
  const root = path.join(temp, `game-${String(++games)}`);
  const all = {
    "package.json": '{"type":"module"}',
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
  mkdirSync(path.join(root, "node_modules/@loominate-if"), { recursive: true });
  for (const pkg of ["core", "presentation", "testing"]) {
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
  querySelectorAll(selector: string): Iterable<{
    textContent: string | null;
    click(): void;
    getAttribute(name: string): string | null;
  }>;
};
const page = (): Page => (globalThis as unknown as { document: Page }).document;

const options = (root: string) => ({
  root,
  conditions: ["source"],
  vite: { configFile: false as const, logLevel: "silent" as const },
});

const START =
  ":: Start\n{if lamp.lit}Light.{else}You wake in the dark.{/if}\n[[Light the lamp -> Lit]]\n:: Lit\n{on enter: lamp.lit = true}\nIt glows.\n";

/** A game using the world model's rooms, exits, and doors, with its extension from source. */
function worldGame(): string {
  const root = game({
    "loominate.config.ts": `import { defineConfig } from "@loominate-if/cli";
export default defineConfig({ game: { id: "test-game", version: "0.1.0" }, start: "Hall", extensions: ["world-from-source"] });
`,
    // The world model's own extension module, from source, so the test needs no build first.
    "node_modules/world-from-source/package.json": JSON.stringify({
      name: "world-from-source",
      type: "module",
      loominate: { extension: "./extension.js" },
    }),
    "node_modules/world-from-source/extension.js": `export { default } from ${JSON.stringify(
      pathToFileURL(path.join(packages, "world/src/extension.ts")).href,
    )};\n`,
    "story.ts": `import { actor, connect, defineFacts, door, happen, lockable, place, player, startAs, thing, visitsTo } from "@loominate-if/world";
export const hall = place("hall", { name: "the hall" });
export const cellar = place("cellar", { name: "the cellar" });
export const cellarDoor = thing("cellarDoor", { ...door, ...lockable, name: "the cellar door" });
connect(hall, { down: { to: cellar, via: cellarDoor } });
connect(cellar, { up: { to: hall, via: cellarDoor } });
export const you = actor("you", { body: { name: "you", location: hall } });
startAs(you);
export const note = thing("note", { name: "a note", location: cellar });
export const facts = defineFacts({ culprit: "The butler did it." });
export { happen, player, visitsTo };
`,
    "rooms.weft": readFileSync(path.join(here, "fixtures/rooms.weft"), "utf8"),
  });
  symlinkSync(
    path.join(packages, "world"),
    path.join(root, "node_modules/@loominate-if/world"),
    "dir",
  );
  return root;
}

describe("loominate build", () => {
  it("builds a game using the world model's syntax, type-checking it", async () => {
    const root = worldGame();
    await build({ ...options(root), target: "single" });
    expect(readFileSync(path.join(root, "dist/test-game.html"), "utf8")).toContain(
      "A draughty hall.",
    );
  }, 60_000);

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
    // The inspector is a dev tool: an ordinary build carries none of it.
    expect(code).not.toContain("data-loominate-inspector");
    expect(code).not.toContain("inspector panels");
  }, 60_000);

  it("includes the inspector when asked, as for testers", async () => {
    const root = game({ "start.weft": START });
    await build({ ...options(root), inspector: true, target: "single" });
    const html = readFileSync(path.join(root, "dist/test-game.html"), "utf8");
    expect(html).toContain("You wake in the dark.");
    expect(html).toContain("inspector panels");
  }, 60_000);

  it("includes the game's and packages' inspector modules only with the inspector", async () => {
    const panel = (title: string) =>
      `import { panels } from "@loominate-if/inspector";
panels.register(${JSON.stringify(title.toLowerCase())}, { title: ${JSON.stringify(title)}, mount: () => ({ update() {} }) });
`;
    const files = {
      "start.weft": START,
      "loominate.config.ts": `import { defineConfig } from "@loominate-if/cli";
export default defineConfig({ game: { id: "test-game", version: "0.1.0" }, start: "Start", extensions: ["kit-panels"], inspector: "inspector.ts" });
`,
      "node_modules/kit-panels/package.json": JSON.stringify({
        name: "kit-panels",
        type: "module",
        loominate: { inspector: "./inspector.js" },
      }),
      "node_modules/kit-panels/inspector.js": panel("Kit-panel-tab"),
      "inspector.ts": panel("Game-panel-tab"),
    };
    const without = game(files);
    await build({ ...options(without), target: "single" });
    const plain = readFileSync(path.join(without, "dist/test-game.html"), "utf8");
    expect(plain).not.toContain("Kit-panel-tab");
    expect(plain).not.toContain("Game-panel-tab");

    const root = game(files);
    await build({ ...options(root), inspector: true, target: "single" });
    const html = readFileSync(path.join(root, "dist/test-game.html"), "utf8");
    expect(html).toContain("Kit-panel-tab");
    expect(html).toContain("Game-panel-tab");
    // One copy of the inspector, shared by the game, the package, and the entry.
    expect(html.split("inspector panels").length - 1).toBe(1);
  }, 60_000);

  it("builds a static site that works from any folder on any host", async () => {
    const root = game({ "start.weft": START });
    await build(options(root));
    const dist = path.join(root, "dist");
    const html = readFileSync(path.join(dist, "index.html"), "utf8");
    const urls = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1] ?? "");
    expect(urls.length).toBeGreaterThan(0);
    // Hosted in a subfolder, as on GitHub Pages or itch.io, every URL still reaches its file.
    const page = new URL("https://example.com/games/test-game/index.html");
    for (const url of urls) {
      expect(url.startsWith("./")).toBe(true);
      const resolved = new URL(url, page).pathname.replace("/games/test-game/", "");
      expect(existsSync(path.join(dist, resolved))).toBe(true);
    }
  }, 60_000);

  it("builds one HTML file, with everything inlined, as the single target", async () => {
    // Prose that would end an inline script if it weren't escaped.
    const root = game({
      "start.weft": START,
      "sign.weft": ":: Sign\nIt reads </script> in chalk.\n",
    });
    await build({ ...options(root), target: "single" });
    const dist = path.join(root, "dist");
    expect(readdirSync(dist)).toEqual(["test-game.html"]);
    const html = readFileSync(path.join(dist, "test-game.html"), "utf8");
    expect(html).not.toMatch(/\s(?:src|href)="\.?\/?assets\//);
    const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.[1]).toContain("You wake in the dark.");
    expect(scripts[0]?.[1]).toContain("It reads <\\/script> in chalk.");
    // Nothing in the inlined script can end the script element early.
    expect(scripts[0]?.[1]).not.toMatch(/<\/script/i);
  }, 60_000);

  it("names the build targets when given another", async () => {
    const root = game({ "start.weft": START });
    await expect(build({ ...options(root), target: "zip" as never })).rejects.toThrow(
      'There\'s no build target "zip". Use static or single.',
    );
  });

  it("fails on errors in the game, naming them", async () => {
    const root = game({ "start.weft": ":: Start\n{nope}\n" });
    await expect(build(options(root))).rejects.toThrow(/start\.weft:2:2 error: .*nope/);
    expect(existsSync(path.join(root, "dist"))).toBe(false);
  }, 60_000);
});

describe("loominate dev", () => {
  it("plays room passages, exits, and revealed facts with the world model's extension (#63, #64, #67, #69)", async () => {
    const root = worldGame();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const server = await dev({
      ...options(root),
      vite: { ...options(root).vite, server: { middlewareMode: true } },
    });
    const text = () => page().querySelector(".loominate-passage")?.textContent ?? "";
    const button = (label: string) => {
      const link = [...page().querySelectorAll(".loominate-passage button")].find((b) =>
        b.textContent?.startsWith(label),
      );
      if (!link) throw new Error(`no link ${label} in: ${text()}`);
      return link;
    };
    const follow = (label: string) => {
      button(label).click();
    };
    try {
      page().body.innerHTML = '<div id="app"></div>';
      await server.ssrLoadModule("/@loominate/main");
      expect(text()).toContain("A draughty hall. You're in hall.");
      // The locked door disables the way down, with its reason.
      expect(button("Down").getAttribute("aria-disabled")).toBe("true");
      expect(text()).toContain("The cellar door is locked.");
      follow("Unlock the cellar door");
      // What the player noticed shows where {notices} puts it.
      expect(
        [...page().querySelectorAll(".loominate-passage p")].map((p) => p.textContent),
      ).toEqual([
        "The key turns.",
        "The cellar door creaks open.",
        "You step back as it swings wide.",
        "Continue",
      ]);
      follow("Continue");
      expect(text()).toContain("The hall again.");
      follow("Down");
      expect(text()).toContain("Cellar visits: 1. You're in cellar.");
      // Arriving saw the note; reading it reveals a fact, sourced to the note.
      expect(text()).toContain("A note lies on the floor.");
      follow("Read the note");
      expect(text()).toContain("The note says the butler did it.");
      follow("Continue");
      expect(text()).toContain("You know who did it, from note.");
      expect(text()).not.toContain("Read the note");
      // The hall's been visited, so the way back names it.
      follow("Up, to the hall");
      expect(text()).toContain("The hall again. You're in hall.");
    } finally {
      await server.close();
      errors.mockRestore();
    }
  }, 60_000);

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
      // Dev adds the inspector, from the CLI's own copy when the game hasn't installed one.
      expect(page().querySelector("[data-loominate-inspector]")).not.toBeNull();
    } finally {
      await server.close();
      errors.mockRestore();
    }
  }, 60_000);
});

describe("loominate test", () => {
  it("runs walkthroughs against the game the config describes, and reports failures", async () => {
    const root = game({
      "start.weft": START,
      "lamp.test.ts": `import { play } from "@loominate-if/testing";
import { expect, test } from "vitest";
import { lamp } from "./story.js";

test("lighting the lamp", () => {
  const game = play();
  expect(game.text).toBe("You wake in the dark.");
  game.choose("Light the lamp");
  expect(lamp.lit).toBe(true);
});
`,
      "broken.test.ts": `import { play } from "@loominate-if/testing";
import { test } from "vitest";

test("a choice that isn't there", () => {
  play().choose("Fly");
});
`,
    });
    // One run per process, as on the command line: Vitest keeps state between runs in one process.
    // The nested run's report, including its expected failure, stays out of this run's output.
    const quiet = [
      vi.spyOn(process.stdout, "write").mockImplementation(() => true),
      vi.spyOn(process.stderr, "write").mockImplementation(() => true),
    ];
    try {
      expect(await test(options(root))).toEqual({ passed: false, tests: 2, failed: 1 });
    } finally {
      for (const spy of quiet) spy.mockRestore();
    }
  }, 120_000);
});
