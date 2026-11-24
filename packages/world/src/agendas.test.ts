import {
  object,
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
  connect,
  door,
  enterRoom,
  isAgendaActive,
  lockable,
  place,
  placeOf,
  registerRoom,
  say,
  startAgenda,
  startAs,
  stepToward,
  thing,
  type Place,
} from "./index.js";

const kitchen = place("kitchen", { name: "kitchen" });
const hall = place("hall", { name: "hall" });
const study = place("study", { name: "study" });
const cellar = place("cellar", { name: "cellar" });
const cellarDoor = thing("cellarDoor", {
  ...door,
  ...lockable,
  name: "cellar door",
  isLocked: true,
});
connect(kitchen, { east: hall, down: { to: cellar, via: cellarDoor } });
connect(hall, { west: kitchen, east: study });
connect(study, { west: hall });
connect(cellar, { up: { to: kitchen, via: cellarDoor } });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: kitchen } });
const cook = actor("cook", { body: { name: "cook", location: kitchen } });
const wine = thing("wine", { name: "wine", location: cellar });
startAs(you);
const fire = object("fire", { isBurning: false });

// #region warning
agenda(butler, "warn the player", {
  priority: 10,
  starts: false,
  act: ({ npc, done }) => {
    if (!stepToward(npc, you)) return; // one step a turn, until he's there
    say(npc, "“The east wing is on fire!”");
    done();
  },
});
// #endregion
agenda(butler, "polish the silver", { act: () => undefined }); // lower priority: idles meanwhile
// The cook wants wine from the cellar, but its door is locked.
agenda(cook, "fetch wine", {
  act: ({ npc, done }) => {
    if (stepToward(npc, wine)) done();
  },
});

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [
      { type: "link", label: "Wait", target: id },
      ...(id === "Study"
        ? [{ type: "link" as const, label: "Raise the alarm", target: "Alarm" }]
        : []),
    ],
  };
};
// Raising the alarm starts the butler's agenda, as part of a move, so replays repeat it.
const alarm: Passage = {
  id: "Alarm",
  tags: [],
  effects: {
    enter: () => {
      fire.isBurning = true;
      startAgenda(butler, "warn the player");
    },
  },
  body: () => [{ type: "link", label: "Wait", target: "Study" }],
};
const passages = [
  room("Study", study),
  room("Hall", hall),
  room("Kitchen", kitchen),
  room("Cellar", cellar),
  alarm,
];

let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Study", seed: "s" });
  story.begin();
});
const wait = () => {
  story.follow({ type: "link", label: "Wait", target: "Study" });
};
const noticed = () => record.events({ kinds: ["perception"] }).map((e) => e.text);

describe("agendas (#107)", () => {
  it("find the player and deliver the warning, a step a turn, even unseen", () => {
    wait();
    expect(placeOf(butler)?.id).toBe("kitchen"); // not started: polishing the silver
    // #region fire
    fire.isBurning = true;
    startAgenda(butler, "warn the player");
    // #endregion
    wait();
    expect(placeOf(butler)?.id).toBe("hall"); // unseen, but pursuing his goal
    wait();
    expect(placeOf(butler)?.id).toBe("study");
    expect(noticed()).toEqual([
      "The butler arrives from the west.",
      "The butler says, “The east wing is on fire!”",
    ]);
    expect(isAgendaActive(butler, "warn the player")).toBe(false);
    wait();
    expect(noticed().filter((n) => n.includes("fire"))).toHaveLength(1); // done: said once
  });

  it("are stopped by a locked door on the way, as the player would be", () => {
    wait();
    wait();
    expect(placeOf(cook)?.id).toBe("kitchen");
    expect(isAgendaActive(cook, "fetch wine")).toBe(true);
  });

  it("give the same state for the same moves (determinism)", () => {
    story.follow({ type: "link", label: "Raise the alarm", target: "Alarm" });
    wait();
    wait();
    const snapshot = store.snapshot();
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Study" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(snapshot);
  });

  it("say why an unknown item can't be started, and refuse the player speaking", () => {
    expect(() => startAgenda(butler, "dance")).toThrow('has no agenda item "dance"');
    expect(() => say(you, "Hello.")).toThrow("that's the player");
  });
});
