/** Reactions and scripted exchanges (#142): others react to an exchange, up to a cap; NPCs trade lines. */
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
import { storyLog } from "@loominate-if/presentation";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _cast,
  actor,
  ask,
  continueExchange,
  exchange,
  exchangePlaying,
  hello,
  joinConversation,
  leaveConversation,
  place,
  playExchange,
  startAs,
  suggestedTopics,
  topic,
  topicBlock,
  topics,
} from "./index.js";

const study = place("study", { name: "study" });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: study } });
const maid = actor("maid", { body: { name: "maid", location: study } });
const cook = actor("cook", { body: { name: "cook", location: study } });
startAs(you);
const { letter, silver, theft, ghost, garden } = topics({
  garden: "the garden",
  letter: "the letter",
  silver: "the silver",
  theft: "the theft",
  ghost: "the ghost",
});
// #region reactions
topic(butler, { ask: letter, says: "“I couldn't say, sir.”" });
topic(maid, { reacts: { ask: letter }, says: "The maid goes pale." });
topic(cook, { reacts: { ask: letter }, priority: 5, says: "The cook snorts." });
// #endregion
topic(butler, { ask: silver, reactions: 2, says: "“Polished daily, sir.”" });
topic(maid, { reacts: { ask: silver }, says: "The maid nods." });
topic(cook, { reacts: { ask: silver }, says: "The cook rolls her eyes." });
topic(butler, { ask: ghost, reactions: 0, says: "“There's no such thing, sir.”" });
topic(maid, { reacts: { ask: ghost }, says: "The maid shivers." });
// #region exchange
exchange("argument", [
  [butler, "“You took it. I saw you.”"],
  [maid, "“I never! Ask Cook.”"],
  [cook, "“Don't drag me into this.”"],
]);
topic(butler, { ask: theft, then: "argument", says: "“Ask her yourself, sir.”" });
// #endregion

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
/** What was said in the last move. */
const said = () => {
  const since = record.events({ kinds: ["action"] }).at(-1)?.seq ?? -1;
  return record
    .events({ kinds: ["action-result"] })
    .filter((e) => e.seq > since && !e.tags.includes("player"))
    .map((e) => e.text);
};
const everyone = () => {
  act(hello({ who: butler }));
  joinConversation(maid);
  joinConversation(cook);
};

describe("reactions (#142)", () => {
  it("follow an answer, the highest priority first, one an exchange by default", () => {
    everyone();
    act(ask({ who: butler, about: letter }));
    expect(said()).toEqual(["“I couldn't say, sir.”", "The cook snorts."]);
  });

  it("are as many as the answering entry allows, by the order they're in the conversation", () => {
    everyone();
    act(ask({ who: butler, about: silver }));
    expect(said()).toEqual([
      "“Polished daily, sir.”",
      "The maid nods.",
      "The cook rolls her eyes.",
    ]);
    act(ask({ who: butler, about: ghost }));
    expect(said()).toEqual(["“There's no such thing, sir.”"]);
  });

  it("show who spoke last in the cast", () => {
    everyone();
    act(ask({ who: butler, about: letter }));
    expect(_cast(record).map((m) => [m.id, m.speaking === true])).toEqual([
      ["butler", false],
      ["maid", false],
      ["cook", true],
    ]);
  });

  it("come only from others in the conversation", () => {
    everyone();
    leaveConversation(cook);
    act(ask({ who: butler, about: letter }));
    expect(said()).toEqual(["“I couldn't say, sir.”", "The maid goes pale."]);
  });

  it("can be blocks in an actor passage, as {reacts ask letter}", () => {
    const block: Passage = {
      id: "Butler/reacts-letter",
      tags: [],
      body: () => [{ type: "text", text: "The butler stiffens." }],
    };
    topic(maid, { ask: garden, says: "“Lovely this time of year.”" });
    topicBlock({ about: garden }, block, {
      id: "Butler",
      directive: "reacts ask",
      roles: { actor: butler },
    });
    everyone();
    act(ask({ who: maid, about: garden }));
    expect(said()).toEqual(["“Lovely this time of year.”", "The butler stiffens."]);
  });
});

describe("scripted exchanges (#142)", () => {
  it("play after an answer, a line each time the player continues, each by its speaker", () => {
    everyone();
    act(ask({ who: butler, about: theft }));
    expect(said()).toEqual(["“Ask her yourself, sir.”", "“You took it. I saw you.”"]);
    expect(exchangePlaying()).toBe("argument");
    // While it plays, the only topic is Continue.
    expect(suggestedTopics().map((t) => t.label)).toEqual(["Continue"]);
    act(continueExchange({}));
    expect(said()).toEqual(["“I never! Ask Cook.”"]);
    act(continueExchange({}));
    expect(said()).toEqual(["“Don't drag me into this.”"]);
    expect(exchangePlaying()).toBeUndefined();
    expect(suggestedTopics().map((t) => t.label)).not.toContain("Continue");
    // The story log reads each line as its speaker's.
    expect(
      storyLog(record.events())
        .filter((e) => e.text.startsWith("“I never") || e.text.startsWith("“Don't"))
        .map((e) => e.speaker),
    ).toEqual(["Maid", "Cook"]);
  });

  it("are played in a conversation, from code too", () => {
    expect(() => {
      playExchange("argument");
    }).toThrow("none is going on");
    everyone();
    playExchange("argument");
    expect(exchangePlaying()).toBe("argument");
    expect(() => {
      playExchange("nonsense");
    }).toThrow("no exchange called");
  });
});
