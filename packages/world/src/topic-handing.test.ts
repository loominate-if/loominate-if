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
  actAs,
  actor,
  anything,
  clock,
  conversation,
  give,
  giving,
  hello,
  place,
  react,
  show,
  startAs,
  startClock,
  thing,
  topic,
  topicLinks,
  conversationMode,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const you = actor("you", { body: { name: "you", location: hall } });
const maid = actor("maid", { body: { name: "maid", location: hall } });
const butler = actor("butler", { body: { name: "butler", location: hall } });
const cook = actor("cook", { body: { name: "cook", location: hall } });
const locket = thing("locket", { name: "locket", location: you });
const photograph = thing("photograph", { name: "photograph", location: you });
const pebble = thing("pebble", { name: "pebble", location: you });
const seal = thing("seal", { name: "seal", location: you });
const pie = thing("pie", { name: "pie", location: cook });
startAs(you);
// These test {topics} in the passage, which conversation mode's layout lists instead (#118).
conversationMode(false);
startClock({ at: "09:00" });

// #region handing
topic(butler, {
  show: photograph,
  says: "He studies it a moment too long. “I couldn't say, sir.”",
});
topic(maid, { give: locket, takes: true, says: "“Oh! My mother's!”" });
topic(maid, { give: anything, says: "“I couldn't accept that, miss.”" });
// #endregion
// The game's own rule answers before any topic entry.
topic(butler, { give: seal, says: "“A seal, sir?”" });
giving.rule("the butler knows the seal", ({ thing: t, to }) =>
  t.id === "seal" && to.id === "butler" ? react("He pales. “Where did you find this?”") : undefined,
);

const passages: Passage[] = [{ id: "Hall", tags: [], body: () => topicLinks() }];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
});
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};
let seen = 0;
beforeEach(() => {
  seen = 0;
});
const said = () => {
  const all = record.events({ kinds: ["action-result"] });
  const out = all.slice(seen).map((e) => e.text);
  seen = all.length;
  return out;
};
const links = () => story.render().choices.map((c) => c.label);

describe("showing and giving through topics (#114)", () => {
  it("answer showing with a show entry, bringing the NPC into the conversation, a minute each", () => {
    const before = clock.minutes;
    act(show({ thing: photograph, to: butler }));
    expect(said()).toEqual(["He studies it a moment too long. “I couldn't say, sir.”"]);
    expect([conversation.addressee?.id, clock.minutes - before]).toEqual(["butler", 1]);
  });

  it("let the NPC take what they're given only when the entry says so", () => {
    act(give({ thing: locket, to: maid }));
    expect(locket.location?.id).toBe("maid");
    act(give({ thing: pebble, to: maid }));
    expect(said()).toEqual(["“Oh! My mother's!”", "“I couldn't accept that, miss.”"]);
    expect(pebble.location?.id).toBe("you");
  });

  it("let the game's own giving rules come first", () => {
    act(give({ thing: seal, to: butler }));
    expect(said()).toEqual(["He pales. “Where did you find this?”"]);
  });

  it("fall back to the default refusal with no entry, without starting a conversation", () => {
    act(show({ thing: pebble, to: cook }));
    expect(said()).toEqual(["The cook glances at the pebble."]);
    expect(conversation.active).toBe(false);
  });

  it("answer only the player, not NPCs handing things to each other", () => {
    actAs(cook, give({ thing: pie, to: maid }));
    expect(pie.location?.id).toBe("cook"); // the maid's catch-all would have answered the player
  });

  it("suggest showing and giving what the player carries, in {topics} (walkthrough)", () => {
    act(hello({ who: maid }));
    expect(links()).toEqual(["Give the locket", "Say goodbye"]);
    story.follow({ type: "link", label: "Give the locket", target: "Give the locket" });
    expect(locket.location?.id).toBe("maid");
    expect(links()).toEqual(["Say goodbye"]); // no longer carried
    act(hello({ who: butler }));
    // The seal too: the butler has an entry for it, though the game's own rule answers it.
    expect(links()).toEqual(["Show the photograph", "Give the seal", "Say goodbye"]);
  });

  it("give the same state for the same moves (determinism)", () => {
    act(show({ thing: photograph, to: butler }));
    act(give({ thing: locket, to: maid }));
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Hall" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
