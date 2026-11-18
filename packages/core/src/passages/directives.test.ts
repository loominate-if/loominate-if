import { describe, expect, it } from "vitest";
import { continueTo, linkGuard } from "./directives.js";

describe("core's directive functions", () => {
  it("make continue points, with a label only when given", () => {
    expect(continueTo({ target: "Platform" })).toEqual({ type: "continue", target: "Platform" });
    expect(continueTo({ target: "Platform", label: "On" })).toEqual({
      type: "continue",
      target: "Platform",
      label: "On",
    });
  });

  it("make link guards, where a reason means disabled with it", () => {
    const condition = { value: false, text: "lantern.isLit" };
    expect(linkGuard({ condition })).toEqual({ open: false, condition: "lantern.isLit" });
    expect(linkGuard({ condition, mode: "hidden" })).toEqual({
      open: false,
      condition: "lantern.isLit",
      mode: "hidden",
    });
    expect(linkGuard({ condition: { ...condition, value: true }, reason: "Too dark." })).toEqual({
      open: true,
      condition: "lantern.isLit",
      mode: "disabled-with-reason",
      reason: "Too dark.",
    });
  });
});
