/** Joining and leaving mid-conversation (#144): narrated, the cast and topics following, locks going with their owners. */
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
  _cast,
  actor,
  address,
  connect,
  conversation,
  convNode,
  enterRoom,
  goodbye,
  hello,
  joinConversation,
  leaveConversation,
  lockConversation,
  move,
  openNode,
  place,
  registerRoom,
  startAs,
  suggestedTopics,
  topic,
  topics,
  type Place,
} from "./index.js";

const study = place("study", { name: "study" });
const hall = place("hall", { name: "hall" });
connect(study, { west: hall });
connect(hall, { east: study });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: study } });
const maid = actor("maid", { body: { name: "maid", location: study } });
const cook = actor("cook", { body: { name: "cook", location: hall } });
startAs(you);
const { soup, letter } = topics({ soup: "the soup", letter: "the letter" });
topic(cook, { ask: soup, says: "“Leek and potato.”" });
topic(butler, { ask: letter, says: "“On the desk, sir.”" });
topic(maid, { bye: true, implicit: true, says: "The maid hurries off." });
const ultimatum = convNode(cook, "ultimatum", { exit: "hard", closedElsewhere: true });

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "link", label: "Wait", target: id }],
  };
};
const passages = [room("Study", study), room("Hall", hall)];
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
const wait = () => {
  story.follow({ type: "link", label: "Wait", target: "Study" });
};
const cast = () => _cast(record).map((m) => m.id);
const told = () => {
  const since = record.events({ kinds: ["action", "navigation"] }).at(-1)?.seq ?? -1;
  return record
    .events({ kinds: ["perception", "action-result"] })
    .filter((e) => e.seq > since)
    .map((e) => e.text);
};

describe("joining and leaving mid-conversation (#144)", () => {
  it("lets an arrival overhear without joining, until they're brought in, narrated", () => {
    act(hello({ who: butler }));
    move(cook, study);
    wait();
    // In the room, but not in the conversation, until something brings her in.
    expect(cast()).toEqual(["butler"]);
    joinConversation(cook);
    expect(record.events({ kinds: ["perception"] }).at(-1)?.text).toBe(
      "The cook joins the conversation.",
    );
    expect(cast()).toEqual(["butler", "cook"]);
    // The menu follows: the cook's topics once she's addressed.
    address(cook);
    expect(suggestedTopics().map((t) => t.label)).toContain("Ask about the soup");
  });

  it("doesn't narrate joining for the player's own greeting, which says it", () => {
    act(hello({ who: butler }));
    act(hello({ who: maid }));
    expect(told()).toEqual(["You greet the maid.", "The maid nods to you."]);
    expect(cast()).toEqual(["butler", "maid"]);
  });

  it("narrates someone stepping away while still in the room, and moves who's addressed on", () => {
    act(hello({ who: butler }));
    act(hello({ who: maid }));
    expect(conversation.addressee?.id).toBe("maid");
    leaveConversation(maid);
    expect(record.events({ kinds: ["perception"] }).at(-1)?.text).toBe(
      "The maid steps away from the conversation.",
    );
    expect([cast(), conversation.addressee?.id]).toEqual([["butler"], "butler"]);
  });

  it("lets someone who walks off leave with their goodbye and the locks they hold", () => {
    act(hello({ who: butler }));
    act(hello({ who: maid }));
    lockConversation({ by: maid, level: "soft" });
    expect(conversation.exit).toBe("soft");
    move(maid, hall);
    wait();
    expect(told()).toContain("The maid hurries off.");
    expect([cast(), conversation.exit]).toEqual([["butler"], "free"]);
  });

  it("frees the player when the owner of a hard lock leaves", () => {
    act(hello({ who: butler }));
    move(cook, study);
    act(hello({ who: cook }));
    openNode(cook, ultimatum);
    expect(statusOf(goodbye({}) as unknown as ActionCall).disabled).toBeDefined();
    move(cook, hall);
    wait();
    expect([cast(), conversation.exit]).toEqual([["butler"], "free"]);
    expect(statusOf(goodbye({}) as unknown as ActionCall).disabled).toBeUndefined();
  });

  it("records who joined and left, for the transcript", () => {
    act(hello({ who: butler }));
    act(hello({ who: maid }));
    leaveConversation(maid);
    expect(record.events({ kinds: ["conversation"] }).map((e) => [e.event, e.with.join()])).toEqual(
      [
        ["started", "butler:mind"],
        ["joined", "maid:mind"],
        ["left", "maid:mind"],
      ],
    );
  });
});
