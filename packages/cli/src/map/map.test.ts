/** The story map: `loominate map`, and the dev server's live page (#149). */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { dev } from "../commands.js";
import { layoutStoryMap } from "./layout.js";
import { storyMap } from "./command.js";
import { MAP_DATA, MAP_DATA_ID, MAP_EVENTS, MAP_PATH, MAP_SCRIPT } from "./page.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const packages = path.resolve(here, "../../..");
const temp = mkdtempSync(path.join(packages, "cli/__run-map-"));
afterAll(() => {
  rmSync(temp, { recursive: true, force: true });
});

const START =
  ":: Start\n[[Go down -> Cellar]]\n[[Up -> Attic]]{when false}\n\n:: Cellar\n{continue -> Start}\n";

let games = 0;
/** A game folder with this repository's packages installed. */
function game(files: Record<string, string> = {}): string {
  const root = path.join(temp, `game-${String(++games)}`);
  const all = {
    "package.json": '{"type":"module"}',
    "loominate.config.ts": `import { defineConfig } from "@loominate-if/cli";
export default defineConfig({ game: { id: "map-game", version: "0.1.0" }, title: "Map Game", start: "Start" });
`,
    "index.html":
      '<!doctype html><html lang="en"><head><title>Test</title></head><body><div id="app"></div><script type="module" src="/@loominate/main"></script></body></html>\n',
    "story.ts": "export {};\n",
    "start.weft": START,
    ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), text);
  }
  mkdirSync(path.join(root, "node_modules/@loominate-if"), { recursive: true });
  for (const pkg of ["core", "presentation"]) {
    symlinkSync(
      path.join(packages, pkg),
      path.join(root, `node_modules/@loominate-if/${pkg}`),
      "dir",
    );
  }
  return root;
}

/** The drawing in a standalone map's page. */
const inlined = (html: string): { title: string; views: { nodes: { id: string }[] }[] } => {
  const json = new RegExp(
    `<script type="application/json" id="${MAP_DATA_ID}">(.*?)</script>`,
    "s",
  ).exec(html)?.[1];
  if (json === undefined) throw new Error("no map in the page");
  return JSON.parse(json) as { title: string; views: { nodes: { id: string }[] }[] };
};

describe("layoutStoryMap", () => {
  it("places every node, routes every edge, and puts the start at the top", async () => {
    const drawing = await layoutStoryMap(
      {
        views: [
          {
            id: "passages",
            title: "Passages",
            nodes: [
              { id: "Start", label: "Start", tags: [], start: true },
              { id: "Middle", label: "Middle", tags: [] },
              { id: "End", label: "End", tags: [] },
            ],
            edges: [
              {
                from: "Start",
                to: "Middle",
                kind: "link",
                source: { file: "a", line: 1, column: 1 },
              },
              {
                from: "Middle",
                to: "End",
                kind: "link",
                source: { file: "a", line: 2, column: 1 },
              },
              { from: "End", to: "Start", kind: "link", source: { file: "a", line: 3, column: 1 } },
            ],
          },
        ],
      },
      "A Game",
    );
    const [view] = drawing.views;
    expect(drawing.title).toBe("A Game");
    const y = Object.fromEntries((view?.nodes ?? []).map((n) => [n.id, n.y]));
    expect(y.Start).toBeLessThan(y.Middle ?? 0);
    expect(y.Middle).toBeLessThan(y.End ?? 0);
    expect(view?.edges.every((e) => e.points.length >= 2)).toBe(true);
    expect(view?.width).toBeGreaterThan(0);
  });

  it("lays out the same map the same way each time", async () => {
    const map = {
      views: [
        {
          id: "passages",
          title: "Passages",
          nodes: ["A", "B", "C", "D"].map((id) => ({ id, label: id, tags: [] })),
          edges: [
            { from: "A", to: "B", kind: "link", source: { file: "a", line: 1, column: 1 } },
            { from: "A", to: "C", kind: "link", source: { file: "a", line: 1, column: 1 } },
            { from: "C", to: "D", kind: "link", source: { file: "a", line: 1, column: 1 } },
          ],
        },
      ],
    };
    expect(await layoutStoryMap(map)).toEqual(await layoutStoryMap(map));
  });
});

describe("loominate map", () => {
  it("writes the map as one HTML file, with the viewer and the map inlined", async () => {
    const root = game();
    const result = await storyMap({ root, conditions: ["source"] });
    expect(result).toEqual({
      file: path.join(root, "dist/story-map.html"),
      passages: 2,
      errors: 1,
    });
    const html = readFileSync(result.file, "utf8");
    expect(html).toContain("<title>Story map: Map Game</title>");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).toMatch(/<script type="module">/);
    const drawing = inlined(html);
    expect(drawing.title).toBe("Map Game");
    expect(drawing.views[0]?.nodes.map((n) => n.id)).toEqual(["Start", "Cellar", "Attic"]);
  }, 60_000);

  it("writes where it's told", async () => {
    const root = game();
    const result = await storyMap({ root, conditions: ["source"], out: "maps/here.html" });
    expect(result.file).toBe(path.join(root, "maps/here.html"));
    expect(readFileSync(result.file, "utf8")).toContain("Story map: Map Game");
  }, 60_000);
});

describe("the dev server's story map", () => {
  it("serves the page, the laid-out map, and an event when a passage changes", async () => {
    const root = game();
    const server = await dev({
      root,
      conditions: ["source"],
      vite: { configFile: false, logLevel: "silent", server: { middlewareMode: true } },
    });
    const http: Server = createServer(server.middlewares);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
    const events = new AbortController();
    try {
      const page = await (await fetch(base + MAP_PATH)).text();
      expect(page).toContain("<title>Story map: Map Game</title>");
      expect(page).toContain(`src="${MAP_SCRIPT}"`);
      // The page's script is the viewer, without Vite's client, so the game reloading doesn't reload it.
      const script = await (await fetch(base + MAP_SCRIPT)).text();
      expect(script).toContain("mountStoryMap");
      expect(script).not.toContain("@vite/client");

      const data = (await (await fetch(base + MAP_DATA)).json()) as {
        title: string;
        views: {
          nodes: { id: string; x: number }[];
          edges: { kind: string; guarded?: boolean }[];
        }[];
      };
      expect(data.title).toBe("Map Game");
      expect(data.views[0]?.nodes.map((n) => n.id)).toEqual(["Start", "Cellar", "Attic"]);
      expect(data.views[0]?.edges.map((e) => [e.kind, e.guarded ?? false])).toEqual([
        ["link", false],
        ["link", true],
        ["continue", false],
      ]);

      const stream = await fetch(base + MAP_EVENTS, { signal: events.signal });
      const reader = stream.body?.getReader();
      if (!reader) throw new Error("no event stream");
      const decoder = new TextDecoder();
      let received = decoder.decode((await reader.read()).value);
      expect(received).toContain(": connected");
      writeFileSync(path.join(root, "start.weft"), `${START}\n:: Attic\nDusty.\n`);
      while (!received.includes("event: change")) {
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value);
      }
      expect(received).toContain("event: change");
      const after = (await (await fetch(base + MAP_DATA)).json()) as typeof data;
      expect(after.views[0]?.nodes.find((n) => n.id === "Attic")).not.toHaveProperty("missing");
    } finally {
      events.abort();
      await new Promise((resolve) => http.close(resolve));
      await server.close();
    }
  }, 60_000);
});
