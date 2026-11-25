/** Paced turns and routes (#137): simulated NPCs acting on the game clock, as a long wait goes by. */
import {
  createEventRecord,
  createStore,
  createStory,
  type ActionCall,
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
  everyTurn,
  getsTurn,
  happen,
  isSimulated,
  minutes,
  pacingOf,
  place,
  placeOf,
  registerRoom,
  route,
  simulate,
  startAs,
  startClock,
  thing,
  timeOfDay,
  wait,
  type Place,
} from "./index.js";

startClock({ at: "22:00" });
export const gatehouse = place("gatehouse", { name: "gatehouse" });
export const yard = place("yard", { name: "yard" });
export const wall = place("wall", { name: "wall walk" });
export const cellar = place("cellar", { name: "cellar" });
export const store = place("storeroom", { name: "storeroom" });
export const barracks = place("barracks", { name: "barracks" });
export const storeDoor = thing("storeDoor", { ...door, name: "storeroom door", isOpen: false });
connect(gatehouse, { east: yard, down: cellar });
connect(yard, { west: gatehouse, east: wall, north: { to: store, via: storeDoor } });
connect(wall, { west: yard });
connect(cellar, { up: gatehouse, east: barracks });
connect(barracks, { west: cellar });
connect(store, { south: { to: yard, via: storeDoor } });
export const you = actor("you", { body: { name: "you", location: cellar } });
// #region route
export const guard = actor("guard", { body: { name: "guard", location: gatehouse } });
// A patrol: a step every five minutes, round and round.
route(guard, [gatehouse, yard, wall], { every: minutes(5), loop: true });
// #endregion
startAs(you);

// A sentry who stays put and paces, every ten minutes, and a porter who's
// never paced, whose turns still come after each move.
export const sentry = actor("sentry", { body: { name: "sentry", location: barracks } });
simulate(sentry, { every: minutes(10) });
let sentryTurns = 0;
everyTurn(sentry, "paces", ({ npc }) => {
  sentryTurns += 1;
  happen(npc, { seen: "The sentry paces past." });
});
// Someone who walks into the storeroom, whose door is shut.
export const thief = actor("thief", { body: { name: "thief", location: wall } });
route(thief, [store], { every: minutes(5) });

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [{ type: "text", text: `The ${r.name}.` }],
  };
};
const passages = [
  room("Gatehouse", gatehouse),
  room("Yard", yard),
  room("Wall", wall),
  room("Cellar", cellar),
  room("Barracks", barracks),
];

let state: StateStore;
let record: EventRecord;
let story: Story;
const begin = (at: string, seed = "s") => {
  state = createStore();
  record = createEventRecord(state);
  story = createStory(state, record, passages, { start: at, seed });
  story.begin();
  sentryTurns = 0;
};
beforeEach(() => {
  begin("Cellar");
});
const pass = (n: number) => {
  story.act(wait({ minutes: n }) as unknown as ActionCall);
};
/** What the player was told in the last move, by fuses, daemons, and what they perceived. */
const told = () =>
  record
    .events({ kinds: ["scheduled", "perception", "action-result"] })
    .filter((e) => e.seq > (record.events({ kinds: ["action"] }).at(-1)?.seq ?? -1))
    .map((e) => e.text);
const where = () => placeOf(guard)?.id;

describe("paced turns (#137)", () => {
  it("give a paced NPC a turn at each time in a jump, not one a move", () => {
    expect([isSimulated(sentry), pacingOf(sentry)?.every, getsTurn(sentry)]).toEqual([
      true,
      { minutes: 10 },
      true,
    ]);
    pass(60);
    expect(sentryTurns).toBe(6);
    // A move that takes no time gives them no turn.
    story.goTo("Cellar");
    expect(sentryTurns).toBe(6);
  });

  it("are switched off and on in play, still paced", () => {
    simulate(sentry, false);
    pass(30);
    expect(sentryTurns).toBe(0);
    simulate(sentry);
    pass(30);
    expect(sentryTurns).toBe(3);
  });

  it("are set as the game loads, not in play", () => {
    expect(() => {
      simulate(sentry, { every: minutes(1) });
    }).toThrow("turns are paced in story.ts");
  });

  it("sum up what the player sees of them in one jump, line by line", () => {
    begin("Barracks");
    pass(30);
    expect(told()).toEqual(["The sentry paces past, 3 times.", "You wait 30 minutes."]);
    // Once is told as it is.
    pass(10);
    expect(told()).toEqual(["The sentry paces past.", "You wait ten minutes."]);
  });
});

describe("routes (#137)", () => {
  it("walk the NPC to each place in turn, a step a turn, and round again", () => {
    const seen: (string | undefined)[] = [];
    for (let i = 0; i < 6; i++) {
      pass(5);
      seen.push(where());
    }
    expect(seen).toEqual(["yard", "wall", "yard", "gatehouse", "yard", "wall"]);
  });

  it("stop at a shut door, as anyone would", () => {
    pass(30);
    expect(placeOf(thief)?.id).toBe("yard");
    storeDoor.isOpen = true;
    pass(5);
    expect(placeOf(thief)?.id).toBe("storeroom");
  });

  it("stop the player's wait where the NPC comes into view", () => {
    begin("Wall");
    pass(60);
    // On the wall at ten past ten, and the wait ends there.
    expect([where(), timeOfDay()]).toEqual(["wall", "10:10 pm"]);
    expect(told()).toEqual(
      expect.arrayContaining([
        "The guard arrives from the west.",
        expect.stringMatching(/^Your wait ends at 10:10 pm/),
      ]),
    );
  });

  it("go on through a long jump, the same way every time (determinism)", () => {
    pass(8 * 60);
    // Round and round: four steps a round, 96 turns in eight hours, so back at the gatehouse.
    expect([clock.minutes, where()]).toEqual([480, "gatehouse"]);
    const snapshot = state.snapshot();
    const moves = story.actions;
    begin("Cellar");
    pass(8 * 60);
    expect(state.snapshot()).toEqual(snapshot);
    expect(story.actions).toEqual(moves);
  });
});
