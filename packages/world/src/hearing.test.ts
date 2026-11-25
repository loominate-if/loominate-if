/** Who hears what (#143): everyone in earshot learns what's revealed; present(); asides. */
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
  ask,
  connect,
  defineFacts,
  hello,
  move,
  place,
  player,
  present,
  reveal,
  startAs,
  topic,
  topicBlock,
  topics,
} from "./index.js";

const study = place("study", { name: "study" });
const hall = place("hall", { name: "hall" });
connect(study, { west: hall });
connect(hall, { east: study });
const you = actor("you", { body: { name: "you", location: study } });
const maid = actor("maid", { body: { name: "Maid", location: study } });
const butler = actor("butler", { body: { name: "butler", location: study } });
const cook = actor("cook", { body: { name: "cook", location: study } });
startAs(you);
const { letter, secret } = topics({ letter: "the letter", secret: "the secret" });
const facts = defineFacts({
  butlerTookLetter: "The butler took the letter.",
  maidSawIt: "The maid saw it happen.",
});

// The design's maid and butler, as compiled blocks of an actor passage:
//   {ask letter, when: present(butler)}
//   She glances at the butler. "I wouldn't know, miss."
//
//   {ask letter, when: !present(butler)}
//   "He took it, miss. I saw him put it in his coat."
//   {reveal facts.butlerTookLetter}
const block = (id: string, text: string, enter?: () => void): Passage => ({
  id,
  tags: [],
  ...(enter && { effects: { enter } }),
  body: () => [{ type: "text", text }],
});
const maidPassage = { id: "Maid", directive: "ask", roles: { actor: maid } };
topicBlock(
  {
    about: letter,
    when: () => ({ value: present(butler), text: "present(butler)", parts: () => [] }),
  },
  block("Maid/1", "She glances at the butler. “I wouldn't know, miss.”"),
  maidPassage,
);
topicBlock(
  {
    about: letter,
    when: () => ({ value: !present(butler), text: "!present(butler)", parts: () => [] }),
  },
  block("Maid/2", "“He took it, miss. I saw him put it in his coat.”", () => {
    reveal({ fact: facts.butlerTookLetter });
  }),
  maidPassage,
);
// #region aside
topic(maid, {
  ask: secret,
  aside: true,
  reveals: facts.maidSawIt,
  says: "She leans close. “I saw it, miss. Don't tell.”",
});
// #endregion

const passages: Passage[] = [
  { id: "Study", tags: [], body: () => [{ type: "notices" }] },
  { id: "Hall", tags: [], body: () => [] },
];
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
const said = () => {
  const since = record.events({ kinds: ["action"] }).at(-1)?.seq ?? -1;
  return record
    .events({ kinds: ["action-result"] })
    .filter((e) => e.seq > since && !e.tags.includes("player"))
    .map((e) => e.text);
};

describe("who hears what (#143)", () => {
  it("lets the maid speak freely only when the butler isn't present (walkthrough)", () => {
    expect(present(butler)).toBe(true);
    act(ask({ who: maid, about: letter }));
    expect(said()).toEqual(["She glances at the butler. “I wouldn't know, miss.”"]);
    expect(player.knows(facts.butlerTookLetter)).toBe(false);
    // The butler steps out to the hall: out of earshot, so not present.
    move(butler, hall);
    expect(present(butler)).toBe(false);
    act(ask({ who: maid, about: letter }));
    expect(said()).toEqual(["“He took it, miss. I saw him put it in his coat.”"]);
    expect(player.knows(facts.butlerTookLetter)).toBe(true);
    // Everyone present hears it: the cook at the stove, though not in the conversation.
    expect([cook.knows(facts.butlerTookLetter), butler.knows(facts.butlerTookLetter)]).toEqual([
      true,
      false,
    ]);
  });

  it("keeps an aside between the player and the speaker", () => {
    act(hello({ who: maid }));
    act(ask({ who: maid, about: secret }));
    expect(player.knows(facts.maidSawIt)).toBe(true);
    expect([cook.knows(facts.maidSawIt), butler.knows(facts.maidSawIt)]).toEqual([false, false]);
    expect(record.events({ kinds: ["action-result"] }).at(-1)?.tags).toContain("aside");
  });
});
