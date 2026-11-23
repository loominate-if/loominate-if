import {
  action,
  actLink,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  hook,
  readReplay,
  writeReplay,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  clock,
  connect,
  enterRoom,
  exitLinks,
  fuse,
  minutes,
  place,
  registerRoom,
  type Place,
  startAs,
  startClock,
  timeOfDay,
} from "./index.js";

// #region clock
startClock({ at: "21:30" });
export const kitchen = place("kitchen", { name: "kitchen" });
export const garden = place("garden", { name: "garden" });
export const lane = place("lane", { name: "lane" });
connect(kitchen, { out: { to: garden, minutes: 2 }, north: lane });
connect(garden, { in: { to: kitchen, minutes: 2 } });
connect(lane, { south: kitchen });

export const brew = action<{ thing: typeof kitchen }>("brew", {
  label: "Brew tea",
  minutes: 5,
  run: () => {
    clock.advance(1); // waiting for the kettle, partway through
  },
  report: () => `You brew tea. It's ${timeOfDay()}.`,
});
// #endregion
const alarm = fuse("alarm", { after: minutes(1), interrupts: true }, () => "An alarm rings.");
const you = actor("you", { body: { name: "you", location: kitchen } });
startAs(you);

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: {
      enter: () => {
        enterRoom(r);
      },
    },
    body: () => [
      ...exitLinks(),
      ...(r.id === "kitchen"
        ? [
            {
              type: "link" as const,
              label: "Brew tea",
              target: "Brew tea",
              guard: actLink({ call: brew({ thing: kitchen }) }),
            },
            { type: "link" as const, label: "Wait", target: "Kitchen" },
          ]
        : []),
    ],
  };
};
const passages = [room("Kitchen", kitchen), room("Garden", garden), room("Lane", lane)];

let store: StateStore;
let story: Story;
beforeEach(() => {
  store = createStore();
  story = createStory(store, createEventRecord(store), passages, { start: "Kitchen" });
  story.begin();
});
const choose = (label: string): void => {
  const c = story.render().choices.find((x) => x.label?.startsWith(label));
  if (!c) throw new Error(`no choice ${label}`);
  story.follow(c);
};
const now = () => `day ${String(clock.day)}, ${timeOfDay()}, ${String(clock.moves)} moves`;

const added: (() => void)[] = [];
afterEach(() => {
  for (const undo of added.splice(0)) undo();
});

describe("the game clock", () => {
  it("starts when the game says, and counts every move", () => {
    expect(clock.minutes).toBe(0);
    expect([clock.day, clock.hour, clock.minute]).toEqual([1, 21, 30]);
    expect(now()).toBe("day 1, 9:30 pm, 0 moves");
    choose("Wait"); // a plain link: a move, but no time
    expect(now()).toBe("day 1, 9:30 pm, 1 moves");
  });

  it("takes travel time from the exit, or the game's default", () => {
    // #region travel
    choose("Out"); // 2 minutes, as the exit says
    expect(now()).toBe("day 1, 9:32 pm, 1 moves");
    choose("In");
    choose("North"); // no minutes: travelMinutes, 0 by default
    expect(now()).toBe("day 1, 9:34 pm, 3 moves");
    clock.travelMinutes = 10;
    choose("South");
    expect(now()).toBe("day 1, 9:44 pm, 4 moves");
    // #endregion
  });

  it("takes all its travel time: nothing stops a journey partway", () => {
    alarm.start();
    choose("Out");
    expect(clock.minutes).toBe(2);
    expect(alarm.isRunning).toBe(false);
  });

  it("takes actions' time, and time any code adds, even partway through", () => {
    const seen: string[] = [];
    hook("clockAdvance").rule("test", ({ from, to }) => {
      seen.push(`${String(from)}->${String(to)}`);
    });
    added.push(() => {
      hook("clockAdvance").remove("test");
    });
    choose("Brew tea");
    expect(seen).toEqual(["0->1", "1->6"]);
    expect(now()).toBe("day 1, 9:36 pm, 1 moves");
    expect(story.render().choices.map((c) => c.label)).toContain("Brew tea");
  });

  it("runs past midnight into the next day", () => {
    clock.advance(150);
    expect(now()).toBe("day 2, 12:00 am, 0 moves");
    clock.advance(13 * 60 + 5);
    expect(timeOfDay()).toBe("1:05 pm");
  });

  it("is undone, saved, and replayed with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    choose("Out");
    history.checkpoint("out");
    choose("In");
    history.checkpoint("in");
    choose("Brew tea");
    history.checkpoint("brewed");
    expect(now()).toBe("day 1, 9:40 pm, 3 moves");
    history.undo();
    expect(now()).toBe("day 1, 9:34 pm, 2 moves");
    history.redo();
    const replay = readReplay(writeReplay(story.toReplay()));
    store = createStore();
    story = createStory(store, createEventRecord(store), passages, { start: "Kitchen" });
    story.playReplay(replay);
    expect(now()).toBe("day 1, 9:40 pm, 3 moves");
  });

  it("explains a wrong time, or one started twice", () => {
    expect(() => {
      clock.advance(-1);
    }).toThrow("clock.advance: -1 isn't a number of minutes");
    expect(() => {
      startClock({ at: "8am" });
    }).toThrow("startClock: the clock has already been started");
  });
});

describe("the clock widget", () => {
  it("is registered as clock, showing the time of day", async () => {
    const { widgets } = await import("@loominate-if/presentation");
    expect(widgets.get("clock")?.data({} as never)).toEqual({ text: "9:30 pm", label: "Time" });
  });
});
