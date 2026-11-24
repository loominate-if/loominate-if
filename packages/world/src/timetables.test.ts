import {
  createEventRecord,
  createStore,
  createStory,
  object,
  type EventRecord,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  agenda,
  calendar,
  clock,
  place,
  placeOf,
  schedule,
  startAs,
  startClock,
  whereScheduled,
} from "./index.js";

const bakery = place("bakery", { name: "bakery" });
const market = place("market", { name: "market" });
const home = place("home", { name: "baker's cottage" });
const square = place("square", { name: "square" });
const you = actor("you", { body: { name: "you", location: market } });
const baker = actor("baker", { body: { name: "baker", location: square } });
startAs(you);
startClock({ at: "05:00", date: "2026-11-24" }); // a Tuesday
const errand = object("errand", { pending: false });

// #region timetable
schedule(baker, [
  { at: "05:30", in: bakery },
  { at: "13:00", in: market, on: { weekday: ["tuesday", "thursday"] } },
  { at: "13:00", in: bakery }, // the other days
  { at: "20:00", in: home },
]);
// #endregion
agenda(baker, "deliver a cake", {
  ready: () => errand.pending,
  act: () => undefined, // busy all the while it's pending
});

let store: StateStore;
let record: EventRecord;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  createStory(store, record, [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});
const at = () => placeOf(baker)?.id;
const noticed = () => record.events({ kinds: ["perception"] }).map((e) => e.text);

describe("scheduled NPCs (#105)", () => {
  it("start where the timetable says, without being narrated arriving", () => {
    expect(calendar.weekday).toBe("tuesday");
    expect(at()).toBe("home"); // 05:00: still last night's 20:00 entry
    expect(noticed()).toEqual([]);
  });

  it("are in the right place after jumps in time, by the calendar", () => {
    clock.advance(60); // 06:00
    expect(at()).toBe("bakery");
    clock.advance(8 * 60); // Tuesday 14:00: market day
    expect(at()).toBe("market");
    clock.advance(24 * 60); // Wednesday 14:00
    expect(at()).toBe("bakery");
    clock.advance(24 * 60); // Thursday 14:00
    expect(at()).toBe("market");
    clock.advance(7 * 60); // Thursday 21:00
    expect(at()).toBe("home");
    expect(whereScheduled(baker, clock.minutes + 24 * 60)?.id).toBe("home");
  });

  it("are narrated coming and going only where the player sees it", () => {
    clock.advance(8 * 60); // 13:00: into the market, where the player is
    expect(noticed()).toEqual(["The baker arrives."]);
  });

  it("are held by an agenda item, then go where the timetable says by then", () => {
    clock.advance(60); // 06:00: at the bakery
    errand.pending = true;
    clock.advance(8 * 60); // through the market's start: held
    expect(at()).toBe("bakery");
    errand.pending = false;
    clock.advance(8 * 60); // 22:00: the market missed, they go home
    expect(at()).toBe("home");
  });

  it("give the same state for the same moves (determinism)", () => {
    const passages = [
      {
        id: "Square",
        tags: [],
        effects: {
          enter: () => {
            clock.advance(5 * 60); // time passes as part of the move
          },
        },
        body: () => [{ type: "link" as const, label: "Wait", target: "Square" }],
      },
    ];
    const first = createStore();
    const story = createStory(first, createEventRecord(first), passages, { start: "Square" });
    story.begin();
    story.follow({ type: "link", label: "Wait", target: "Square" });
    story.follow({ type: "link", label: "Wait", target: "Square" });
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Square" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(first.snapshot());
  });
});
