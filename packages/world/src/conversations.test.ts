import {
  createEventRecord,
  createStore,
  createStory,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  address,
  connect,
  conversation,
  endConversation,
  inConversationWith,
  joinConversation,
  leaveConversation,
  lockConversation,
  move,
  place,
  startAs,
  startConversation,
  unlockConversation,
} from "./index.js";

const parlour = place("parlour", { name: "parlour" });
const hall = place("hall", { name: "hall" });
connect(parlour, { east: hall });
connect(hall, { west: parlour });
const you = actor("you", { body: { name: "you", location: parlour } });
const butler = actor("butler", { body: { name: "butler", location: parlour } });
const maid = actor("maid", { body: { name: "maid", location: parlour } });
const cook = actor("cook", { body: { name: "cook", location: parlour } });
startAs(you);

const link = (label: string, target: string) => ({ type: "link" as const, label, target });
const passages: Passage[] = [
  {
    id: "Parlour",
    tags: [],
    body: () => [
      link("Talk to them", "Talk"),
      link("Wait", "Parlour"),
      link("The maid goes", "Maid goes"),
      link("East", "Hall"),
    ],
  },
  {
    id: "Talk",
    tags: [],
    effects: { enter: () => startConversation([butler, maid]) },
    body: () => [link("Wait", "Parlour")],
  },
  {
    id: "Maid goes",
    tags: [],
    effects: { enter: () => move(maid, hall) },
    body: () => [link("Wait", "Parlour")],
  },
  {
    id: "Hall",
    tags: [],
    effects: { enter: () => move(you, hall) },
    body: () => [link("West", "Parlour")],
  },
];

let store: StateStore;
let story: Story;
beforeEach(() => {
  store = createStore();
  story = createStory(store, createEventRecord(store), passages, { start: "Parlour" });
  story.begin();
});
const targets: Record<string, string> = {
  "Talk to them": "Talk",
  Wait: "Parlour",
  "The maid goes": "Maid goes",
  East: "Hall",
};
const choose = (label: string) => {
  story.follow(link(label, targets[label] ?? label));
};
const ids = () => conversation.participants.map((p) => p.id);

describe("conversations (#110)", () => {
  it("are one-on-one as a group of one", () => {
    expect(conversation.active).toBe(false);
    startConversation(butler);
    expect([conversation.active, ids(), conversation.addressee?.id, conversation.exit]).toEqual([
      true,
      ["butler"],
      "butler",
      "free",
    ]);
    expect(inConversationWith(butler)).toBe(true);
    expect(inConversationWith(maid)).toBe(false);
    endConversation();
    expect([conversation.active, conversation.addressee]).toEqual([false, undefined]);
  });

  it("hold any number of NPCs, one addressed, who can join and leave", () => {
    // #region group
    startConversation([butler, maid]); // the butler is addressed first
    address(maid);
    joinConversation(cook);
    leaveConversation(maid);
    // #endregion
    joinConversation(maid);
    address(maid);
    expect([ids(), conversation.addressee?.id]).toEqual([["butler", "cook", "maid"], "maid"]);
    leaveConversation(maid); // the addressee leaves: the first left is addressed
    expect([ids(), conversation.addressee?.id]).toEqual([["butler", "cook"], "butler"]);
    leaveConversation(butler);
    leaveConversation(cook); // no one left: it ends
    expect(conversation.active).toBe(false);
  });

  it("take the strictest lock, each owner holding one, and drop a leaver's", () => {
    startConversation([butler, maid]);
    // #region lock
    lockConversation({ by: butler, level: "soft", reason: "He hasn't finished." });
    lockConversation({ by: "accusation", level: "hard" }); // a conversation node's
    // #endregion
    expect(conversation.exit).toBe("hard");
    unlockConversation("accusation");
    expect(conversation.exit).toBe("soft");
    lockConversation({ by: "accusation", level: "hard" });
    expect(conversation.exit).toBe("hard");
    lockConversation({ by: butler, level: "hard" }); // replaces his soft lock
    unlockConversation("accusation");
    expect(conversation.locks).toEqual([{ by: "butler:mind", level: "hard" }]);
    leaveConversation(butler);
    expect([conversation.locks, conversation.exit]).toEqual([[], "free"]);
  });

  it("let a participant who's no longer with the player leave, after the move", () => {
    choose("Talk to them");
    choose("Wait");
    expect(ids()).toEqual(["butler", "maid"]);
    choose("The maid goes");
    expect(ids()).toEqual(["butler"]);
    choose("Wait");
    choose("East"); // the player leaves: no one's left, so it ends
    expect(conversation.active).toBe(false);
  });

  it("end when the player leaves, even locked", () => {
    choose("Talk to them");
    lockConversation({ by: butler, level: "hard" });
    choose("Wait");
    choose("East");
    expect([conversation.active, conversation.locks]).toEqual([false, []]);
  });

  it("are kept by undo's snapshots and replays (determinism)", () => {
    choose("Talk to them");
    const snapshot = store.snapshot();
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Parlour" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(snapshot);
  });

  it("say what's wrong", () => {
    expect(() => startConversation(you)).toThrow("that's the player");
    expect(() => joinConversation(cook)).toThrow("there's no conversation");
    expect(() => lockConversation({ by: butler, level: "soft" })).toThrow(
      "no conversation to lock",
    );
    startConversation(butler);
    expect(() => startConversation(maid)).toThrow("already in a conversation");
    expect(() => address(maid)).toThrow("isn't in the conversation");
    expect(() => lockConversation({ by: maid, level: "soft" })).toThrow(
      "isn't in the conversation",
    );
  });
});
