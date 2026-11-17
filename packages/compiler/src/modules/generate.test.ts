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
      '$nodes.push({ type: "link", label: "Go down", target: "Cellar", line: "A:ajfhgp", guard: { open: Boolean(lantern.isLit), condition: "lantern.isLit", mode: "disabled-with-reason", reason: "Too dark." } });',
    );
    expect(code).toContain('mode: "disabled"');
    expect(code).toContain('$nodes.push({ type: "continue", target: "C", label: "On" });');
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
      '$parts.push({ type: "link", label: "ask", target: "B", guard: { open: Boolean(lantern.isLit), condition: "lantern.isLit", mode: "hidden" } });',
    );
    expect(code).toMatch(/\$parts\d+\.push\(\{ type: "link", label: "leave", target: "C" \}\);/);
    expect(code).toMatch(
      /\$nodes\.push\(\{ type: "link", label: "Wait", target: "A", line: "A:\w{6}" \}\);/,
    );
    expect(code.match(/\$flush\(/g)).toHaveLength(3);
  });

  it("reports constructs core can't run yet", () => {
    expect(errors(":: A\n{beat 1s}\n{wait}", { scopeExports: new Set() })).toEqual([
      "2:1 `{beat}` isn't supported yet; it arrives with beats and cut scenes (#41).",
      "3:1 `{wait}` isn't supported yet; it arrives with beats and cut scenes (#41).",
    ]);
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
      '2:20 `{when}` takes a condition, then optionally `hidden`, `disabled`, or `reason: "…"`.',
      "3:11 `reason:` already shows the link disabled with its reason, so `hidden` can't go with it.",
      "4:1 `{continue}` needs a passage, like `{continue -> Platform}`.",
    ]);
  });

  it("reports a directive that clashes with a scope export (ADR 0004)", () => {
    expect(errors(":: A\nText.\n{wait}")).toEqual([
      "3:1 `wait` is a directive and also exported by the scope module. Write `{(wait)}` to print the export, or rename it.",
      "3:1 `{wait}` isn't supported yet; it arrives with beats and cut scenes (#41).",
    ]);
  });
});
