import {
  createEventRecord,
  createStore,
  createStory,
  statusOf,
  type ActionCall,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  anything,
  ask,
  defineFacts,
  hello,
  joinConversation,
  place,
  player,
  startAs,
  suggestedTopics,
  tell,
  thing,
  topic,
  topicLinks,
  topics,
} from "./index.js";

const kitchen = place("kitchen", { name: "kitchen" });
const you = actor("you", { body: { name: "you", location: kitchen } });
const maid = actor("maid", { body: { name: "maid", location: kitchen } });
const cook = actor("cook", { body: { name: "cook", location: kitchen } });
const gold = thing("gold", { name: "gold", location: kitchen, isFamiliar: true });
const ledger = thing("ledger", { name: "ledger", location: kitchen });
startAs(you);

// #region knowledge
const facts = defineFacts({
  butlerTookLetter: { text: "The butler took the letter.", name: "the butler and the letter" },
  goldMissing: { text: "The gold is missing.", name: "the missing gold" },
});
const { weather, affair } = topics({
  weather: "the weather",
  affair: { name: "the affair", known: false },
});

topic(maid, { ask: gold, says: "“In the vault, miss.”" });
topic(maid, {
  ask: weather,
  says: "“Cold, miss. And I saw the butler with a letter.”",
  reveals: facts.butlerTookLetter,
});
topic(maid, { ask: affair, says: "“Hush, miss!”" });
topic(maid, { ask: facts.butlerTookLetter, says: "“I'll say no more, miss.”" });
topic(maid, { tell: facts.goldMissing, says: "“Missing? Oh, miss!”" });
topic(maid, { ask: ledger, suggested: false, says: "“The ledger? Cook keeps it.”" });
topic(maid, { askOrTell: anything, says: "“I wouldn't know, miss.”" });
// #endregion
topic(cook, { tell: facts.goldMissing, informs: false, says: "“Nonsense.”" });

const passages: Passage[] = [
  {
    id: "Kitchen",
    tags: [],
    body: () => [{ type: "link", label: "Talk to the maid", target: "Talk" }, ...topicLinks()],
  },
  {
    id: "Talk",
    tags: [],
    effects: { enter: () => undefined },
    body: () => [{ type: "link", label: "Back", target: "Kitchen" }],
  },
];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Kitchen" });
  story.begin();
});
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};
const labels = () => suggestedTopics().map((s) => s.label);
const links = () =>
  story
    .render()
    .choices.filter((c) => c.label !== "Talk to the maid")
    .map((c) => c.label);
const said = () => record.events({ kinds: ["action-result"] }).map((e) => e.text);

describe("topic suggestions and knowledge (#113)", () => {
  it("suggest nothing until the player is talking to someone", () => {
    expect(labels()).toEqual([]);
  });

  it("suggest the subjects the player knows that the addressee answers, then goodbye", () => {
    act(hello({ who: maid }));
    // Not the ledger (suggested: false), the affair (not known), the fact (not known), or the catch-all.
    expect(labels()).toEqual(["Ask about the gold", "Ask about the weather", "Say goodbye"]);
  });

  it("suggest a topic once the player learns of it, and a fact once they know it", () => {
    act(hello({ who: maid }));
    player.learnAbout(affair);
    player.learn(facts.goldMissing);
    expect(labels()).toEqual([
      "Ask about the gold",
      "Ask about the weather",
      "Ask about the affair",
      "Tell about the missing gold",
      "Say goodbye",
    ]);
  });

  it("reveal facts to the player, and to everyone else in the conversation", () => {
    act(hello({ who: maid }));
    joinConversation(cook);
    act(ask({ who: maid, about: weather }));
    expect(player.knows(facts.butlerTookLetter)).toBe(true);
    expect(player.sourceOf(facts.butlerTookLetter)?.from?.id).toBe("maid");
    expect(cook.knows(facts.butlerTookLetter)).toBe(true);
    // Now known, it's suggested.
    expect(labels()).toContain("Ask about the butler and the letter");
  });

  it("inform an NPC of a fact the player tells them, unless the entry says not", () => {
    player.learn(facts.goldMissing);
    act(tell({ who: maid, about: facts.goldMissing.id }));
    expect(maid.knows(facts.goldMissing)).toBe(true);
    expect(maid.sourceOf(facts.goldMissing)?.from?.id).toBe("you");
    act(tell({ who: cook, about: facts.goldMissing.id }));
    expect(cook.knows(facts.goldMissing)).toBe(false);
  });

  it("don't let the player ask or tell about a fact they don't know", () => {
    expect(statusOf(ask({ who: maid, about: facts.butlerTookLetter.id })).hidden).toBe(
      "You don't know anything about that.",
    );
  });

  it("offer the suggestions as links with {topics}, which take their actions (walkthrough)", () => {
    expect(links()).toEqual([]);
    act(hello({ who: maid }));
    expect(links()).toEqual(["Ask about the gold", "Ask about the weather", "Say goodbye"]);
    story.follow({ type: "link", label: "Ask about the weather", target: "Ask about the weather" });
    expect(said().at(-1)).toBe("“Cold, miss. And I saw the butler with a letter.”");
    expect(links()).toContain("Ask about the butler and the letter");
    story.follow({ type: "link", label: "Say goodbye", target: "Say goodbye" });
    expect(links()).toEqual([]);
  });

  it("give the same state for the same moves (determinism)", () => {
    act(hello({ who: maid }));
    story.follow({ type: "link", label: "Ask about the weather", target: "Ask about the weather" });
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Kitchen" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
