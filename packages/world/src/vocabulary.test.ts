import { createEventRecord, createStore, createStory } from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { actor, place, thing, vocabOf } from "./index.js";

const hall = place("hall", { name: "hall" });
// #region vocab
export const lantern = thing("lantern", {
  name: "brass lantern",
  vocab: { nouns: ["lamp", "light"], adjectives: ["old"] },
  location: hall,
});
// #endregion
const mouse = thing("mouse", { name: "grey mouse", pluralName: "grey mice" });
const mira = actor("mira", { body: { name: "Mira", vocab: { nouns: ["woman"] } } });

beforeEach(() => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

describe("vocabulary", () => {
  it("comes from the name, and from what a thing gives", () => {
    // #region vocabOf
    expect(vocabOf(lantern)).toEqual({
      nouns: ["lantern", "lamp", "light"],
      adjectives: ["brass", "old"],
      plurals: ["lanterns"],
    });
    // #endregion
    expect(vocabOf(mouse).plurals).toEqual(["mice"]);
    expect(vocabOf(mira)).toEqual({ nouns: ["mira", "woman"], adjectives: [], plurals: [] });
    expect(vocabOf(hall).nouns).toEqual(["hall"]);
    // It's state, like the name, so it can change during play.
    lantern.vocab = { nouns: ["relic"], adjectives: [] };
    expect(vocabOf(lantern).nouns).toEqual(["lantern", "relic"]);
  });

  it("is checked as words", () => {
    // @ts-expect-error vocab's lists are of strings
    thing("bad", { name: "bad", vocab: { nouns: [3] } });
    const spaced = thing("spaced", { name: "box", vocab: { nouns: ["tin box"] } });
    expect(() => vocabOf(spaced)).toThrow('vocabOf "spaced": "tin box" isn\'t one word.');
  });
});
