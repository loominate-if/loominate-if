import { describe, expect, it } from "vitest";
import { checkObjectIds, type ObjectDefinitionSite } from "./object-ids.js";

const site = (id: string, file: string, start: number): ObjectDefinitionSite => ({
  id,
  file,
  start,
  end: start + id.length + 2,
});

describe("checkObjectIds", () => {
  it("reports every definition of a repeated ID, pointing at the others", () => {
    const sites = [site("lamp", "a.ts", 1), site("key", "a.ts", 5), site("lamp", "b.ts", 9)];
    const problems = checkObjectIds(sites, (s) => `${s.file}@${String(s.start)}`);
    expect(problems.map((p) => `${p.site.file}@${String(p.site.start)}: ${p.message}`)).toEqual([
      "a.ts@1: The object ID `lamp` is also used at b.ts@9. Object IDs must be unique, so give each object its own ID.",
      "b.ts@9: The object ID `lamp` is also used at a.ts@1. Object IDs must be unique, so give each object its own ID.",
    ]);
  });

  it("reports reserved prefixes", () => {
    const problems = checkObjectIds(
      [site("gen:x", "a.ts", 0), site("$story", "a.ts", 9)],
      () => "",
    );
    expect(problems.map((p) => p.message)).toEqual([
      "Object IDs starting with `gen:` are reserved for objects created during play. Choose another ID.",
      "Object IDs starting with `$` are reserved for the engine. Choose another ID.",
    ]);
  });
});
