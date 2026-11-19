import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, defaultServerConditions, type ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { formatDiagnostic, gameFiles, loominate } from "./plugin.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runs: { dir: string; server?: ViteDevServer }[] = [];
afterEach(async () => {
  for (const run of runs.splice(0)) {
    await run.server?.close();
    rmSync(run.dir, { recursive: true, force: true });
  }
});

const hall = (lamp: string) =>
  `:: Hall\nThe lamp is ${lamp}.\n{continue -> Cellar}\n\n:: Cellar\nDamp, {lamp.lit ? "lit" : "dark"}.\n`;

/** A game in a directory inside the package, so `@loominate-if/core` resolves. */
function game(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(here, "__run-"));
  const run: (typeof runs)[number] = { dir };
  runs.push(run);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return run;
}

const files = {
  "story.ts": "export const lamp = { lit: true };\n",
  "hall.weft": hall("on"),
  "main.ts": `
import { createEventRecord, createStore, createStory } from "@loominate-if/core";
import { passages } from "./hall.weft.js";

export function play(): string[] {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
  story.perform({ type: "follow", choice: { type: "continue", target: "Cellar" } });
  return record.events({ kinds: ["narrative"] }).map((e) => e.text);
}
`,
};

/** What the server logged, by level. */
type Logged = { level: "info" | "warn" | "error"; message: string }[];

async function serve(dir: string, logged?: Logged) {
  const log =
    (level: Logged[number]["level"]) =>
    (message: string): void => {
      logged?.push({ level, message });
    };
  return createServer({
    root: dir,
    configFile: false,
    logLevel: "silent",
    ...(logged && {
      customLogger: {
        info: log("info"),
        warn: log("warn"),
        warnOnce: log("warn"),
        error: log("error"),
        clearScreen: () => undefined,
        hasErrorLogged: () => false,
        hasWarned: false,
      },
    }),
    plugins: [loominate({ start: "Hall", compilerOptions: { customConditions: ["source"] } })],
    // Resolve workspace packages to their TypeScript source, as tests do everywhere.
    resolve: { conditions: ["source"] },
    ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
    server: { middlewareMode: true, hmr: false, watch: null },
  });
}

describe("the loominate Vite plugin", () => {
  it("compiles passage files into modules a game imports and plays", async () => {
    const run = game(files);
    run.server = await serve(run.dir);
    const main = (await run.server.ssrLoadModule("/main.ts")) as { play(): string[] };
    expect(main.play()).toEqual(["The lamp is on.", "Damp, lit."]);
  });

  it("gives Vite's dependency scan the generated code, which isn't on disk", async () => {
    const run = game(files);
    const server = (run.server = await serve(run.dir));
    const plugins = server.config.optimizeDeps.rolldownOptions?.plugins;
    const scan = (Array.isArray(plugins) ? plugins : []).find(
      (p): p is { name: string; load: (id: string) => unknown } =>
        typeof p === "object" && p !== null && "name" in p && p.name === "loominate-scan",
    );
    expect(scan?.load(path.join(run.dir, "hall.weft.ts"))).toMatchObject({
      code: expect.stringContaining("export const passages") as unknown,
      moduleType: "ts",
    });
    expect(scan?.load(path.join(run.dir, "main.ts"))).toBeUndefined();
  });

  it("recompiles a passage file when it changes, and nothing else", async () => {
    const run = game(files);
    const server = (run.server = await serve(run.dir));
    await server.ssrLoadModule("/main.ts");
    const hallModule = path.join(run.dir, "hall.weft.ts");
    const before = server.environments.ssr.moduleGraph.getModuleById(hallModule);
    if (!before) throw new Error("hall.weft.ts wasn't loaded");

    const file = path.join(run.dir, "hall.weft");
    writeFileSync(file, hall("off"));
    const plugin = server.config.plugins.find((p) => p.name === "loominate");
    const hotUpdate = plugin?.hotUpdate;
    const handler = typeof hotUpdate === "function" ? hotUpdate : hotUpdate?.handler;
    const updated = await handler?.call({ environment: server.environments.ssr } as never, {
      type: "update",
      file,
      timestamp: Date.now(),
      modules: [],
      read: () => hall("off"),
      server,
    });
    expect(updated).toEqual([before]);
    server.environments.ssr.moduleGraph.invalidateModule(before);
    const main = (await server.ssrLoadModule("/main.ts")) as { play(): string[] };
    expect(main.play()).toEqual(["The lamp is off.", "Damp, lit."]);
  });

  it("reports problems already in the game when the server starts, and when they're fixed", async () => {
    const run = game({
      ...files,
      "hall.weft": ":: Hall\n{nope}\n{continue -> Cellar}\n\n:: Cellar\nDamp.\n",
    });
    const logged: Logged = [];
    const server = (run.server = await serve(run.dir, logged));
    expect(logged.filter((l) => l.level === "error").map((l) => l.message)).toEqual([
      expect.stringMatching(/^hall\.weft:2:2 error: `nope` isn't defined\./) as unknown,
    ]);

    logged.length = 0;
    const file = path.join(run.dir, "hall.weft");
    const plugin = server.config.plugins.find((p) => p.name === "loominate");
    const hotUpdate = plugin?.hotUpdate;
    const handler = typeof hotUpdate === "function" ? hotUpdate : hotUpdate?.handler;
    await handler?.call({ environment: server.environments.ssr } as never, {
      type: "update",
      file,
      timestamp: Date.now(),
      modules: [],
      read: () => hall("on"),
      server,
    });
    expect(logged).toEqual([{ level: "info", message: "The game has no problems now." }]);
  });

  it("fails a build with the game's errors, at the passage lines", async () => {
    const run = game({ ...files, "hall.weft": ":: Hall\n[[Nowhere]]\n" });
    const { build } = await import("vite");
    await expect(
      build({
        root: run.dir,
        configFile: false,
        logLevel: "silent",
        plugins: [loominate({ compilerOptions: { customConditions: ["source"] } })],
        build: { write: false, lib: { entry: path.join(run.dir, "main.ts"), formats: ["es"] } },
      }),
    ).rejects.toThrow("hall.weft:2:3 error: There's no passage named `Nowhere`.");
  });
});

describe("game files", () => {
  it("are the passage files and TypeScript modules outside dependencies and output", () => {
    const run = game({
      "a.weft": ":: A\n",
      "b.ts": "",
      "c.d.ts": "",
      "d.js": "",
      // Tool configuration isn't game code; type-checking vite.config.ts crashed TypeScript.
      "vite.config.ts": "export default {};\n",
      "vitest.config.mts": "",
    });
    expect(gameFiles(run.dir).map((f) => path.basename(f.path))).toEqual(["a.weft", "b.ts"]);
  });

  it("format diagnostics relative to the game", () => {
    expect(
      formatDiagnostic("/game", {
        severity: "warning",
        source: "compiler",
        file: "/game/scenes/a.weft",
        message: "Hmm.",
        span: { start: 0, end: 1 },
        line: 3,
        column: 5,
      }),
    ).toBe("scenes/a.weft:3:5 warning: Hmm.");
  });
});
