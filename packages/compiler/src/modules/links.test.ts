import { describe, expect, it } from "vitest";
import { parsePassageFile } from "../passages/parse.js";
import { checkLinks, closestName, stringLiterals, type FilePassage } from "./links.js";

function passages(source: string): FilePassage[] {
  const parsed = parsePassageFile(source, { file: "a.weft" });
  expect(parsed.diagnostics).toEqual([]);
  return parsed.passages.map((passage) => ({ file: "a.weft", passage }));
}

const report = (source: string, named: string[] = [], start?: string): string[] =>
  checkLinks(passages(source), new Set(named), start).map(
    (p) =>
      `${p.severity} ${String(p.at.span.start)} ${source.slice(p.at.span.start, p.at.span.end)}: ${p.message}`,
  );

describe("checkLinks", () => {
  it("reports links and continue points to missing passages, at the name", () => {
    const source = [
      ":: Kitchen",
      "[[Down -> Cellr]]",
      "{if true}[[Attic]]{/if}",
      "{continue -> Garden}",
      ":: Cellar",
      "Damp.",
    ].join("\n");
    expect(report(source)).toEqual([
      "error 21 Cellr: There's no passage named `Cellr`. Did you mean `Cellar`?",
      "error 40 Attic: There's no passage named `Attic`. Check the spelling, or add the passage.",
      "error 66 Garden: There's no passage named `Garden`. Check the spelling, or add the passage.",
    ]);
  });

  it("warns about passages nothing leads to from the start", () => {
    const source = [
      ":: Start",
      "[[Hall]]",
      ":: Hall",
      "{if false}[[Start]]{/if}",
      ":: Attic",
      "[[Cupboard]]",
      ":: Cupboard",
      "Dust.",
      ":: Secret",
      "Found by code.",
    ].join("\n");
    expect(report(source, ["Secret"], "Start")).toEqual([
      "warning 54 Attic: Nothing leads to `Attic` from `Start`, so players can't reach it. Link to it from another passage, or remove it.",
      "warning 76 Cupboard: Nothing leads to `Cupboard` from `Start`, so players can't reach it. Link to it from another passage, or remove it.",
    ]);
  });

  it("doesn't check reachability without a start passage", () => {
    expect(report(":: A\nText.\n:: B\nText.")).toEqual([]);
  });
});

describe("closestName", () => {
  it("suggests close names, ignoring case, and nothing for distant ones", () => {
    const names = ["Cellar", "Cellar Stairs", "Kitchen"];
    expect(closestName("cellar", names)).toBe("Cellar");
    expect(closestName("Celar Stairs", names)).toBe("Cellar Stairs");
    expect(closestName("Kitchn", names)).toBe("Kitchen");
    expect(closestName("Garden", names)).toBeUndefined();
  });
});

describe("stringLiterals", () => {
  it("leaves out passages that code only asks about", () => {
    expect(
      stringLiterals(
        'if (visited("Attic") && story.visits("Hall") > 1 && $context.visited(`Cellar`)) goTo("Garden");\nvisited(lookup("Pantry"));',
      ),
    ).toEqual(["Garden", "Pantry"]);
  });

  it("finds strings and plain template literals, not identifiers or comments", () => {
    expect(
      stringLiterals('goTo("Attic"); hint(`Cellar`); const Hall = 1; // "Nope"\n`a${x}b`'),
    ).toEqual(["Attic", "Cellar"]);
  });
});
