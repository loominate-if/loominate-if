import { describe, expect, it } from "vitest";
import { object } from "../objects/objects.js";
import { action } from "./actions.js";
import { parseVerbPhrase } from "./verbs.js";

const door = object("verbs-door", { name: "door" });
const key = object("verbs-key", { name: "key" });

describe("verb phrases (#79)", () => {
  it("are read into words, slots by role, and optional words", () => {
    // #region verbs
    const unlock = action<{ thing: typeof door; tool: typeof key }>("verbs-unlock", {
      on: door,
      with: { tool: key },
      verbs: [
        "unlock {thing} with {tool}",
        "use {tool} on {thing}",
        "Turn (the) {tool} in {thing}",
      ],
    });
    // #endregion
    expect(unlock.verbs.map((v) => v.text)).toEqual([
      "unlock {thing} with {tool}",
      "use {tool} on {thing}",
      "Turn (the) {tool} in {thing}",
    ]);
    expect(unlock.verbs[2]?.parts).toEqual([
      { kind: "word", word: "turn" },
      { kind: "optional", words: ["the"] },
      { kind: "slot", role: "tool" },
      { kind: "word", word: "in" },
      { kind: "slot", role: "thing" },
    ]);
    expect(action("verbs-wave", {}).verbs).toEqual([]);
  });

  it("must match their braces and parentheses, as the game loads", () => {
    expect(() => action("verbs-bad", { verbs: ["unlock {thing"] })).toThrow(
      'action "verbs-bad": verb phrase "unlock {thing": its "{" has no partner.',
    );
    expect(() => parseVerbPhrase("take {thing")).toThrow('its "{" has no partner');
    expect(() => parseVerbPhrase("pick (up {thing}")).toThrow('its "(" has no partner');
    expect(() => parseVerbPhrase("{thing}")).toThrow("it needs a word to start from");
    expect(() => parseVerbPhrase("take {}")).toThrow("a slot names one of the action's things");
  });
});
