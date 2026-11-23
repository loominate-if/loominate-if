import {
  action,
  actLink,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  readReplay,
  statusOf,
  writeReplay,
  type ActionCall,
  type EventRecord,
  type LinkNode,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  clock,
  connect,
  enterRoom,
  exitLinks,
  minutes,
  place,
  placeOf,
  registerRoom,
  scene,
  startAs,
  startClock,
  wait,
  type Place,
} from "./index.js";

startClock({ at: "18:00" });
export const cliff = place("cliff", { name: "cliff" });
export const cave = place("cave", { name: "cave" });
connect(cliff, { in: cave });
connect(cave, { out: cliff });
const you = actor("you", { body: { name: "you", location: cliff } });
startAs(you);
const at = (p: Place) => placeOf(you)?.id === p.id;

// #region storm
export const storm = scene("storm", {
  name: "the storm",
  startsWhen: () => clock.is("evening") && at(cliff),
  endsWhen: { sheltered: () => at(cave) },
  lasts: minutes(60),
  onStart: () => "Thunder cracks overhead, and rain sweeps the cliff.",
  onEnd: (how) => (how === "sheltered" ? "You're out of the rain." : "The storm blows itself out."),
});
export const signal = action<{ thing: typeof cliff }>("signal", {
  label: "Fire a flare",
  report: "Your flare arcs out over the sea.",
});
storm.rule(signal.check, "the wind snatches flares", () => "The wind snatches the flare away.");
export const brace = action<{ thing: typeof cliff }>("brace", {
  label: "Brace against the wind",
  during: storm,
  report: "You brace against the wind.",
});
// #endregion
// #region tide
export const tide = scene("tide", {
  startsAt: "19:00",
  lasts: minutes(30),
  recurring: 2,
  onStart: () => "The tide comes in.",
});
// #endregion
export const party = scene("party");

const actLinkFor = <A>(label: string, call: ActionCall<A>): LinkNode => ({
  type: "link",
  label,
  target: label,
  guard: actLink({ call }),
});
const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [
      ...exitLinks(),
      actLinkFor("Wait 10 minutes", wait({ minutes: 10 })),
      actLinkFor("Wait an hour", wait({ minutes: 60 })),
      actLinkFor("Fire a flare", signal({ thing: cliff })),
      actLinkFor("Brace against the wind", brace({ thing: cliff })),
    ],
  };
};
const passages = [room("Cliff", cliff), room("Cave", cave)];

let store: StateStore;
let record: EventRecord;
let story: Story;
const begin = () => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Cliff" });
};
beforeEach(() => {
  begin();
  story.begin();
});
const choose = (label: string) => {
  const c = story.render().choices.find((x) => x.label === label);
  if (!c)
    throw new Error(
      `no ${label}: ${story
        .render()
        .choices.map((x) => x.label)
        .join(", ")}`,
    );
  story.follow(c);
};
const told = () => record.events({ kinds: ["scheduled", "action-result"] }).map((e) => e.text);
const offered = () => story.render().choices.map((c) => c.label);

describe("scenes", () => {
  it("start when their condition holds, and end the way one of their endings says", () => {
    expect(storm.isHappening).toBe(false);
    expect(offered()).not.toContain("Brace against the wind");
    // #region happening
    choose("Wait 10 minutes"); // a move: the storm's condition holds
    expect([storm.isHappening, storm.timesStarted]).toEqual([true, 1]);
    expect(offered()).toContain("Brace against the wind");
    expect(statusOf(signal({ thing: cliff })).disabled).toBe("The wind snatches the flare away.");
    choose("In");
    expect([storm.isHappening, storm.howEnded, storm.hasEnded]).toEqual([false, "sheltered", true]);
    // #endregion
    expect(told()).toEqual([
      "You wait ten minutes.",
      "Thunder cracks overhead, and rain sweeps the cliff.",
      "You're out of the rain.",
    ]);
    expect(statusOf(signal({ thing: cliff })).disabled).toBeUndefined();
  });

  it("end when they've lasted out, and happen once unless they recur", () => {
    choose("Wait 10 minutes");
    choose("Wait an hour"); // the storm lasts 60 minutes
    expect([storm.isHappening, storm.howEnded]).toEqual([false, "timeUp"]);
    expect(told()).toContain("The storm blows itself out.");
    choose("Wait 10 minutes"); // still evening on the cliff, but it's had its once
    expect(storm.timesStarted).toBe(1);
    expect(() => {
      storm.start();
    }).toThrow('scene "storm": it has happened once, and can\'t happen again.');
  });

  it("start at a time, and recur only as often as they may", () => {
    choose("Wait an hour"); // 19:00
    expect([tide.isHappening, tide.timesStarted]).toEqual([true, 1]);
    choose("Wait an hour"); // the tide goes out at 19:30
    expect(tide.isHappening).toBe(false);
    choose("Wait 10 minutes");
    clock.advance(24 * 60); // the next evening, through a move's worth of code
    expect(tide.timesStarted).toBe(2);
    clock.advance(24 * 60);
    expect(tide.timesStarted).toBe(2); // recurring: 2
  });

  it("start and end from code", () => {
    choose("In");
    party.start();
    expect(party.isHappening).toBe(true);
    party.end("dawn");
    expect(party.howEnded).toBe("dawn");
    expect(() => {
      party.end();
    }).toThrow("it isn't happening");
  });

  it("are undone and replayed with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    choose("Wait 10 minutes");
    history.checkpoint("storm");
    expect(storm.isHappening).toBe(true);
    history.undo();
    expect([storm.isHappening, statusOf(signal({ thing: cliff })).disabled]).toEqual([
      false,
      undefined,
    ]);
    history.redo();
    choose("In");
    const replay = readReplay(writeReplay(story.toReplay()));
    const before = told();
    begin();
    story.playReplay(replay);
    expect([storm.howEnded, told()]).toEqual(["sheltered", before]);
  });

  it("explain a recurring count that isn't one", () => {
    expect(() => scene("odd", { recurring: 0 })).toThrow("recurring 0 isn't a number of times");
  });
});
