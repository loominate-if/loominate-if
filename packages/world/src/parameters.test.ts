import { messageParameters } from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import extension from "./extension.js";
import "./index.js";
import { KNOWN_VERBS, PARAMETER_NAMES } from "./parameters.js";

describe("the world model's message parameter names (#235)", () => {
  it("are what it registers, and what its compiler extension declares", () => {
    const registered = messageParameters
      .entries()
      .filter((e) => e.source === "@loominate-if/world" || e.source === "game")
      .map((e) => e.key)
      .sort();
    expect(registered).toEqual([...PARAMETER_NAMES].sort());
    expect([...extension.messageParameters.names].sort()).toEqual([...PARAMETER_NAMES].sort());
    expect(extension.messageParameters.fallback.words).toEqual(KNOWN_VERBS);
  });
});
