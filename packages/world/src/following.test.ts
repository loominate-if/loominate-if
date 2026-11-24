import {
  statusOf,
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
  actAs,
  actor,
  clock,
  companion,
  connect,
  door,
  enterRoom,
  everyTurn,
  exitLinks,
  follow,
  go,
  lockable,
  place,
  placeOf,
  registerRoom,
  startAs,
  thing,
  type Place,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const pantry = place("pantry", { name: "pantry" });
const cellar = place("cellar", { name: "cellar" });
const cellarDoor = thing("cellarDoor", {
  ...door,
  ...lockable,
  name: "cellar door",
  isOpen: true,
  isLocked: false,
});
connect(hall, { west: pantry, down: { to: cellar, via: cellarDoor } });
connect(pantry, { east: hall });
connect(cellar, { up: { to: hall, via: cellarDoor } });
const you = actor("you", { body: { name: "you", location: hall } });
const butler = actor("butler", { body: { name: "butler", location: hall } });
const cook = actor("cook", { body: { name: "cook", location: hall } });
const rex = actor("rex", { body: { name: "Rex", location: hall } });
companion(rex);
startAs(you);
// On the first move, the butler goes west; the cook goes down, and locks the door behind her.
everyTurn(butler, "leaves", ({ npc }) => {
  if (clock.moves === 1) actAs(npc, go({ way: "west" }));
});
everyTurn(cook, "leaves", ({ npc }) => {
  if (clock.moves !== 1) return;
  actAs(npc, go({ way: "down" }));
  cellarDoor.isOpen = false;
  cellarDoor.isLocked = true;
});

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "link", label: "Wait", target: id }, ...exitLinks()],
  };
};
const passages = [room("Hall", hall), room("Pantry", pantry), room("Cellar", cellar)];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
});
const labels = () => story.render().choices.map((c) => c.label);
const choose = (label: string) => {
  const c = story.render().choices.find((x) => x.label === label);
  if (!c) throw new Error(`no ${label}: ${labels().join(", ")}`);
  story.follow(c);
};
const said = () => record.events({ kinds: ["action-result", "perception"] }).map((e) => e.text);

describe("following (#122)", () => {
  it("offers to follow someone the player saw leave, and takes their way, with companions", () => {
    choose("Wait");
    expect(said()).toContain("The butler leaves to the west.");
    expect(labels()).toContain("Follow the butler");
    choose("Follow the butler");
    expect([story.current, placeOf(you)?.id, placeOf(rex)?.id]).toEqual([
      "Pantry",
      "pantry",
      "pantry",
    ]);
    expect(said().slice(-2)).toEqual(["You follow the butler west.", "You and Rex head west."]);
  });

  it("is stopped by a door they locked behind them, with why", () => {
    choose("Wait");
    expect(
      story.render().unavailable.map((u) => [u.link.label, u.link.guard?.reason]),
    ).toContainEqual(["Follow the cook", "The cellar door is locked."]);
  });

  it("forgets the trail when the player leaves the room", () => {
    choose("Wait");
    choose("West");
    choose("East, to the hall");
    expect(labels()).not.toContain("Follow the butler");
  });

  it("says why it can't follow someone it didn't see go, or who's right here", () => {
    expect(statusOf(follow({ who: butler })).hidden).toBe("The butler is right here.");
    choose("Wait");
    choose("West");
    expect(statusOf(follow({ who: cook })).hidden).toBe("You don't know where the cook went.");
  });

  it("give the same state for the same moves (determinism)", () => {
    choose("Wait");
    choose("Follow the butler");
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Hall" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
