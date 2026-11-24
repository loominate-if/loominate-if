import {
  createEventRecord,
  createStore,
  createStory,
  storylet,
  storyletsIn,
  storyletStatus,
  type Passage,
} from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { clock, days, startClock } from "./index.js";

startClock({ at: "18:00" });
// #region cooldown
storylet("Market day", { deck: "mornings", cooldown: days(7) }); // once a week, by the clock
// #endregion

const passages: Passage[] = [
  { id: "Home", tags: [], body: () => [] },
  { id: "Market day", tags: [], body: () => [] },
];

describe("storylets with the world model", () => {
  it("can rest for a while by the game clock", () => {
    const store = createStore();
    const story = createStory(store, createEventRecord(store), passages, { start: "Home" });
    story.begin();
    story.goTo("Market day");
    story.goTo("Home");
    expect(storyletsIn("mornings")).toEqual([]);
    clock.advance(6 * 24 * 60 - 90);
    expect(storyletStatus()[0]?.reason).toBe("It's resting: 1 day, 1 hour and 30 minutes more.");
    clock.advance(24 * 60 + 90);
    expect(storyletsIn("mornings")).toEqual(["Market day"]);
  });
});
