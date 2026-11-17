import { describe, expect, it } from "vitest";
import { renderWriteMessage, renderWrites } from "./render-writes.js";

const texts = (code: string): string[] => renderWrites(code).map((w) => w.text);

describe("renderWrites", () => {
  it("finds assignments, updates, and deletes, at their offsets", () => {
    expect(renderWrites("lantern.isLit = true")).toEqual([
      { start: 0, end: 20, text: "lantern.isLit = true", comparison: "lantern.isLit === true" },
    ]);
    expect(texts("player.fear++")).toEqual(["player.fear++"]);
    expect(texts("a && --b")).toEqual(["--b"]);
    expect(texts("(gold += 5) > 3")).toEqual(["gold += 5"]);
    expect(texts("x ??= y")).toEqual(["x ??= y"]);
    expect(texts("delete bag.lamp")).toEqual(["delete bag.lamp"]);
  });

  it("reports a nested write once", () => {
    expect(texts("a = b = 1")).toEqual(["a = b = 1"]);
  });

  it("ignores comparisons, reads, and functions written in the code", () => {
    expect(
      texts(
        "a === b && c !== d && e <= f && g >= h && i == j && -k > +l && items.map((x) => { let n = 0; n++; return x + n; })",
      ),
    ).toEqual([]);
  });
});

describe("renderWriteMessage", () => {
  const [assign] = renderWrites("lantern.isLit = true");
  const [update] = renderWrites("player.fear++");
  if (!assign || !update) throw new Error("no writes found");

  it("suggests === for = in a condition", () => {
    expect(renderWriteMessage(assign, true)).toBe(
      "`lantern.isLit = true` sets a value instead of comparing. To compare, use `===`: `lantern.isLit === true`.",
    );
  });

  it("points other writes at an effect", () => {
    expect(renderWriteMessage(assign, false)).toBe(
      "Showing a passage can't change state, so `lantern.isLit = true` can't run here. Change it in an effect instead, like `{on enter: lantern.isLit = true}`.",
    );
    expect(renderWriteMessage(update, true)).toBe(
      "Showing a passage can't change state, so `player.fear++` can't run here. Change it in an effect instead, like `{on enter: player.fear++}`.",
    );
  });
});
