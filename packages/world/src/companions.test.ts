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
  accompany,
  actor,
  companion,
  companionState,
  connect,
  enterRoom,
  exitLinks,
  place,
  placeOf,
  player,
  registerRoom,
  schedule,
  startAs,
  thing,
  waitHere,
  type Place,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const library = place("library", { name: "library" });
const vault = place("vault", { name: "vault" });
connect(hall, { north: library });
connect(library, { south: hall });
const you = actor("you", { body: { name: "you", location: hall } });
const mira = actor("mira", { body: { name: "Mira", location: hall } });
const tom = actor("tom", { body: { name: "Tom", location: hall } });
const cook = actor("cook", { body: { name: "cook", location: hall } });
const ledger = thing("ledger", { name: "ledger", location: library });
startAs(you);

// #region companions
companion(mira, { starts: "accompanying" });
companion(tom, { starts: "waiting" });
// #endregion
// Her timetable keeps her in the hall, but not while she's accompanying the player.
schedule(mira, [{ at: "00:00", in: hall }]);

const room = (id: string, r: Place, extra: Passage["body"] = () => []): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: (c) => [{ type: "text", text: `The ${r.id}.` }, ...extra(c), ...exitLinks()],
  };
};
const passages: Passage[] = [
  room("Hall", hall, () => [
    { type: "link", label: "Wait", target: "Hall" },
    { type: "link", label: "Fall into the vault", target: "Vault" },
  ]),
  room("Library", library),
  room("Vault", vault),
];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
});
const go = (label: string) => {
  const c = story.render().choices.find((x) => (x.label ?? "").startsWith(label));
  if (!c) throw new Error(`no ${label}`);
  story.follow(c);
};
let seen = 0;
const said = () => {
  const all = record.events({ kinds: ["action-result", "perception"] });
  const out = all.slice(seen).map((e) => e.text);
  seen = all.length;
  return out;
};
beforeEach(() => {
  seen = 0;
});

describe("companions (#121)", () => {
  it("go with the player when accompanying, told as a group, and not as arriving apart", () => {
    go("North");
    expect([placeOf(mira)?.id, placeOf(tom)?.id, placeOf(cook)?.id]).toEqual([
      "library",
      "hall",
      "hall",
    ]);
    go("South");
    go("North"); // her timetable didn't take her back to the hall meanwhile
    expect(placeOf(mira)?.id).toBe("library");
    expect(said()).toEqual([
      "You and Mira head north.",
      "You and Mira head south.",
      "You and Mira head north.",
    ]);
    expect(record.events({ kinds: ["action-result"] }).at(-1)?.tags).toContain("lead");
  });

  it("tell several together, and one who's told to come along", () => {
    accompany(tom);
    expect(said()).toEqual(["Tom comes along."]);
    go("North");
    expect(said()).toEqual(["You, Mira, and Tom head north."]);
    expect(companionState(tom)).toBe("accompanying");
  });

  it("stay put when waiting, and don't follow from another room", () => {
    waitHere(mira);
    expect(said()).toEqual(["Mira waits here."]);
    go("North");
    expect([placeOf(mira)?.id, said()]).toEqual(["hall", []]);
    accompany(mira); // she's in the hall, the player in the library: no jump
    go("South");
    go("North");
    expect(placeOf(mira)?.id).toBe("library");
  });

  it("come along on a jump with no exit", () => {
    go("Fall into the vault");
    expect([placeOf(mira)?.id, said()]).toEqual(["vault", ["Mira comes with you."]]);
  });

  it("see what's where they go, as their own knowledge", () => {
    go("North");
    expect(mira.hasSeen(ledger)).toBe(true);
    expect(player.hasSeen(ledger)).toBe(true);
  });

  it("can't be made in play, or directed if they aren't companions", () => {
    expect(() => companion(cook)).toThrow("make companions in story.ts");
    expect(() => waitHere(cook)).toThrow("isn't a companion");
    expect(companionState(cook)).toBeUndefined();
  });

  it("give the same state for the same moves (determinism)", () => {
    go("North");
    go("South");
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Hall" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
