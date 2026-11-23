import {
  action,
  actLink,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  readReplay,
  writeReplay,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { clock, daemon, fuse, minutes, moves, thing, timeOfDay } from "./index.js";

// #region fuse
export const bridge = thing("bridge", { name: "rope bridge", isStanding: true });
export const collapse = fuse("collapse", { after: minutes(30) }, () => {
  bridge.isStanding = false;
  return `At ${timeOfDay()}, somewhere behind you, timber gives way with a roar.`;
});
// #endregion
// #region daemons
export const bells = daemon("bells", { every: minutes(15) }, () => `Bells ring at ${timeOfDay()}.`);
export const drip = daemon("drip", { every: moves(2), running: true }, () => "Water drips.");
// #endregion
/** Due at the same minute as the bells, but defined after them, so it fires after them. */
const echo = fuse("echo", { after: minutes(15) }, () => "An echo answers.");
// #region interrupt
export const footsteps = fuse("footsteps", { after: minutes(180), interrupts: true }, () => {
  return "You're woken by footsteps.";
});
export const owl = daemon("owl", { every: minutes(60) }, () => {
  if (owlWakes) clock.interrupt();
  return `An owl hoots at ${timeOfDay()}.`;
});
// #endregion
let owlWakes = false;
// #region ride
export const phone = fuse("phone", { after: minutes(10), interrupts: true }, () => {
  return "Your phone buzzes: your house alarm is ringing.";
});
export const bomb = fuse("bomb", { after: minutes(25), interrupts: true }, () => {
  return "A blast ahead shakes the carriage, and the train grinds to a halt.";
});
export const ride = action<{ thing: typeof bridge }>("ride", {
  label: "Ride the subway",
  minutes: 40,
  stopsFor: (by) => by === bomb.id,
});
// #endregion
/** Due with the footsteps, at a higher priority, so it fires first, and with a lower one after. */
const creak = fuse("creak", { after: minutes(180), priority: 1 }, () => "The floor creaks.");
const wind = fuse("wind", { after: minutes(180), priority: -1 }, () => "The wind rises.");

const wait = action<{ thing: typeof bridge }>("wait", {
  label: "Wait",
  minutes: 30,
});
const passages: Passage[] = [
  {
    id: "Ravine",
    tags: [],
    body: () => [
      { type: "link", label: "Cross the bridge", target: "Far side" },
      { type: "link", label: "Look around", target: "Ravine" },
      {
        type: "link",
        label: "Wait",
        target: "Wait",
        guard: actLink({ call: wait({ thing: bridge }) }),
      },
      {
        type: "link",
        label: "Ride the subway",
        target: "Ride the subway",
        guard: actLink({ call: ride({ thing: bridge }) }),
      },
    ],
  },
  {
    id: "Far side",
    tags: [],
    effects: {
      enter: () => {
        collapse.start();
      },
    },
    body: () => [
      {
        type: "link",
        label: "Wait",
        target: "Wait",
        guard: actLink({ call: wait({ thing: bridge }) }),
      },
      { type: "link", label: "Look around", target: "Far side" },
    ],
  },
];

let store: StateStore;
let record: EventRecord;
let story: Story;
const begin = (): void => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Ravine" });
};
beforeEach(() => {
  begin();
  story.begin();
});
const choose = (label: string): void => {
  const c = story.render().choices.find((x) => x.label === label);
  if (!c) throw new Error(`no choice ${label}`);
  story.follow(c);
};
/** What fuses and daemons have said, in order. */
const said = (): string[] =>
  record.events({ kinds: ["scheduled"] }).map((e) => `${e.source}: ${e.text}`);

describe("fuses", () => {
  it("fire once, their delay after they start, saying what happened", () => {
    expect(collapse.isRunning).toBe(false);
    choose("Cross the bridge");
    expect([collapse.isRunning, collapse.firesAt, collapse.unit]).toEqual([true, 30, "minutes"]);
    choose("Wait");
    expect(bridge.isStanding).toBe(false);
    expect(collapse.isRunning).toBe(false);
    expect(said()).toContain(
      "collapse: At 12:30 am, somewhere behind you, timber gives way with a roar.",
    );
    choose("Wait");
    expect(said().filter((s) => s.startsWith("collapse"))).toHaveLength(1);
  });

  it("can be cancelled, and started over", () => {
    choose("Cross the bridge");
    collapse.cancel();
    expect([collapse.isRunning, collapse.firesAt]).toEqual([false, undefined]);
    choose("Wait");
    expect(bridge.isStanding).toBe(true);
    collapse.start();
    expect(collapse.firesAt).toBe(60);
  });
});

describe("daemons", () => {
  it("fire every time their delay passes, each at its own time, in a long wait", () => {
    bells.start();
    echo.start();
    choose("Wait"); // 30 minutes: the bells ring twice, and the echo after the first
    expect(said().filter((s) => !s.startsWith("drip"))).toEqual([
      "bells: Bells ring at 12:15 am.",
      "echo: An echo answers.",
      "bells: Bells ring at 12:30 am.",
    ]);
    bells.stop();
    choose("Wait");
    expect(said().filter((s) => s.startsWith("bells"))).toHaveLength(2);
  });

  it("can count moves, and run from the start", () => {
    // #region moves
    choose("Look around");
    expect(said()).toEqual([]);
    choose("Look around"); // the second move
    expect(said()).toEqual(["drip: Water drips."]);
    expect(drip.firesAt).toBe(4);
    // #endregion
    choose("Look around");
    choose("Look around");
    expect(said()).toEqual(["drip: Water drips.", "drip: Water drips."]);
    expect(clock.minutes).toBe(0);
  });
});

describe("time jumps", () => {
  it("stop where a fuse interrupts, after all that's due at that minute, in priority order", () => {
    owl.start();
    footsteps.start();
    creak.start();
    wind.start();
    // #region sleep
    const slept = clock.advance(8 * 60);
    expect(slept).toEqual({ minutes: 180, interrupted: true, by: "footsteps" });
    expect(timeOfDay()).toBe("3:00 am");
    // #endregion
    expect(said().filter((s) => !s.startsWith("drip"))).toEqual([
      "owl: An owl hoots at 1:00 am.",
      "owl: An owl hoots at 2:00 am.",
      "creak: The floor creaks.",
      "footsteps: You're woken by footsteps.", // defined before the owl
      "owl: An owl hoots at 3:00 am.",
      "wind: The wind rises.",
    ]);
    // The rest of the night is still to come.
    expect(clock.advance(60)).toEqual({ minutes: 60, interrupted: false });
    expect(said().at(-1)).toBe("owl: An owl hoots at 4:00 am.");
  });

  it("stop where a daemon's code says, through clock.interrupt()", () => {
    owl.start();
    owlWakes = true;
    try {
      expect(clock.advance(150)).toEqual({ minutes: 60, interrupted: true, by: "owl" });
    } finally {
      owlWakes = false;
    }
    expect(() => {
      clock.interrupt();
    }).toThrow("clock.interrupt: the clock isn't moving on now.");
  });

  it("stop only for what the jump says it stops for", () => {
    phone.start();
    expect(clock.advance(30, { stopsFor: () => false })).toEqual({
      minutes: 30,
      interrupted: false,
    });
    expect(said()).toEqual(["phone: Your phone buzzes: your house alarm is ringing."]);
  });

  it("stop an action's time only for what it stops for", () => {
    phone.start();
    bomb.start();
    choose("Ride the subway");
    // The call is told on the way; only the bomb stops the ride, 25 minutes in.
    expect(said()).toEqual([
      "phone: Your phone buzzes: your house alarm is ringing.",
      "bomb: A blast ahead shakes the carriage, and the train grinds to a halt.",
    ]);
    expect(clock.minutes).toBe(25);
  });

  it("fire in the same order every time", () => {
    const run = (): string[] => {
      begin();
      story.begin();
      owl.start();
      footsteps.start();
      creak.start();
      wind.start();
      bells.start();
      echo.start();
      choose("Wait");
      clock.advance(300);
      return said();
    };
    const first = run();
    expect(run()).toEqual(first);
  });
});

describe("fuses and daemons, as state", () => {
  it("are undone, saved, and replayed with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    choose("Cross the bridge");
    history.checkpoint("crossed");
    choose("Wait");
    history.checkpoint("waited");
    expect(bridge.isStanding).toBe(false);
    history.undo();
    expect([bridge.isStanding, collapse.isRunning, collapse.firesAt]).toEqual([true, true, 30]);
    history.redo();
    const replay = readReplay(writeReplay(story.toReplay()));
    const before = said();
    begin();
    story.playReplay(replay);
    expect(bridge.isStanding).toBe(false);
    expect(said()).toEqual(before);
  });

  it("explain a taken ID or a delay that isn't one", () => {
    expect(() => fuse("collapse", { after: minutes(1) }, () => undefined)).toThrow(
      'fuse "collapse": another fuse or daemon has this ID',
    );
    expect(() => minutes(0)).toThrow("minutes: 0 isn't a whole number, 1 or more.");
    expect(() => moves(1.5)).toThrow("moves: 1.5 isn't a whole number, 1 or more.");
    expect(() => fuse("odd", { after: minutes(1), priority: NaN }, () => undefined)).toThrow(
      'fuse "odd": priority NaN isn\'t a number.',
    );
  });
});
