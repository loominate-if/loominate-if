import {
  createEventRecord,
  createStore,
  createStory,
  storylet,
  type Passage,
} from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { storyletExplainer } from "./explainers.js";
import type { PanelContext } from "./panels.js";

const weather = { raining: false };
storylet("Rainy visit", {
  when: { "it's raining": () => weather.raining },
  priority: 2,
  deck: "evenings",
});
storylet("Card game", { deck: "evenings", once: true });
storylet("Letter");

const passages: Passage[] = ["Home", "Rainy visit", "Card game", "Letter"].map((id) => ({
  id,
  tags: [],
  body: () => [{ type: "link", label: "Home", target: "Home" }],
}));

describe("the storylet explainer (#97)", () => {
  it("lists every storylet: its deck, priority, and place, or why it isn't eligible", () => {
    const store = createStore();
    const story = createStory(store, createEventRecord(store), passages, { start: "Home" });
    story.begin();
    story.goTo("Card game");
    const explained = storyletExplainer.explain({} as PanelContext);
    expect(explained).toEqual([
      {
        label: "Rainy visit (deck evenings, priority 2)",
        available: false,
        shown: "hidden",
        why: "Not while these don't hold:",
        parts: [{ text: "it's raining", value: "false" }],
      },
      {
        label: "Card game (deck evenings, priority 0, seen 1×)",
        available: false,
        shown: "hidden",
        why: "It's once only, and it's been seen.",
      },
      { label: "Letter (no deck, priority 0, 1st in order)", available: true },
    ]);
    weather.raining = true;
    expect(storyletExplainer.explain({} as PanelContext)[0]).toEqual({
      label: "Rainy visit (deck evenings, priority 2, 1st in order)",
      available: true,
    });
  });
});
