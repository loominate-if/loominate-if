/** approach with comes (#389): an NPC walks to the player and speaks on the turn they arrive. */
import {
  createEventRecord,
  createStore,
  createStory,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  agenda,
  approach,
  connect,
  conversation,
  enterRoom,
  place,
  placeOf,
  registerRoom,
  startAs,
  type Place,
} from "./index.js";

const kitchen = place("kitchen", { name: "kitchen" });
const hall = place("hall", { name: "hall" });
const study = place("study", { name: "study" });
connect(kitchen, { east: hall });
connect(hall, { west: kitchen, east: study });
connect(study, { west: hall });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: kitchen } });
const maid = actor("maid", { body: { name: "maid", location: kitchen } });
startAs(you);
// #region comes
agenda(butler, "announce dinner", {
  act: ({ npc, done }) => {
    if (approach(npc, { says: "“Dinner is served, sir.”", comes: true })) done();
  },
});
// #endregion
// Without comes, she only speaks if she's already there, and doesn't move.
agenda(maid, "ask about tea", {
  act: ({ npc, done }) => {
    if (approach(npc, { says: "“Tea, sir?”" })) done();
  },
});

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "link", label: "Wait", target: id }],
  };
};
const passages = [room("Kitchen", kitchen), room("Hall", hall), room("Study", study)];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Study" });
  story.begin();
});
const wait = () => {
  story.follow({ type: "link", label: "Wait", target: "Study" });
};
/** What was told in the last move. */
const told = () => {
  const since = record.events({ kinds: ["navigation"] }).at(-1)?.seq ?? -1;
  return record
    .events({ kinds: ["action-result", "perception"] })
    .filter((e) => e.seq > since)
    .map((e) => e.text);
};

describe("approach, with comes (#389)", () => {
  it("walks the NPC to the player, a step a turn, and speaks the turn they arrive", () => {
    wait();
    expect([placeOf(butler)?.id, conversation.active]).toEqual(["hall", false]);
    wait();
    expect(placeOf(butler)?.id).toBe("study");
    expect(told()).toEqual(["The butler arrives from the west.", "“Dinner is served, sir.”"]);
    expect(conversation.addressee?.id).toBe("butler");
  });

  it("without it, leaves an NPC who isn't with the player where they are", () => {
    wait();
    wait();
    expect(told()).not.toContain("“Tea, sir?”");
    expect(placeOf(maid)?.id).toBe("kitchen");
  });
});
