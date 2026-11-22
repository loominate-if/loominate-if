import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEventRecord, createStore, createStory, type Passage } from "@loominate-if/core";
import { afterAll, describe, expect, it } from "vitest";
import type { CompilerExtension } from "../extensions/extension.js";
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

/** The world model's `room:` role, which the cellar uses, standing in for the real package. */
const world: CompilerExtension = { name: "@loominate-if/world", tagRoles: [{ name: "room" }] };

function compile(files: ProjectFile[]) {
  return compileProject({ root, files, compilerOptions, extensions: [world] });
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
      extensions: [world],
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
      extensions: [world],
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
          text:
            kitchen +
            '[[Up -> Atic]]\n\n:: Attic\nDust.\n\n:: Pantry\n{if visited("Pantry")}Jars.{/if}\n',
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

  it("explains names passages can't see (#33)", () => {
    const result = compile([
      { path: "story.ts", text: story },
      {
        path: "items.ts",
        text: 'import { object } from "@loominate-if/core";\nexport const rope = object("rope", { length: 3 });\n',
      },
      {
        path: "a.weft",
        text: ":: A\n{if lanter.isLit}x{/if}\n{rope.length}\n{if vists > 1}y{/if}\n{if ghost}z{/if}\n",
      },
    ]);
    expect(show(result)).toEqual([
      "a.weft:2:5 typescript: `lanter` isn't defined. Did you mean `lantern`?",
      'a.weft:3:2 typescript: `rope` is exported by `items.ts`, but passages only see what `story.ts` exports. Add `export { rope } from "./items.js";` to `story.ts`.',
      "a.weft:4:5 typescript: `vists` isn't defined. Did you mean `visits`?",
      "a.weft:5:5 typescript: `ghost` isn't defined. Passages can use what `story.ts` exports, and `visits`, `firstVisit`, and `visited`.",
    ]);
  });

  it("reports duplicate and reserved object IDs, through wrappers too (#33)", () => {
    const result = compile([
      {
        path: "story.ts",
        text: `import { object, type Handle } from "@loominate-if/core";
export const lantern = object("lantern", { isLit: false });
export const thing = <const Id extends string>(id: Id) => object(id, { portable: true });
export const lamp = thing("lantern");
export const odd = object("gen:odd", {});
export const sneaky = object("$story", {});
export const same = (): Handle<{ isLit: boolean }, "lantern"> => lantern;
export const again = same();
`,
      },
      {
        path: "more.ts",
        text: 'import { object } from "@loominate-if/core";\nexport const dup = object("lantern", {});\n',
      },
    ]);
    expect(show(result)).toEqual([
      "more.ts:2:27 compiler: The object ID `lantern` is also used at story.ts:2:31, story.ts:4:27. Object IDs must be unique, so give each object its own ID.",
      "story.ts:2:31 compiler: The object ID `lantern` is also used at more.ts:2:27, story.ts:4:27. Object IDs must be unique, so give each object its own ID.",
      "story.ts:4:27 compiler: The object ID `lantern` is also used at more.ts:2:27, story.ts:2:31. Object IDs must be unique, so give each object its own ID.",
      "story.ts:5:27 compiler: Object IDs starting with `gen:` are reserved for objects created during play. Choose another ID.",
      "story.ts:6:30 compiler: Object IDs starting with `$` are reserved for the engine. Choose another ID.",
    ]);
  });

  it("checks passage names given to visited", () => {
    const result = compile([{ path: "a.weft", text: ':: A\n{if visited("Nowhere")}x{/if}\n' }]);
    expect(show(result)).toEqual([
      `a.weft:2:13 typescript: Argument of type '"Nowhere"' is not assignable to parameter of type '"A"'.`,
    ]);
  });

  it("reports unknown names, and works without a scope module", () => {
    const result = compile([{ path: "a.weft", text: ":: A\n{if lamp.isLit}x{/if}\n" }]);
    expect(show(result)).toEqual([
      "a.weft:2:5 typescript: `lamp` isn't defined. To use it in passages, export it from `story.ts`.",
    ]);
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

  it("explains common inline-code mistakes at the author's line", () => {
    const scope = [
      'import { object } from "@loominate-if/core";',
      'export const lantern = object("lantern", { isLit: false, oil: 3 });',
      'export const player = object("player", { nick: null as string | null, mood: "calm" as "calm" | "scared" });',
    ].join("\n");
    const passages = [
      ":: Start",
      "The lamp is {lantern.isLit}.",
      "Hi, {player.nick}.",
      '{if visited("Cellr")}Back.{/if}',
      '{if lantern.oil == "full"}Full.{/if}',
      '{on enter: player.mood = "happy"}',
      "{on enter: lantern = 3}",
      "[[Down -> Cellar]]",
      ":: Cellar",
      "Damp.",
    ].join("\n");
    const result = compile([
      { path: "story.ts", text: scope },
      { path: "a.weft", text: passages },
    ]);
    expect(show(result)).toEqual([
      "a.weft:2:14 typescript: `lantern.isLit` is true or false, so it can't be printed. To show text that depends on it, use `{if lantern.isLit}…{else}…{/if}`.",
      'a.weft:3:6 typescript: `player.nick` might be `null`, so it can\'t be printed. Give it a fallback, like `{player.nick ?? "…"}`, or check it first with `{if player.nick !== null}…{/if}`.',
      "a.weft:4:13 typescript: There's no passage named `Cellr`. Did you mean `Cellar`?",
      "a.weft:5:5 typescript: This comparison can never match: one side is `number` and the other is `string`. Check the value you're comparing with.",
      'a.weft:6:12 typescript: `player.mood` holds `"calm" | "scared"`, so it can\'t be set to `"happy"`.',
      "a.weft:7:12 typescript: `lantern` comes from `story.ts`, and passages can't replace it. Change one of its properties instead.",
    ]);
  });

  it("collects parser, compiler, and TypeScript errors together", () => {
    const result = compile([
      { path: "a.weft", text: ":: A\n{if 1}{beat 1s}{/if}\n}\n{if nope}x{/if}\n" },
    ]);
    expect(show(result)).toEqual([
      "a.weft:2:7 compiler: `{beat}` divides the passage into parts the player reaches in turn, so it goes at the top level of the passage, not inside a block.",
      "a.weft:3:1 parser: This `}` doesn't close anything. Write `\\}` for a literal brace.",
      "a.weft:4:5 typescript: `nope` isn't defined. To use it in passages, export it from `story.ts`.",
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
      extensions: [world],
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
      line: "Cellar Stairs:mdfqlr",
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
      // The same source paragraph, whichever branch shows.
      line: "Cellar Stairs:mdfqlr",
    });
    game.follow({ type: "link", label: "Go down", target: "Cellar" });
    expect(game.render().nodes).toEqual([
      { type: "text", text: "Damp. You've been scared 1 times.", line: "Cellar:zyah7f" },
    ]);
  });

  it("plays through a link inside a paragraph", async () => {
    const scope = "export const clues = { found: false };\n";
    const source = [
      ":: Study",
      "A desk. You could [[read the letter -> Letter]]{when clues.found, hidden} or *[[leave -> Hall]]*.",
      ":: Letter",
      "It's unsigned.",
      ":: Hall",
      "Cold.",
    ].join("\n");
    // Its own directory, since another test already imported a story.ts.
    const dir = path.join(out, "inline");
    mkdirSync(dir);
    const result = compileProject({
      root: dir,
      extensions: [world],
      compilerOptions,
      files: [
        { path: "story.ts", text: scope },
        { path: "study.weft", text: source },
      ],
    });
    expect(show(result)).toEqual([]);
    writeFileSync(path.join(dir, "story.ts"), scope);
    writeFileSync(result.passageNames.path, result.passageNames.code);
    const [module] = result.modules.values();
    if (!module) throw new Error("no module");
    writeFileSync(module.path, module.code);
    const { passages } = (await import(module.path)) as { passages: Passage[] };
    const { clues } = (await import(path.join(dir, "story.ts"))) as { clues: { found: boolean } };

    const store = createStore();
    const game = createStory(store, createEventRecord(store), passages, { start: "Study" });
    game.begin();
    // Hidden, the letter's label stays in the sentence as plain words.
    const [hidden] = game.render().nodes;
    expect(hidden).toMatchObject({
      text: "A desk. You could read the letter or leave.",
      styles: [{ start: 37, end: 42, style: "emphasis" }],
      links: [{ label: "leave", target: "Hall", start: 37, end: 42, available: true }],
    });
    expect(game.render().choices.map((c) => c.label)).toEqual(["leave"]);

    clues.found = true;
    expect(game.render().choices.map((c) => c.label)).toEqual(["read the letter", "leave"]);
    const [shown] = game.render().nodes;
    if (shown?.type !== "text") throw new Error("expected text");
    const [letter] = shown.links ?? [];
    if (!letter) throw new Error("expected a link");
    expect(shown.text.slice(letter.start, letter.end)).toBe("read the letter");
    game.follow(letter);
    expect(game.current).toBe("Letter");
  });

  it("explains a closed guard with the value of each part of its condition (#47)", async () => {
    const scope = [
      "export const lamp = { lit: false, oil: 0 };",
      "export const keeper = { box: null as { matches: number } | null };",
      "",
    ].join("\n");
    const source = [
      ":: Tower",
      "[[Light the lamp -> Lit]]{when lamp.lit || lamp.oil > 0, disabled}",
      "[[Strike a match -> Lit]]{when keeper.box !== null && keeper.box.matches > 0}",
      "[[Wait -> Lit]]{when !lamp.lit}",
      ":: Lit",
      "Bright.",
    ].join("\n");
    const dir = path.join(out, "explain");
    mkdirSync(dir);
    const result = compileProject({
      root: dir,
      extensions: [world],
      compilerOptions,
      files: [
        { path: "story.ts", text: scope },
        { path: "tower.weft", text: source },
      ],
    });
    // `keeper.box.matches` alone isn't narrowed by `keeper.box !== null`, but parts aren't checked again.
    expect(show(result)).toEqual([]);
    writeFileSync(path.join(dir, "story.ts"), scope);
    writeFileSync(result.passageNames.path, result.passageNames.code);
    const [module] = result.modules.values();
    if (!module) throw new Error("no module");
    writeFileSync(module.path, module.code);
    const { passages } = (await import(module.path)) as { passages: Passage[] };
    const store = createStore();
    const game = createStory(store, createEventRecord(store), passages, { start: "Tower" });
    game.begin();
    const closed = game.render().unavailable.map((u) => [u.link.label, u.link.guard?.parts]);
    expect(closed).toEqual([
      [
        "Light the lamp",
        [
          { text: "lamp.lit", value: "false" },
          { text: "lamp.oil > 0", value: "false" },
          { text: "lamp.oil", value: "0" },
        ],
      ],
      [
        "Strike a match",
        [
          { text: "keeper.box !== null", value: "false" },
          { text: "keeper.box", value: "null" },
          { text: "keeper.box.matches > 0", error: expect.stringMatching(/null/) as string },
          { text: "keeper.box.matches", error: expect.stringMatching(/null/) as string },
        ],
      ],
    ]);
    // An open guard has nothing to explain, and its parts aren't evaluated.
    expect(
      game.render().choices.map((c) => [c.label, "guard" in c ? c.guard?.parts : undefined]),
    ).toEqual([["Wait", undefined]]);
  });

  it("reports a mistake in a guard's condition once", () => {
    const result = compile([
      { path: "story.ts", text: story },
      {
        path: "stairs.weft",
        text: ":: Stairs\n[[Down -> Stairs]]{when lantern.isLitt && player.fear > 0}\n",
      },
    ]);
    expect(show(result)).toEqual([
      "stairs.weft:2:33 typescript: `lantern` has no property `isLitt`. Did you mean `isLit`?",
    ]);
  });

  it("plays through beats, with effects written after them run as the player reaches them", async () => {
    const scope =
      'import { object } from "@loominate-if/core";\nexport const train = object("train", { stopped: false, beats: 0 });\n';
    const source = [
      ":: Arrival",
      "{on enter: train.beats = 0}",
      "The train slows.",
      "{beat 1.5s}",
      "{on enter: train.beats += 1}",
      "Brakes scream.",
      "{wait}",
      "{on first visit: train.stopped = true}",
      "{if train.stopped}It stops.{/if}",
      "{page}",
      "[[Get off -> Platform]]",
      ":: Platform",
      "Cold air.",
    ].join("\n");
    const dir = path.join(out, "beats");
    mkdirSync(dir);
    const result = compileProject({
      root: dir,
      compilerOptions,
      files: [
        { path: "story.ts", text: scope },
        { path: "arrival.weft", text: source },
      ],
    });
    expect(show(result)).toEqual([]);
    writeFileSync(path.join(dir, "story.ts"), scope);
    writeFileSync(result.passageNames.path, result.passageNames.code);
    const [module] = result.modules.values();
    if (!module) throw new Error("no module");
    writeFileSync(module.path, module.code);
    const { passages } = (await import(module.path)) as { passages: Passage[] };

    const store = createStore();
    const game = createStory(store, createEventRecord(store), passages, { start: "Arrival" });
    game.begin();
    const text = () => game.render().nodes.map((n) => ("text" in n ? n.text : n.type));
    expect(text()).toEqual(["The train slows."]);
    expect(game.render().beat).toEqual({ type: "beat", duration: 1500 });
    game.advance();
    expect(text()).toEqual(["The train slows.", "Brakes scream."]);
    expect(store.entity("train")).toEqual({ beats: 1 });
    game.advance();
    expect(text()).toEqual(["The train slows.", "Brakes scream.", "It stops."]);
    expect(game.render().beat).toEqual({ type: "beat", page: true });
    game.advance();
    expect(text()).toEqual(["link"]);
    expect(store.entity("train")).toEqual({ beats: 1, stopped: true });
  });

  it("records author events from {emit}, emit in effects, and story.ts, with the passage's tags (#261)", async () => {
    const scope = [
      'import { emit, object } from "@loominate-if/core";',
      'export const lamp = object("lamp", {',
      "  lit: false,",
      "  light() {",
      "    this.lit = true;",
      '    emit("system", { text: "The lamp is lit." }, ["lamp"]);',
      "  },",
      "});",
      "",
    ].join("\n");
    // The inspector guide quotes this passage.
    const source = readFileSync(path.join(here, "fixtures", "lamp-room.weft"), "utf8");
    const dir = path.join(out, "events");
    mkdirSync(dir);
    const result = compileProject({
      root: dir,
      compilerOptions,
      files: [
        { path: "story.ts", text: scope },
        { path: "lamp.weft", text: source },
      ],
    });
    expect(show(result)).toEqual([]);
    writeFileSync(path.join(dir, "story.ts"), scope);
    writeFileSync(result.passageNames.path, result.passageNames.code);
    const [module] = result.modules.values();
    if (!module) throw new Error("no module");
    writeFileSync(module.path, module.code);
    const { passages } = (await import(module.path)) as { passages: Passage[] };

    const store = createStore();
    const record = createEventRecord(store);
    const game = createStory(store, record, passages, { start: "Lamp Room" });
    const events = (since = 0) =>
      record.events({ since }).map((e) => [e.kind, "text" in e ? e.text : "", e.tags]);
    game.begin();
    expect(events()).toEqual([
      ["navigation", "", ["scene"]],
      ["phase", "", ["scene"]],
      ["system", "The lamp is lit.", ["scene", "lamp"]],
      ["system", "Wind howls.", ["scene", "storm"]],
      ["narrative", "The lamp room.", ["scene"]],
    ]);
    const before = record.length;
    game.advance();
    expect(events(before)).toEqual([
      ["beat", "", ["scene"]],
      ["phase", "", ["scene"]],
      ["scene", "The ship turns.", ["scene", "ship", "storm"]],
      ["system", "First time up here.", ["scene", "first"]],
      ["narrative", "Far out, lights.", ["scene"]],
    ]);
    // Rendering again records nothing: events are recorded as the player arrives.
    game.render();
    expect(record.length).toBe(before + 5);
    expect(record.events({ tags: ["storm"] }).map((e) => e.kind)).toEqual(["system", "scene"]);
  });

  it("gives rendered prose, links, and narrative events stable line IDs", async () => {
    const source = [
      ":: Start",
      "Hello {if firstVisit}there.",
      "",
      "Welcome {/if}friend.",
      "{line again}",
      "[[Again -> Start]]",
    ].join("\n");
    const result = compileProject({
      root: out,
      extensions: [world],
      compilerOptions,
      files: [{ path: "lines.weft", text: source }],
    });
    expect(show(result)).toEqual([]);
    writeFileSync(result.passageNames.path, result.passageNames.code);
    const [module] = result.modules.values();
    if (!module) throw new Error("no module");
    writeFileSync(module.path, module.code);
    const { passages } = (await import(module.path)) as { passages: Passage[] };

    const store = createStore();
    const record = createEventRecord(store);
    const game = createStory(store, record, passages, { start: "Start" });
    game.begin();
    const first = game.render().nodes;
    const [hello, welcome, link] = first.map((n) => ("line" in n ? n.line : undefined));
    expect(first.map((n) => n.type === "text" && n.text)).toEqual([
      "Hello there.",
      "Welcome friend.",
      false,
    ]);
    expect(hello).toMatch(/^Start:[0-9a-z]{6}$/);
    expect(welcome).toMatch(/^Start:[0-9a-z]{6}$/);
    expect(welcome).not.toBe(hello);
    expect(link).toBe("Start:again");

    // Without the branch, the two source paragraphs render as one, which
    // takes the line of the first one that adds text to it.
    game.follow({ type: "link", label: "Again", target: "Start" });
    expect(game.render().nodes[0]).toEqual({ type: "text", text: "Hello friend.", line: hello });
    expect(record.events({ kinds: ["narrative"] }).map((e) => [e.text, e.line])).toEqual([
      ["Hello there.", hello],
      ["Welcome friend.", welcome],
      ["Hello friend.", hello],
    ]);
  });
});

describe("a tag role that runs on arrival", { timeout: 30_000 }, () => {
  const out = mkdtempSync(path.join(here, "__run-"));
  afterAll(() => {
    rmSync(out, { recursive: true, force: true });
  });

  /** A `room:` role that calls the game's own `enterRoom`, as the world model's does. */
  const rooms: CompilerExtension = {
    name: "rooms",
    tagRoles: [
      { name: "room", entry: true, arrival: { module: "./story.js", export: "enterRoom" } },
    ],
  };
  const scope = [
    'import { object, type EffectContext } from "@loominate-if/core";',
    "export type Room = { readonly id: string; readonly isRoom: true };",
    'export const cellar = object("vault", { isRoom: true as const });',
    'export const lamp = object("torch", { lit: false });',
    'export const log = object("trail", { entries: [] as string[] });',
    "export function enterRoom(room: Room, context: EffectContext): void {",
    "  log.entries.push(`arrive ${room.id} ${String(context.visits)}`);",
    "}",
  ].join("\n");
  const build = (dir: string, weft: string) =>
    compileProject({
      root: dir,
      compilerOptions,
      extensions: [rooms],
      files: [
        { path: "story.ts", text: scope },
        { path: "rooms.weft", text: weft },
      ],
    });
  const where = (r: ReturnType<typeof build>, dir: string): string[] =>
    r.diagnostics.map(
      (d) => `${path.relative(dir, d.file)}:${String(d.line)}:${String(d.column)} ${d.message}`,
    );

  it("calls the role's runtime with its value, before the passage's own enter code", async () => {
    const dir = path.join(out, "arrive");
    mkdirSync(dir);
    const result = build(
      dir,
      ':: Start [room: cellar]\n{on enter: log.entries.push("enter")}\nDamp.\n',
    );
    expect(where(result, dir)).toEqual([]);
    writeFileSync(path.join(dir, "story.ts"), scope);
    writeFileSync(result.passageNames.path, result.passageNames.code);
    const [module] = result.modules.values();
    if (!module) throw new Error("no module");
    writeFileSync(module.path, module.code);
    const { passages } = (await import(module.path)) as { passages: Passage[] };
    const store = createStore();
    createStory(store, createEventRecord(store), passages, { start: "Start" }).begin();
    expect(store.entity("trail")).toEqual({ entries: ["arrive vault 1", "enter"] });
  });

  it("reports a value that isn't defined, or isn't the right kind, at the tag", () => {
    const dir = path.join(out, "wrong");
    mkdirSync(dir);
    const result = build(
      dir,
      ":: Start [room: celar]\nDamp.\n:: Shed [scene, room: lamp]\nTools.\n",
    );
    const found = where(result, dir);
    expect(found[0]).toBe("rooms.weft:1:17 `celar` isn't defined. Did you mean `cellar`?");
    expect(found[1]).toMatch(/^rooms\.weft:3:23 .*isRoom/s);
    expect(found).toHaveLength(2);
  });
});
