/** The story map: `loominate map`, and the dev server's live page (#149). */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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

/** A game with the world model's rooms and exits, its extension from source. */
function worldGame(): string {
  const root = game({
    "loominate.config.ts": `import { defineConfig } from "@loominate-if/cli";
export default defineConfig({ game: { id: "rooms-game", version: "0.1.0" }, title: "Rooms Game", start: "Hall", extensions: ["world-from-source"] });
`,
    "node_modules/world-from-source/package.json": JSON.stringify({
      name: "world-from-source",
      type: "module",
      loominate: { extension: "./extension.js" },
    }),
    "node_modules/world-from-source/extension.js": `export { default } from ${JSON.stringify(
      pathToFileURL(path.join(packages, "world/src/extension.ts")).href,
    )};\n`,
    "story.ts": `import { actor, connect, door, place, startAs, thing } from "@loominate-if/world";
export const hall = place("hall", { name: "great hall" });
export const library = place("library", { name: "library" });
export const cellar = place("cellar", { name: "cellar" });
export const trapdoor = thing("trapdoor", { ...door, name: "trapdoor" });
connect(hall, { north: library, down: { to: cellar, via: trapdoor } });
connect(library, { south: hall });
connect(cellar, { up: { to: hall, via: trapdoor } });
startAs(actor("you", { body: { name: "you", location: hall } }));
`,
    "start.weft":
      ":: Hall [room: hall]\nA great hall.\n\n:: Library [room: library]\nBooks.\n\n:: Cellar [room: cellar]\nDamp.\n",
  });
  symlinkSync(
    path.join(packages, "world"),
    path.join(root, "node_modules/@loominate-if/world"),
    "dir",
  );
  return root;
}

/** A Rooms view as drawn: each room's name and cell, and each exit. */
type Drawn = {
  views: {
    id: string;
    grid?: boolean;
    error?: string;
    nodes: { id: string; label: string; x: number; y: number; start?: boolean }[];
    edges: { from: string; to: string; label?: string; bent?: boolean }[];
  }[];
};

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

  it("puts a view whose places have cells on its grid, north up, bending what's off it", async () => {
    const drawing = await layoutStoryMap({
      views: [
        {
          id: "rooms",
          title: "Rooms",
          nodes: [
            { id: "hall", label: "hall", start: true, cell: { x: 0, y: 0 } },
            { id: "library", label: "library", cell: { x: 0, y: -1 } },
            { id: "cellar", label: "cellar", cell: { x: 1, y: 1 } },
            { id: "attic", label: "attic", cell: { x: 2, y: -1 } },
          ],
          edges: [
            { from: "hall", to: "library", kind: "north" },
            { from: "hall", to: "cellar", kind: "down", bent: true },
            { from: "hall", to: "attic", kind: "up", bent: true },
          ],
        },
      ],
    });
    const [view] = drawing.views;
    expect(view?.grid).toBe(true);
    const at = Object.fromEntries((view?.nodes ?? []).map((n) => [n.id, n]));
    expect(at.library?.y).toBeLessThan(at.hall?.y ?? 0);
    expect(at.cellar?.x).toBeGreaterThan(at.hall?.x ?? 0);
    // Straight to a neighbouring cell, even when bent; curved around to one farther off.
    expect(view?.edges.map((e) => e.points.length)).toEqual([2, 2, 3]);
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

describe("the Rooms view, from the begun game (#426)", () => {
  it("is in the map file beside Passages, by compass from the player's room", async () => {
    const root = worldGame();
    const result = await storyMap({ root, conditions: ["source"] });
    const drawing = inlined(readFileSync(result.file, "utf8")) as unknown as Drawn;
    expect(drawing.views.map((v) => v.id)).toEqual(["passages", "rooms"]);
    const rooms = drawing.views[1];
    expect(rooms?.grid).toBe(true);
    expect(rooms?.error).toBeUndefined();
    expect(rooms?.nodes.map((n) => [n.id, n.label, n.start ?? false])).toEqual([
      ["hall", "great hall", true],
      ["library", "library", false],
      ["cellar", "cellar", false],
    ]);
    const at = Object.fromEntries((rooms?.nodes ?? []).map((n) => [n.id, n]));
    expect(at.library?.y).toBeLessThan(at.hall?.y ?? 0);
    expect(rooms?.edges.map((e) => [e.from, e.to, e.label, e.bent ?? false])).toEqual([
      ["cellar", "hall", "Up, through the trapdoor", true],
      ["hall", "library", "North", false],
      ["hall", "cellar", "Down, through the trapdoor", true],
      ["library", "hall", "South", false],
    ]);
  }, 60_000);

  it("is served live by the dev server", async () => {
    const root = worldGame();
    const server = await dev({
      root,
      conditions: ["source"],
      vite: { configFile: false, logLevel: "silent", server: { middlewareMode: true } },
    });
    const http: Server = createServer(server.middlewares);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${String((http.address() as AddressInfo).port)}`;
    try {
      // Twice: each read begins the game afresh, so the world's registries don't clash.
      for (let i = 0; i < 2; i++) {
        const data = (await (await fetch(base + MAP_DATA)).json()) as Drawn;
        expect(data.views.map((v) => [v.id, v.error])).toEqual([
          ["passages", undefined],
          ["rooms", undefined],
        ]);
        expect(data.views[1]?.nodes.map((n) => n.id)).toEqual(["hall", "library", "cellar"]);
      }
      // An edit to story.ts that only changes an exit still says the map changed.
      const events = new AbortController();
      const stream = await fetch(base + MAP_EVENTS, { signal: events.signal });
      const reader = stream.body?.getReader();
      if (!reader) throw new Error("no event stream");
      const decoder = new TextDecoder();
      let received = decoder.decode((await reader.read()).value);
      const story = path.join(root, "story.ts");
      writeFileSync(
        story,
        readFileSync(story, "utf8").replace("{ south: hall }", "{ south: hall, east: cellar }"),
      );
      while (!received.includes("event: change")) {
        const { value, done } = await reader.read();
        if (done) break;
        received += decoder.decode(value);
      }
      events.abort();
      const after = (await (await fetch(base + MAP_DATA)).json()) as Drawn;
      expect(after.views[1]?.edges.some((e) => e.from === "library" && e.to === "cellar")).toBe(
        true,
      );
    } finally {
      await new Promise((resolve) => http.close(resolve));
      await server.close();
    }
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
