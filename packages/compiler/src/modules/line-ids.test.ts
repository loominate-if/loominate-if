import { describe, expect, it } from "vitest";
import { parsePassageFile } from "../passages/parse.js";
import { lineHash, passageLines } from "./line-ids.js";

function lines(source: string) {
  const parsed = parsePassageFile(source, { file: "a.weft" });
  expect(parsed.diagnostics).toEqual([]);
  const [passage] = parsed.passages;
  if (!passage) throw new Error("no passage");
  return passageLines(passage, source);
}

/** Each paragraph's first words, with the line ID at that point. */
function byText(source: string, texts: string[]): Record<string, string | undefined> {
  const result = lines(source);
  return Object.fromEntries(texts.map((t) => [t, result.lineAt(source.indexOf(t))]));
}

const problems = (source: string): string[] => lines(source).problems.map((p) => p.message);

describe("lineHash", () => {
  it("never changes: saves, voice files, and translations depend on it", () => {
    expect(lineHash("")).toBe("j4ux45");
    expect(lineHash("It's dark.")).toBe(lineHash("It's dark."));
    expect([lineHash("It's dark."), lineHash("Ça va? 🕯")]).toEqual(["b1g3v0", "t6r3ht"]);
  });
});

describe("passageLines", () => {
  const original = [":: Cellar", "It's dark.", "", "A draft blows.", "", "Water drips."].join("\n");
  const texts = ["It's dark.", "A draft blows.", "Water drips."];

  it("names lines after the passage", () => {
    for (const id of Object.values(byText(original, texts))) {
      expect(id).toMatch(/^Cellar:[0-9a-z]{6}$/);
    }
  });

  it("keeps IDs when other lines are added, removed, edited, or moved", () => {
    const before = byText(original, texts);
    const edited = [
      ":: Cellar",
      "Somewhere, a rat.",
      "",
      "Water drips.",
      "",
      "It's dark.",
      "",
      "A cold draft blows.",
    ].join("\n");
    const after = byText(edited, ["It's dark.", "Water drips.", "A cold draft blows."]);
    expect(after["It's dark."]).toBe(before["It's dark."]);
    expect(after["Water drips."]).toBe(before["Water drips."]);
    expect(after["A cold draft blows."]).not.toBe(before["A draft blows."]);
  });

  it("ignores rewrapping, indentation, comments, and effect code", () => {
    const a = ":: A\nThe steps go down\nfurther than they should.\n{on enter: x = 1}\n";
    const b =
      ":: A\n  The steps go down /* note */ further\n  // a comment\n  than they should.\n{on enter: x = 2}\n";
    expect(byText(b, ["The steps"])).toEqual(byText(a, ["The steps"]));
  });

  it("counts code and formatting as part of the line", () => {
    const ids = [
      ":: A\nYou see {lamp}.",
      ":: A\nYou see {lamp.name}.",
      ":: A\nYou see *{lamp}*.",
      ":: A\nYou see {if lit}{lamp}{/if}.",
    ].map((s) => byText(s, ["You see"])["You see"]);
    expect(new Set(ids).size).toBe(4);
  });

  it("numbers repeated lines in order", () => {
    const source = ":: A\nAgain.\n\nOnce.\n\nAgain.\n";
    const result = lines(source);
    const first = result.lineAt(source.indexOf("Again."));
    expect(result.lineAt(source.lastIndexOf("Again."))).toBe(`${first ?? ""}-2`);
    expect(result.ids).toHaveLength(3);
  });

  it("ends lines at links and continue points, and gives links their own IDs", () => {
    const source = ":: A\nBefore.\n[[Go -> B]]\nAfter.\n{continue -> C}\nLast.";
    const result = lines(source);
    const at = (t: string) => result.lineAt(source.indexOf(t));
    expect(new Set([at("Before."), at("After."), at("Last.")]).size).toBe(3);
    const [link] = result.links.values();
    expect(link).toMatch(/^A:[0-9a-z]{6}$/);
    expect(result.ids).toEqual([at("Before."), link, at("After."), at("Last.")]);
  });

  it("keeps inline links in their paragraph's line", () => {
    const source = ":: A\nYou could [[ask -> B]] now.\n[[Leave -> C]]";
    const result = lines(source);
    const paragraph = result.lineAt(source.indexOf("You"));
    expect(result.lineAt(source.indexOf("now"))).toBe(paragraph);
    expect([...result.links.values()]).toHaveLength(1);
    expect(result.ids).toEqual([paragraph, [...result.links.values()][0]]);
    // The label is part of the line's text; the target isn't.
    const id = (s: string) => lines(s).lineAt(s.indexOf("You"));
    expect(id(":: A\nYou could [[ask -> C]] now.")).toBe(paragraph);
    expect(id(":: A\nYou could [[enquire -> B]] now.")).not.toBe(paragraph);
  });

  it("keeps a link's ID when its target or guard changes, not its label", () => {
    const link = (s: string) => [...lines(s).links.values()][0];
    expect(link(":: A\n[[Go -> B]]")).toBe(link(":: A\n[[Go -> C]]{when ok}"));
    expect(link(":: A\n[[Go -> B]]")).not.toBe(link(":: A\n[[Leave -> B]]"));
  });

  it("has no line where there's no prose", () => {
    const source = ":: A\n{if x}\n\n{/if}\n[[Go -> B]]";
    const result = lines(source);
    expect(result.lineAt(source.indexOf("{if"))).toBeUndefined();
    expect(result.ids).toHaveLength(1);
  });
});

describe("{line} pins", () => {
  it("pins the paragraph or link below it", () => {
    const source = ":: Cellar\n{line drip}\nWater drips.\n{line down_2}\n[[Down -> Deep]]\n";
    const result = lines(source);
    expect(result.lineAt(source.indexOf("Water"))).toBe("Cellar:drip");
    expect([...result.links.values()]).toEqual(["Cellar:down_2"]);
    expect(result.problems).toEqual([]);
  });

  it("keeps a pinned ID when its text changes", () => {
    const id = (s: string) => lines(s).lineAt(s.indexOf("Water"));
    expect(id(":: A\n{line drip}\nWater drips.")).toBe(id(":: A\n{line drip}\nWater dirps."));
  });

  it("steps hashed IDs around pinned ones", () => {
    const source = ":: A\nSame.\n\n{line x}\nOther.\n\nSame.";
    const hashed = `A:${lineHash("Same.")}`;
    const pinned = source.replace("{line x}", `{line ${lineHash("Same.")}}`);
    expect(lines(pinned).ids).toEqual([`${hashed}-2`, hashed, `${hashed}-3`]);
    expect(lines(source).ids).toEqual([hashed, "A:x", `${hashed}-2`]);
  });

  it("reports pins that are malformed, misplaced, doubled, or reused", () => {
    expect(problems(':: A\n{line "drip"}\nText.\n{line}\nMore.')).toEqual([
      "`{line}` takes one name made of letters, digits, `-`, and `_`, like `{line cellar-drip}`.",
      "`{line}` takes one name made of letters, digits, `-`, and `_`, like `{line cellar-drip}`.",
    ]);
    expect(problems(":: A\nText.\n{line late}")).toEqual([
      "`{line late}` names the paragraph or link below it, but there isn't one. Put it on the line above the text it names.",
    ]);
    expect(problems(":: A\n{line a}\n{line b}\nText.")).toEqual([
      "This paragraph already has `{line a}`. Give it one `{line}`.",
    ]);
    expect(problems(":: A\n{line a}\nOne.\n\n{line a}\nTwo.")).toEqual([
      "`{line a}` is already used in `A`. Line names must be unique within a passage.",
    ]);
  });
});
