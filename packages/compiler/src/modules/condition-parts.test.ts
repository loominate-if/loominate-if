import { describe, expect, it } from "vitest";
import { conditionParts } from "./condition-parts.js";

describe("conditionParts", () => {
  it("splits at logical operators, not, and parentheses", () => {
    expect(conditionParts("lamp.lit && !night.signalled")).toEqual(["lamp.lit", "night.signalled"]);
    expect(conditionParts("(a || b.c) && !(d ?? e)")).toEqual(["a", "b.c", "d", "e"]);
    expect(conditionParts('visited("Stairs")')).toEqual(['visited("Stairs")']);
  });

  it("keeps a comparison whole, and adds its sides that aren't literals", () => {
    expect(conditionParts("visits > 2")).toEqual(["visits > 2", "visits"]);
    expect(conditionParts("lamp.oil === keeper.need")).toEqual([
      "lamp.oil === keeper.need",
      "lamp.oil",
      "keeper.need",
    ]);
    expect(conditionParts('night.ship !== ""')).toEqual(['night.ship !== ""', "night.ship"]);
  });

  it("goes into each branch of a conditional", () => {
    expect(conditionParts("hard ? lamp.oil > 1 : lamp.lit")).toEqual([
      "hard",
      "lamp.oil > 1",
      "lamp.oil",
      "lamp.lit",
    ]);
  });

  it("lists each part once, and leaves literals out", () => {
    expect(conditionParts("a && (a || true) && !false")).toEqual(["a"]);
    expect(conditionParts("true")).toEqual([]);
  });

  it("gives no parts for code that doesn't parse, or a part across lines", () => {
    expect(conditionParts("a &&")).toEqual([]);
    expect(conditionParts("a); b(")).toEqual([]);
    expect(conditionParts("a &&\nb.\nc")).toEqual(["a"]);
  });
});
