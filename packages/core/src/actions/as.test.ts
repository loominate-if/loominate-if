import { describe, expect, it } from "vitest";
import { createEventRecord, type EventRecord } from "../events/record.js";
import { object } from "../objects/objects.js";
import { createStory } from "../passages/story.js";
import { hook } from "../rules/hooks.js";
import { createStore } from "../state/store.js";
import { action, perform } from "./actions.js";

const bell = object("as-bell", { rung: 0, cracked: false });
const ringer = object("as-ringer", { name: "ringer" });
const ring = action<{ thing: typeof bell }>("as-ring", {
  check: ({ thing }) => (thing.cracked ? "It's cracked." : undefined),
  run: ({ thing }) => {
    thing.rung += 1;
  },
  minutes: 5,
  report: "You ring the bell.",
  seen: ({ body }) => `${String((body as { name?: string } | undefined)?.name)} rings the bell.`,
});

let record: EventRecord;
const begin = () => {
  const store = createStore();
  record = createEventRecord(store);
  createStory(store, record, [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
};
const minutes: number[] = [];
hook("actionTime").rule("as test", ({ minutes: m }) => minutes.push(m));

describe("performing as someone else (#106)", () => {
  it("runs every stage for them, returns what onlookers see, and reports nothing to the player", () => {
    begin();
    expect(perform(ring({ thing: bell }), { as: { body: ringer } })).toEqual({
      done: true,
      seen: "ringer rings the bell.",
    });
    expect(bell.rung).toBe(1);
    expect(record.events({ kinds: ["action-result"] })).toEqual([]);
    // Their time isn't the game's.
    expect(minutes).toEqual([]);
  });

  it("returns a refusal without telling the player", () => {
    begin();
    bell.cracked = true;
    expect(perform(ring({ thing: bell }), { as: { body: ringer } })).toEqual({
      done: false,
      reason: "It's cracked.",
    });
    expect(record.events({ kinds: ["action-result"] })).toEqual([]);
  });
});
