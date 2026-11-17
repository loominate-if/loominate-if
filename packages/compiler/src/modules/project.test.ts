import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEventRecord, createStore, createStory, type Passage } from "@loominate-if/core";
import { afterAll, describe, expect, it } from "vitest";
import { compileProject, type ProjectFile } from "./project.js";

const here = path.dirname(fileURLToPath(import.meta.url));
/** A game root inside the package, so `@loominate-if/core` resolves through its node_modules. */
const root = path.join(here, "__game__");
// Resolve core to its TypeScript source, as tests do everywhere in the repo.
const compilerOptions = { customConditions: ["source"] };

const story = `
import { object, type Handle } from "@loominate-if/core";

export const lantern = object("lantern", { isLit: false, name: "the lantern" });
export const player = object("player", {
  fear: 0,
  carrying: [] as Handle<object>[],
  has(thing: Handle<object>): boolean {
    return this.carrying.includes(thing);
  },
});
`;

const cellar = `:: Cellar Stairs [room: stairs]
{on enter: if (!player.has(lantern)) player.fear += 1}

The steps go down *further* than they should.
{if lantern.isLit}
  Your lantern throws long shadows against the stone.
{else}
  You can't see the bottom.
{/if}

[[Go down -> Cellar]]{when lantern.isLit, reason: "It's too dark to go down."}
[[Back up -> Kitchen]]
`;

const kitchen = `:: Kitchen
{if visited("Cellar Stairs")}You're back in the kitchen.{else}A warm kitchen.{/if}
[[Down -> Cellar Stairs]]

:: Cellar
Damp. You've been scared {player.fear} times.
`;

function compile(files: ProjectFile[]) {
  return compileProject({ root, files, compilerOptions });
}

const show = (r: ReturnType<typeof compile>): string[] =>
  r.diagnostics.map(
    (d) =>
      `${path.relative(root, d.file)}:${String(d.line)}:${String(d.column)} ${d.source}: ${d.message}`,
  );

// These tests build real TypeScript programs, which takes seconds, longer under load from parallel test files.
describe("compileProject", { timeout: 30_000 }, () => {
  it("type-checks a valid game with no errors", () => {
    const result = compile([
      { path: "story.ts", text: story },
      { path: "cellar.weft", text: cellar },
      { path: "kitchen.weft", text: kitchen },
    ]);
    expect(show(result)).toEqual([]);
    expect(result.passageNames.code).toContain(
      'export type PassageName = "Cellar" | "Cellar Stairs" | "Kitchen";',
    );
    expect([...result.modules.keys()].map((f) => path.relative(root, f))).toEqual([
      "cellar.weft",
      "kitchen.weft",
    ]);
  });

  it("generates code that passes noUnusedParameters and noUnusedLocals (#213)", () => {
    const result = compileProject({
      root,
      compilerOptions: { ...compilerOptions, noUnusedParameters: true, noUnusedLocals: true },
      files: [
        { path: "story.ts", text: story },
        { path: "cellar.weft", text: cellar },
        { path: "kitchen.weft", text: kitchen },
        {
          path: "plain.weft",
          text: ":: Plain\nNo code at all.\n\n:: Counted\n{on enter: player.fear += visits}\nVisit {visits}.\n",
        },
      ],
    });
    expect(show(result)).toEqual([]);
  });

  it("reports type errors in inline code at the passage file's lines", () => {
    const result = compile([
      { path: "story.ts", text: story },
      {
        path: "scenes/stairs.weft",
        text: ":: Stairs\nThe lamp {if lantern.isLitt}burns{/if}.\n{on enter: player.fear += 'a lot'}\n",
      },
    ]);
    expect(show(result)).toEqual([
      "scenes/stairs.weft:2:22 typescript: `lantern` has no property `isLitt`. Did you mean `isLit`?",
      "scenes/stairs.weft:3:12 typescript: Type 'string' is not assignable to type 'number'.",
    ]);
  });

  it("only lets text and numbers be printed", () => {
    const result = compile([
      { path: "story.ts", text: story },
      { path: "a.weft", text: ":: A\nYou hold {lantern}.\n" },
    ]);
    expect(show(result)).toEqual([
      "a.weft:2:11 typescript: `lantern` is an object, so it can't be printed. Print one of its properties instead, such as `{lantern.name}`.",
    ]);
  });

  it("names objects by ID in errors, in modules and passages (#212)", () => {
    const result = compile([
      {
        path: "story.ts",
        text: `import { object, spawn, template } from "@loominate-if/core";
export const match = template("match", { isLit: true });
export const matchbox = object("matchbox", {
  count: 3,
  strike() {
    this.cout -= 1;
    return spawn(match, this);
  },
});
`,
      },
      { path: "a.weft", text: ":: A\n{on enter: matchbox.strike().isLot = false}\n" },
    ]);
    expect(show(result)).toEqual([
      "a.weft:2:30 typescript: Property 'isLot' does not exist on type '{ isLit: boolean; }'. Did you mean 'isLit'?",
      "story.ts:6:10 typescript: `matchbox` has no property `cout`. Did you mean `count`?",
    ]);
  });

  it("reports broken links and unreachable passages with their locations (#32)", () => {
    const result = compileProject({
      root,
      compilerOptions,
      start: "Kitchen",
      files: [
        { path: "story.ts", text: story },
        {
          path: "travel.ts",
          text: 'export const shortcut = (goTo: (p: string) => void) => goTo("Attic");\n',
        },
        { path: "cellar.weft", text: cellar },
        {
          path: "kitchen.weft",
          text: kitchen + "[[Up -> Atic]]\n\n:: Attic\nDust.\n\n:: Pantry\nJars.\n",
        },
      ],
    });
    expect(show(result)).toEqual([
      "kitchen.weft:7:9 compiler: There's no passage named `Atic`. Did you mean `Attic`?",
      "kitchen.weft:12:4 compiler: Nothing leads to `Pantry` from `Kitchen`, so players can't reach it. Link to it from another passage, or remove it.",
    ]);
    expect(result.diagnostics.map((d) => d.severity)).toEqual(["error", "warning"]);
    expect(() => compileProject({ root, compilerOptions, start: "Nowhere", files: [] })).toThrow(
      `start: there's no passage named "Nowhere".`,
    );
  });

  it("checks passage names given to visited", () => {
    const result = compile([{ path: "a.weft", text: ':: A\n{if visited("Nowhere")}x{/if}\n' }]);
    expect(show(result)).toEqual([
      `a.weft:2:13 typescript: Argument of type '"Nowhere"' is not assignable to parameter of type '"A"'.`,
    ]);
  });

  it("reports unknown names, and works without a scope module", () => {
    const result = compile([{ path: "a.weft", text: ":: A\n{if lamp.isLit}x{/if}\n" }]);
    expect(show(result)).toEqual(["a.weft:2:5 typescript: Cannot find name 'lamp'."]);
  });

  it("reports scope exports that clash with context or reserved names", () => {
    const result = compile([
      { path: "story.ts", text: "export const visits = 1;\nexport const $secret = 2;\n" },
      { path: "a.weft", text: ":: A\nHi.\n" },
    ]);
    expect(show(result)).toEqual([
      "story.ts:1:14 compiler: The scope module exports `visits`, but passages already have `visits` from their context. Rename the export.",
      "story.ts:2:14 compiler: The scope module exports `$secret`, but names starting with `$` are reserved for generated code. Rename the export.",
    ]);
  });

  it("collects parser, compiler, and TypeScript errors together", () => {
    const result = compile([{ path: "a.weft", text: ":: A\n{beat 1s}\n}\n{if nope}x{/if}\n" }]);
    expect(show(result)).toEqual([
      "a.weft:2:1 compiler: `{beat}` isn't supported yet; it arrives with beats and cut scenes (#41).",
      "a.weft:3:1 parser: This `}` doesn't close anything. Write `\\}` for a literal brace.",
      "a.weft:4:5 typescript: Cannot find name 'nope'.",
    ]);
  });
});

describe("a compiled game", { timeout: 30_000 }, () => {
  // Generated modules are written to disk so they run exactly as the build will run them.
  const out = mkdtempSync(path.join(here, "__run-"));
  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  it("plays through: prose, formatting, guards, effects on objects, and visits", async () => {
    const result = compileProject({
      root: out,
      compilerOptions,
      files: [
        { path: "story.ts", text: story },
        { path: "cellar.weft", text: cellar },
        { path: "kitchen.weft", text: kitchen },
      ],
    });
    expect(show(result)).toEqual([]);
    writeFileSync(path.join(out, "story.ts"), story);
    writeFileSync(result.passageNames.path, result.passageNames.code);
    for (const m of result.modules.values()) writeFileSync(m.path, m.code);

    type Module = { passages: readonly Passage[] };
    const scope = (await import(path.join(out, "story.ts"))) as {
      lantern: { isLit: boolean };
      player: { fear: number };
    };
    const passages: Passage[] = [];
    for (const m of result.modules.values()) {
      passages.push(...((await import(m.path)) as Module).passages);
    }

    const store = createStore();
    const record = createEventRecord(store);
    const game = createStory(store, record, passages, { start: "Kitchen" });
    game.begin();
    expect(game.render().nodes.map((n) => ("text" in n ? n.text : n.type))).toEqual([
      "A warm kitchen.",
      "link",
    ]);

    game.follow({ type: "link", label: "Down", target: "Cellar Stairs" });
    const stairs = game.render();
    expect(stairs.nodes[0]).toEqual({
      type: "text",
      text: "The steps go down further than they should. You can't see the bottom.",
      styles: [{ start: 18, end: 25, style: "emphasis" }],
    });
    expect(stairs.nodes.slice(1)).toEqual([
      expect.objectContaining({
        label: "Go down",
        available: false,
        reason: "It's too dark to go down.",
      }),
      expect.objectContaining({ label: "Back up", available: true }),
    ]);
    expect(scope.player.fear).toBe(1);
    // Inline effects write real state, which undo, save, and replay see.
    expect(store.entity("player")).toEqual({ fear: 1 });

    scope.lantern.isLit = true;
    expect(game.render().nodes[0]).toMatchObject({
      text: "The steps go down further than they should. Your lantern throws long shadows against the stone.",
    });
    game.follow({ type: "link", label: "Go down", target: "Cellar" });
    expect(game.render().nodes).toEqual([
      { type: "text", text: "Damp. You've been scared 1 times." },
    ]);
  });
});
