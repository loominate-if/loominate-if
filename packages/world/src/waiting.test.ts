import {
  actLink,
  createEventRecord,
  createStore,
  createStory,
  readReplay,
  statusOf,
  writeReplay,
  type ActionCall,
  type EventRecord,
  type LinkNode,
  type Story,
} from "@loominate-if/core";
import { widgets } from "@loominate-if/presentation";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  clock,
  daemon,
  fuse,
  minutes,
  place,
  startAs,
  startClock,
  thing,
  timeOfDay,
  wait,
  waitCondition,
  waitMenu,
  waitUntil,
} from "./index.js";

startClock({ at: "05:30" });
const platform = place("platform", { name: "platform" });
const you = actor("you", { body: { name: "you", location: platform } });
startAs(you);

// #region waits
export const train = daemon(
  "train",
  { every: minutes(25), running: true },
  () => "A train pulls in.",
);
export const shop = thing("shop", { name: "kiosk", isOpen: false, location: platform });
export const shopkeeper = fuse("shopkeeper", { after: minutes(40), running: true }, () => {
  shop.isOpen = true;
  return "The kiosk's shutter rattles up.";
});
waitCondition("kiosk opens", () => shop.isOpen);
export const alarm = fuse("alarm", { after: minutes(15), interrupts: true }, () => {
  return "A fire alarm shrieks!";
});
// #endregion

// #region links
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- calls of two actions
const links: ActionCall<any>[] = [
  wait({ minutes: 10 }),
  waitUntil({ time: "06:00" }),
  waitUntil({ fires: "train", atMost: 60 }),
  waitUntil({ condition: "kiosk opens" }),
];
// #endregion
const passages = [
  {
    id: "Platform",
    tags: [],
    body: () =>
      links.map((call): LinkNode => ({
        type: "link",
        label: statusOf(call).label,
        target: "Platform",
        guard: actLink({ call }),
      })),
  },
];

let record: EventRecord;
let story: Story;
const begin = (): void => {
  const store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Platform" });
};
beforeEach(() => {
  begin();
  story.begin();
});
const choose = (label: string): void => {
  const c = story.render().choices.find((x) => x.label === label);
  if (!c)
    throw new Error(
      `no choice ${label} in ${story
        .render()
        .choices.map((x) => x.label)
        .join(", ")}`,
    );
  story.follow(c);
};
const told = (): string[] =>
  record.events({ kinds: ["scheduled", "action-result"] }).map((e) => e.text);

describe("waiting", () => {
  it("offers waits as links, labelled for what they wait for", () => {
    expect(story.render().choices.map((c) => c.label)).toEqual([
      "Wait 10 minutes",
      "Wait until 6:00 am",
      "Wait until train",
      "Wait until kiosk opens",
    ]);
  });

  it("waits a number of minutes", () => {
    choose("Wait 10 minutes");
    expect(timeOfDay()).toBe("5:40 am");
    expect(told()).toEqual(["You wait ten minutes."]);
  });

  it("waits until a time of day, and isn't offered at that time", () => {
    choose("Wait until 6:00 am");
    expect(told()).toEqual(["A train pulls in.", "You wait until 6:00 am."]);
    expect(statusOf(waitUntil({ time: "06:00" })).hidden).toBe("It's 6:00 am now.");
    clock.advance(1);
    expect(statusOf(waitUntil({ time: "06:00" })).hidden).toBeUndefined(); // tomorrow's
  });

  it("waits until a fuse or daemon fires, or a condition holds", () => {
    // #region until
    choose("Wait until train");
    expect([timeOfDay(), told()]).toEqual([
      "5:55 am",
      ["A train pulls in.", "You wait 25 minutes."],
    ]);
    choose("Wait until kiosk opens");
    expect(timeOfDay()).toBe("6:10 am");
    expect(told().slice(2)).toEqual(["The kiosk's shutter rattles up.", "You wait 15 minutes."]);
    // #endregion
    expect(statusOf(waitUntil({ condition: "kiosk opens" })).hidden).toBe(
      "There's no need to wait.",
    );
  });

  it("gives up after atMost minutes", () => {
    train.stop();
    train.start(); // due again in 25 minutes
    const usual = links[2] as (typeof links)[number];
    links[2] = waitUntil({ fires: "train", atMost: 20 });
    try {
      choose("Wait until train");
    } finally {
      links[2] = usual;
    }
    expect([timeOfDay(), told()]).toEqual(["5:50 am", ["You give up waiting at 5:50 am."]]);
  });

  it("stops at anything that interrupts, and says so", () => {
    alarm.start();
    choose("Wait until 6:00 am");
    expect(told()).toEqual(["A fire alarm shrieks!", "Your wait ends at 5:45 am."]);
  });

  it("is replayed", () => {
    choose("Wait until train");
    choose("Wait 10 minutes");
    const replay = readReplay(writeReplay(story.toReplay()));
    const before = told();
    begin();
    story.playReplay(replay);
    expect([timeOfDay(), told()]).toEqual(["6:05 am", before]);
  });

  it("explains a wait that names nothing, or something that isn't there", () => {
    expect(() => statusOf(waitUntil({}))).toThrow("give exactly one of `time`, `fires`");
    expect(() => statusOf(waitUntil({ fires: "bus" }))).toThrow('no fuse or daemon "bus"');
    expect(() => statusOf(waitUntil({ condition: "dawn" }))).toThrow('no condition "dawn"');
    expect(() => statusOf(waitUntil({ time: "6am" }))).toThrow("isn't a time of day");
    expect(() => statusOf(wait({ minutes: 0 }))).toThrow("isn't a whole number of minutes");
  });
});

describe("the Wait menu", () => {
  it("is a header widget listing the game's waits", () => {
    // #region menu
    waitMenu([
      { call: wait({ minutes: 10 }) },
      { call: waitUntil({ time: "06:00" }), label: "Wait until dawn" },
    ]);
    // #endregion
    expect(widgets.get("wait")?.data({} as never)).toEqual({ label: "Wait" });
  });
});
