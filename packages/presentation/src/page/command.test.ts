/** The command line's matching (#131): what's typed, against what's offered. */
import { action, createEventRecord, createStore, createStory, object } from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { _phrasesOf, _words, matchCommands, type Command } from "./command.js";

const command = (label: string, phrases?: string[]): Command => ({
  label,
  ...(phrases && { phrases }),
  run: () => undefined,
});
const labels = (typed: string, commands: Command[]) => {
  const { matches, sure } = matchCommands(typed, commands);
  return { matches: matches.map((c) => c.label), sure: sure?.label };
};

describe("command matching (#131)", () => {
  it("reads words without case, punctuation, or articles", () => {
    expect(_words("Ask about “the Weather”, please!")).toEqual([
      "ask",
      "about",
      "weather",
      "please",
    ]);
  });

  it("matches each typed word as the start of a word, in order, best first", () => {
    const all = [
      command("Signal the ship"),
      command("Ask about the ship"),
      command("Ask about the weather"),
      command("Down"),
    ];
    expect(labels("sig", all)).toEqual({ matches: ["Signal the ship"], sure: "Signal the ship" });
    // From the start beats in order: "ask ship" is both, but the first starts with ask.
    expect(labels("ask", all).matches).toEqual(["Ask about the ship", "Ask about the weather"]);
    expect(labels("ask", all).sure).toBeUndefined();
    expect(labels("ask weath", all)).toEqual({
      matches: ["Ask about the weather"],
      sure: "Ask about the weather",
    });
    expect(labels("ship", all).matches).toEqual(["Signal the ship", "Ask about the ship"]);
    expect(labels("climb", all).matches).toEqual([]);
    expect(labels("   ", all).matches).toEqual([]);
  });

  it("is sure of a command said exactly, even when others start the same", () => {
    const all = [command("Down"), command("Down the stairs")];
    expect(labels("the down", all).sure).toBe("Down");
    expect(labels("down", all).sure).toBe("Down");
    expect(labels("dow", all).sure).toBeUndefined();
  });

  it("matches a command by its phrases too", () => {
    const all = [command("Take the brass coin", ["take coin", "get coin", "pick up coin"])];
    expect(labels("pick up coin", all).sure).toBe("Take the brass coin");
    expect(labels("get", all).sure).toBe("Take the brass coin");
  });

  it("names an action's things in its verb phrases, with and without optional words", () => {
    const bell = object("command-bell", { name: "brass bell" });
    const ring = action<{ thing: typeof bell }>("command-ring", {
      on: bell,
      label: "Ring the bell",
      verbs: ["ring {thing}", "pull (on) {thing}"],
    });
    const store = createStore();
    createStory(store, createEventRecord(store), [{ id: "Hall", tags: [], body: () => [] }], {
      start: "Hall",
    }).begin();
    expect(_phrasesOf(ring({ thing: bell }))).toEqual([
      "ring brass bell",
      "pull brass bell",
      "pull on brass bell",
    ]);
  });
});
