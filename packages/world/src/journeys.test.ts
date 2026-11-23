import {
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
import {
  actor,
  clock,
  connect,
  door,
  enterRoom,
  exitLinks,
  fuse,
  journey,
  lockable,
  minutes,
  place,
  registerRoom,
  startAs,
  startClock,
  thing,
  timeOfDay,
  type Place,
} from "./index.js";

startClock({ at: "08:00" });
export const platform = place("platform", { name: "platform" });
export const downtown = place("downtown", { name: "downtown" });
export const tunnel = place("tunnel", { name: "tunnel" });
export const busStop = place("busStop", { name: "bus stop" });
export const depot = place("depot", { name: "depot" });
export const gate = thing("gate", { ...door, ...lockable, name: "ticket gate" });

// #region journey
export const phone = fuse("phone", { after: minutes(10), interrupts: true }, () => {
  return "Your phone buzzes: your house alarm is ringing.";
});
export const bomb = fuse("bomb", { after: minutes(25), interrupts: true }, () => {
  return "A blast ahead shakes the carriage, and the train grinds to a halt.";
});
journey("subway", { stopsFor: (by) => by === bomb.id, stopsAt: tunnel });
connect(platform, {
  east: { to: downtown, minutes: 40, journey: "subway" },
  north: { to: busStop },
});
// #endregion
journey("bus"); // anything stops it, and leaves you where you were
connect(busStop, { west: { to: depot, minutes: 30, journey: "bus" }, south: platform });
connect(depot, { south: { to: platform, via: gate, journey: "subway", minutes: 5 } });
connect(tunnel, { west: platform });
connect(downtown, { west: platform });
const you = actor("you", { body: { name: "you", location: platform } });
startAs(you);

const room = (id: string, r: Place, text: string): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "text", text: `${text} It's ${timeOfDay()}.` }, ...exitLinks()],
  };
};
const passages = [
  room("Platform", platform, "A busy platform."),
  room("Downtown", downtown, "You step out downtown."),
  room("Tunnel", tunnel, "You're stuck in a dark tunnel."),
  room("Bus stop", busStop, "A bus stop."),
  room("Depot", depot, "The bus depot."),
];

let store: StateStore;
let record: EventRecord;
let story: Story;
const begin = () => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Platform" });
};
beforeEach(() => {
  begin();
  story.begin();
});
const choose = (label: string) => {
  const c = story.render().choices.find((x) => x.label?.startsWith(label));
  if (!c) throw new Error(`no ${label} in ${story.current ?? ""}`);
  story.follow(c);
};
const told = () => record.events({ kinds: ["scheduled"] }).map((e) => e.text);
const firstLine = () => (story.render().nodes[0] as { text?: string }).text;

describe("journeys", () => {
  it("tell lesser events on the way, and arrive", () => {
    phone.start();
    // #region arrive
    choose("East");
    expect([story.current, firstLine()]).toEqual([
      "Downtown",
      "You step out downtown. It's 8:40 am.",
    ]);
    expect(told()).toEqual(["Your phone buzzes: your house alarm is ringing."]);
    // #endregion
    expect(story.moves).toBe(1);
  });

  it("stop partway for what the journey stops for, leaving the player where it says", () => {
    phone.start();
    bomb.start();
    // #region stopped
    choose("East");
    expect([story.current, firstLine()]).toEqual([
      "Tunnel",
      "You're stuck in a dark tunnel. It's 8:25 am.",
    ]);
    expect(told()).toEqual([
      "Your phone buzzes: your house alarm is ringing.",
      "A blast ahead shakes the carriage, and the train grinds to a halt.",
    ]);
    // #endregion
    // The destination's passage was never entered.
    expect(record.events({ kinds: ["navigation"] }).map((e) => e.to)).toEqual([
      "Platform",
      "Tunnel",
    ]);
  });

  it("leave the player where they set out, if the journey doesn't say where it stops", () => {
    choose("North");
    phone.start();
    choose("West"); // the bus: anything stops it
    expect([story.current, timeOfDay()]).toEqual(["Bus stop", "8:10 am"]);
    expect(told()).toEqual(["Your phone buzzes: your house alarm is ringing."]);
  });

  it("are blocked like any way, with why", () => {
    choose("North");
    choose("West");
    expect(story.current).toBe("Depot");
    const south = story.render().unavailable.find((u) => u.link.label.startsWith("South"));
    expect(south?.link.guard?.reason).toBe("The ticket gate is locked.");
  });

  it("are undone and replayed as one move", () => {
    bomb.start();
    const history = createHistory(store);
    history.checkpoint("begun");
    choose("East");
    history.checkpoint("stopped");
    history.undo();
    expect([story.current, clock.minutes]).toEqual(["Platform", 0]);
    history.redo();
    const replay = readReplay(writeReplay(story.toReplay()));
    begin();
    story.playReplay(replay);
    // The bomb was started from test code, not a move, so the replay has no bomb, and arrives.
    expect(story.current).toBe("Downtown");
  });
});
