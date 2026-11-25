/** Group topics (#141): asking or telling everyone in a conversation at once. */
import {
  createEventRecord,
  createStore,
  createStory,
  type ActionCall,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  address,
  askEveryone,
  convNode,
  defineFacts,
  groupTopic,
  hello,
  joinConversation,
  openNode,
  place,
  player,
  startAs,
  suggestedTopics,
  topic,
  topics,
} from "./index.js";

const study = place("study", { name: "study" });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: study } });
const maid = actor("maid", { body: { name: "maid", location: study } });
startAs(you);
const { storm, letter } = topics({ storm: "the storm", letter: "the letter" });
const facts = defineFacts({ burned: "The letter was burned in the grate." });
topic(butler, { ask: letter, says: "“I couldn't say, sir.”" });
// #region group
groupTopic({ ask: storm, says: "They all start talking at once about the river." });
groupTopic({
  ask: letter,
  speaker: maid,
  reveals: facts.burned,
  says: "The maid glances at the butler. “It went in the grate, sir.”",
});
// #endregion
const question = convNode(butler, "question", { restricts: true });

const passages: Passage[] = [{ id: "Study", tags: [], body: () => [] }];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Study" });
  story.begin();
});
const act = (call: unknown) => {
  story.act(call as ActionCall);
};
const labels = () => suggestedTopics().map((t) => t.label);
const said = () =>
  record
    .events({ kinds: ["action-result"] })
    .map((e) => [e.text, e.tags.find((t) => t.startsWith("speaker:"))]);

describe("group topics (#141)", () => {
  it("aren't offered to one person, only to a group", () => {
    act(hello({ who: butler }));
    expect(labels()).not.toContain("Ask everyone about the storm");
    expect(() => {
      act(askEveryone({ about: storm }));
    }).toThrow("only one is in the conversation");
  });

  it("are offered whoever is addressed, and answer for the group", () => {
    act(hello({ who: butler }));
    joinConversation(maid);
    expect(labels()).toEqual(
      expect.arrayContaining(["Ask everyone about the storm", "Ask everyone about the letter"]),
    );
    address(maid);
    expect(labels()).toContain("Ask everyone about the storm");
    act(askEveryone({ about: storm }));
    expect(said().slice(-2)).toEqual([
      ["You ask everyone about the storm.", "speaker:you"],
      ["They all start talking at once about the river.", undefined],
    ]);
  });

  it("can speak through one of them, and teach everyone in it what's revealed", () => {
    act(hello({ who: butler }));
    joinConversation(maid);
    act(askEveryone({ about: letter }));
    expect(said().at(-1)).toEqual([
      "The maid glances at the butler. “It went in the grate, sir.”",
      "speaker:maid",
    ]);
    expect([
      player.knows(facts.burned),
      butler.knows(facts.burned),
      maid.knows(facts.burned),
    ]).toEqual([true, true, true]);
    expect(player.sourceOf(facts.burned)?.from?.id).toBe("maid");
  });

  it("aren't offered while a restrictive node holds the floor", () => {
    act(hello({ who: butler }));
    joinConversation(maid);
    openNode(butler, question);
    expect(labels()).not.toContain("Ask everyone about the storm");
  });
});
