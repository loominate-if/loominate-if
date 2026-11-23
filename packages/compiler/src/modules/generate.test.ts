import { describe, expect, it } from "vitest";
import { parsePassageFile } from "../passages/parse.js";
import { generatePassageModule, type GenerateOptions } from "./generate.js";
import { toSource } from "./source-map.js";

const options: GenerateOptions = {
  modulePath: "/game/cellar.weft.ts",
  scopeExports: new Set(["lantern", "player", "wait"]),
  scopeSpecifier: "./story.js",
  passageNamesSpecifier: "./$passages.js",
};

function generate(source: string, overrides: Partial<GenerateOptions> = {}) {
  const parsed = parsePassageFile(source, { file: "cellar.weft" });
  expect(parsed.diagnostics).toEqual([]);
  return generatePassageModule(parsed, source, { ...options, ...overrides });
}

const errors = (source: string, overrides?: Partial<GenerateOptions>): string[] =>
  generate(source, overrides).diagnostics.map(
    (d) => `${String(d.line)}:${String(d.column)} ${d.message}`,
  );

describe("generatePassageModule", () => {
  it("exports passages with ids, tags, and a body", () => {
    const { code } = generate(":: Cellar Stairs [room: stairs, dark]\nThe steps go down.\n");
    expect(code).toContain('id: "Cellar Stairs",');
    expect(code).toContain('tags: ["room: stairs", "dark"],');
    expect(code).toContain('$parts.push("The steps go down.");');
    expect(code).toContain("export const passages: readonly $Passage[] = [");
  });

  it("imports only the scope exports and context names the file uses", () => {
    const { code } = generate(":: A\n{if lantern.isLit}x{/if} {visits}\n");
    expect(code).toContain('import { lantern } from "./story.js";');
    expect(code).not.toContain("player");
    expect(code).toContain("const { visits } = $context;");
    expect(code).not.toContain("$PassageName");
  });

  it("declares the context parameter only where it's used", () => {
    const { code } = generate(
      ":: A\n{on enter: player.fear += 1}\n{on leave: if (firstVisit) player.fear = 0}\nHi.\n",
    );
    expect(code).toContain("enter: (): void => {");
    expect(code).toContain("leave: ($context: $EffectContext): void => {");
    expect(code).toContain("body: (): $PassageNode[] => {");
    expect(code).not.toContain("RenderContext");
  });

  it("types visited by passage name", () => {
    const { code } = generate(':: A\n{if visited("B")}x{/if}\n');
    expect(code).toContain('import type { PassageName as $PassageName } from "./$passages.js";');
    expect(code).toContain("const visited: (passage: $PassageName) => boolean = $context.visited;");
  });

  it("puts effect phases in effects, in order, each in its own block", () => {
    const { code } = generate(
      ":: A\n{on enter: player.fear += 1}\n{on first visit: lantern.isLit = true}\n{on enter: player.fear *= 2}\nText.",
    );
    const enter = code.slice(code.indexOf("enter: ("));
    expect(enter.indexOf("player.fear += 1")).toBeLessThan(enter.indexOf("player.fear *= 2"));
    expect(code.indexOf("firstVisit: (")).toBeLessThan(code.indexOf("enter: ("));
  });

  it("generates guards and continue points", () => {
    const { code } = generate(
      ':: A\n[[Go down -> Cellar]]{when lantern.isLit, reason: "Too dark."}\n[[Up -> B]]{when player.fear < 3, disabled}\n{continue -> C, label: "On"}',
    );
    expect(code).toContain(
      '$nodes.push({ type: "link", label: "Go down", target: "Cellar", line: "A:ajfhgp", guard: $rt_linkGuard({ condition: { value: Boolean(lantern.isLit), text: "lantern.isLit", parts: () => [\n// @ts-ignore\n$part("lantern.isLit", () => (lantern.isLit)),\n] }, reason: "Too dark." }) });',
    );
    expect(code).toContain('mode: "disabled"');
    // Core's directives call core's exports, as a package's would (ADR 0015).
    expect(code).toContain(
      'import { linkGuard as $rt_linkGuard, continueTo as $rt_continueTo } from "@loominate-if/core";',
    );
    expect(code).toContain(
      '$nodes.push(...[$rt_continueTo({ target: "C", label: "On" })].flat());',
    );
  });

  it("generates named effects, with durations and options", () => {
    const { code } = generate(
      ":: A\n{effect shake}\nBoom.\n{effect typewriter, duration: 2s, options: { cursor: true }}\nHello.",
    );
    expect(code).toContain('import { namedEffect as $rt_namedEffect } from "@loominate-if/core";');
    expect(code).toContain('$nodes.push(...[$rt_namedEffect({ name: ["shake"] })].flat());');
    expect(code).toContain(
      '$nodes.push(...[$rt_namedEffect({ name: ["typewriter"], duration: 2000, options: { cursor: true } })].flat());',
    );
  });

  it("passes line IDs to prose and links, and reports bad pins", () => {
    const { code } = generate(":: A\n{line lantern}\nHello.\n[[Go -> B]]");
    expect(code).toContain('let $line: string | undefined = "A:lantern";');
    expect(code).toContain("$prose(parts.splice(0), line === undefined ? {} : { line })");
    expect(code).toMatch(/line: "A:[0-9a-z]{6}" \}\);/);
    // A pin's name is not code, so it imports nothing.
    expect(code).not.toContain("import { lantern }");
    expect(errors(":: A\nHello.\n{line late}")).toEqual([
      "3:1 `{line late}` names the paragraph or link below it, but there isn't one. Put it on the line above the text it names.",
    ]);
  });

  it("reports state changes in rendering code, but not in effects", () => {
    expect(
      errors(
        [
          ":: A",
          "{if lantern.isLit = true}Lit.{/if} You shiver{player.fear++}.",
          '[[Go -> B]]{when (player.fear -= 1) > 0, reason: "No."}',
          "{on enter: player.fear++}",
        ].join("\n"),
      ),
    ).toEqual([
      "2:5 `lantern.isLit = true` sets a value instead of comparing. To compare, use `===`: `lantern.isLit === true`.",
      "2:47 Showing a passage can't change state, so `player.fear++` can't run here. Change it in an effect instead, like `{on enter: player.fear++}`.",
      "3:19 Showing a passage can't change state, so `player.fear -= 1` can't run here. Change it in an effect instead, like `{on enter: player.fear -= 1}`.",
    ]);
  });

  it("maps copied code exactly back to the passage file", () => {
    const source = ":: A\n{if lantern.isLit}\nx\n{/if}\n";
    const generated = generate(source);
    const at = generated.code.indexOf("lantern.isLit");
    const back = toSource(generated.mappings, at + "lantern.".length);
    expect(back).toBe(source.indexOf("lantern.isLit") + "lantern.".length);
  });

  it("encodes a version 3 source map", () => {
    const map = generate(":: A\n{on enter: player.fear += 1}\nText.\n").sourceMap();
    expect(map).toMatchObject({
      version: 3,
      file: "/game/cellar.weft.ts",
      sources: ["cellar.weft"],
      names: [],
    });
    expect(map.mappings).toMatch(/^[;A-Za-z0-9+/,]+$/);
  });

  it("puts links inside a paragraph into its prose, with no line of their own", () => {
    const { code } = generate(
      ":: A\nYou could [[ask -> B]]{when lantern.isLit, hidden} now, *or [[leave -> C]]*.\n[[Wait -> A]]",
    );
    expect(code).toContain(
      '$parts.push({ type: "link", label: "ask", target: "B", guard: $rt_linkGuard({ condition: { value: Boolean(lantern.isLit), text: "lantern.isLit", parts: () => [\n// @ts-ignore\n$part("lantern.isLit", () => (lantern.isLit)),\n] }, mode: "hidden" }) });',
    );
    expect(code).toMatch(/\$parts\d+\.push\(\{ type: "link", label: "leave", target: "C" \}\);/);
    expect(code).toMatch(
      /\$nodes\.push\(\{ type: "link", label: "Wait", target: "A", line: "A:\w{6}" \}\);/,
    );
    expect(code.match(/\$flush\(/g)).toHaveLength(3);
  });

  it("reports constructs core can't run yet", () => {
    expect(errors(":: A\n[[*go* -> B]]")).toEqual([
      "2:1 Formatting in link labels isn't supported yet. Remove the `*` from this label.",
    ]);
  });

  it("reports misplaced effects and malformed guards and continue points", () => {
    expect(errors(":: A\n{if x}{on enter: y()}{/if}")).toEqual([
      "2:7 `{on enter: …}` runs when the passage is visited, not when it's shown, so it goes at the top level of the passage, not inside a block.",
    ]);
    expect(
      errors(
        ":: A\n[[a -> B]]{when x, sideways}\n[[a -> B]]{when x, hidden, reason: 'r'}\n{continue}",
      ),
    ).toEqual([
      "2:20 `{when}` takes `hidden` or `disabled` here, not `sideways`.",
      "3:11 `{when}` can't take `hidden` and `reason:` together.",
      "4:1 `{continue}` needs a passage, `-> Name`, like `{continue -> Platform}`.",
    ]);
  });

  it("reports a directive that clashes with a scope export (ADR 0004)", () => {
    expect(errors(":: A\nText.\n{wait}")).toEqual([
      "3:1 `wait` is a directive from @loominate-if/core and also exported by the scope module. Write `{(wait)}` to print the export, or rename it.",
    ]);
  });

  it("generates beats, waits, and page breaks, with effects for each part", () => {
    const { code } = generate(
      ":: A\n{on enter: a()}\nOne.\n{beat 1.5s}\n{on first visit: b()}\nTwo.\n{wait}\nThree.\n{page}\n{on enter: c()}\nFour.",
      { scopeExports: new Set(["a", "b", "c"]) },
    );
    expect(code).toContain(
      'import { beat as $rt_beat, wait as $rt_wait, pageBreak as $rt_pageBreak } from "@loominate-if/core";',
    );
    expect(code).toContain("$nodes.push(...[$rt_beat({ duration: 1500 })].flat());");
    expect(code).toContain("$nodes.push(...[$rt_wait({})].flat());");
    expect(code).toContain("$nodes.push(...[$rt_pageBreak({})].flat());");
    const beats = code.slice(code.indexOf("beats: ["), code.indexOf("body: ("));
    expect(code.slice(code.indexOf("effects: {"), code.indexOf("beats: ["))).toContain("a()");
    expect(beats.indexOf("firstVisit: ")).toBeLessThan(beats.indexOf("b()"));
    expect(beats.match(/^ {6}\{$/gm)).toHaveLength(3);
    expect(beats.indexOf("b()")).toBeLessThan(beats.indexOf("c()"));
    expect(beats).not.toContain("a()");
  });

  it("passes beats' game minutes on, so a cut scene says what game time it costs (#90)", () => {
    const { code } = generate(
      ":: A\nOne.\n{beat 2s, minutes: 120}\nTwo.\n{wait minutes: 30}\nThree.\n{page minutes: 600}\nFour.",
    );
    expect(code).toContain("$rt_beat({ duration: 2000, minutes: 120 })");
    expect(code).toContain("$rt_wait({ minutes: 30 })");
    expect(code).toContain("$rt_pageBreak({ minutes: 600 })");
  });

  it("reports beats inside blocks, and leave effects after a beat", () => {
    expect(
      errors(":: A\n{if x}{wait}{/if}\nOne.\n{beat 1s}\n{on leave: y()}", {
        scopeExports: new Set(["x", "y"]),
      }),
    ).toEqual([
      // Effects are gathered before the body is generated; compileProject sorts by position.
      "5:1 `{on leave: …}` runs when the player leaves the passage, not when they reach a part of it, so it goes before the passage's first beat.",
      "2:7 `{wait}` divides the passage into parts the player reaches in turn, so it goes at the top level of the passage, not inside a block.",
    ]);
  });
});

describe("recording events (#261)", () => {
  it("runs {emit} with its part's {on enter: …} code, in the order they're written", () => {
    const { code } = generate(
      [
        ":: A",
        "{on enter: lantern.isLit = true}",
        '{emit "The lamp is lit.", tags: lamp light}',
        "Text.",
        "{beat 1s}",
        '{emit "Wind.", kind: scene}',
      ].join("\n"),
    );
    expect(code).toContain(
      'enter: ($context: $EffectContext): void => {\n        {\n          lantern.isLit = true\n        }\n        $rt_emitEvent({ text: "The lamp is lit.", tags: ["lamp", "light"] }, $context);\n',
    );
    expect(code).toContain('$rt_emitEvent({ text: "Wind.", kind: "scene" }, $context);');
    expect(code).toMatch(
      /^import \{ emitEvent as \$rt_emitEvent, beat as \$rt_beat \} from "@loominate-if\/core";$/m,
    );
  });

  it("gives effect code emit from the context", () => {
    const { code } = generate(':: A\n{on enter: emit("system", { text: "Hi." })}\n');
    expect(code).toContain("const { emit } = $context;");
  });

  it("explains {emit} in a block, a kind it doesn't take, and missing text", () => {
    expect(
      errors(
        [
          ":: A",
          '{if lantern.isLit}{emit "Lit."}{/if}',
          '{emit "Odd.", kind: navigation}',
          "{emit tags: lamp}",
        ].join("\n"),
      ),
    ).toEqual([
      "3:15 `{emit}` takes `system`, `narrative`, `scene`, `dialogue` or `action-result` here, not `navigation`.",
      '4:1 `{emit}` needs an expression (text), like `{emit "The lamp is lit.", tags: lamp}`.',
      "2:19 `{emit}` runs when the player reaches it, not when the passage is shown, so it goes at the top level of the passage, not inside a block.",
    ]);
  });

  it("refuses emit in rendering code, which must be pure", () => {
    expect(errors(':: A\n{if emit("system", { text: "Hi." })}x{/if}\n')).toEqual([
      '2:5 Showing a passage can\'t record events, so `emit("system", { text: "Hi." })` can\'t run here. Record it when the player arrives instead, like `{on enter: emit("system", { text: "Hi." })}`, or with `{emit "…"}`.',
    ]);
  });
});
