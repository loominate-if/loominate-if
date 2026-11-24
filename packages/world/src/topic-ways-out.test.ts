import { createEventRecord, createStore, createStory } from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { actor, convNode, place, startAs, topic } from "./index.js";

const cell = place("cell", { name: "cell" });
const you = actor("you", { body: { name: "you", location: cell } });
const guard = actor("guard", { body: { name: "guard", location: cell } });
startAs(you);
// Every reply stays, so nothing closes it.
const interrogation = convNode(guard, "interrogation", { exit: "hard" });
topic(guard, { yes: true, in: interrogation, stays: true, says: "“Go on.”" });
// The game closes this one from code, so it's passed.
convNode(guard, "lecture", { exit: "hard", closedElsewhere: true });

describe("locked nodes need a way out (#117)", () => {
  it("stop the game starting, naming the node and how to fix it", () => {
    const store = createStore();
    const story = createStory(
      store,
      createEventRecord(store),
      [{ id: "Cell", tags: [], body: () => [] }],
      {
        start: "Cell",
      },
    );
    expect(() => {
      story.begin();
    }).toThrow(
      'convNode "interrogation" ("guard:mind") locks the conversation hard, but every reply it has stays, so the player could never leave.',
    );
  });
});
