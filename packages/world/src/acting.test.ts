import {
  action,
  createEventRecord,
  createStore,
  createStory,
  perform,
  statusOf,
  type ActionContext,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  connect,
  door,
  lockable,
  mind,
  move,
  place,
  playAs,
  possess,
  startAs,
  thing,
  type Thing,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const cellar = place("cellar", { name: "cellar" });
const cellarDoor = thing("cellarDoor", { ...door, ...lockable, name: "cellar door" });
connect(hall, { down: { to: cellar, via: cellarDoor } });
connect(cellar, { up: { to: hall, via: cellarDoor } });
const barrel = thing("barrel", { name: "barrel", location: cellar });
const you = actor("you", { body: { name: "you", location: hall } });
const ghost = mind("ghost", { name: "ghost" });
startAs(you);

/** Who acted, as each action's rules saw it. */
const seen: string[] = [];
// #region kick
export const kick = action<{ thing: Thing }>("kick", {
  run: (c: ActionContext<{ thing: Thing }>) => {
    seen.push(`${c.actor?.id ?? "-"} in ${c.body?.id ?? "-"} kicks ${c.thing.id}`);
  },
  report: "Thud.",
});
// #endregion

beforeEach(() => {
  seen.length = 0;
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

describe("actions in the world", () => {
  it("record the acting mind and body", () => {
    perform(kick({ thing: cellarDoor }));
    possess(ghost, you);
    playAs(ghost);
    perform(kick({ thing: cellarDoor }));
    expect(seen).toEqual(["you:mind in you kicks cellarDoor", "ghost in you kicks cellarDoor"]);
  });

  it("aren't offered for things out of reach", () => {
    expect(statusOf(kick({ thing: barrel })).hidden).toBe("The barrel is out of reach.");
    move(you, cellar);
    expect(statusOf(kick({ thing: barrel })).hidden).toBeUndefined();
    // The door belongs to both rooms it joins, so it's in reach from either.
    expect(statusOf(kick({ thing: cellarDoor })).hidden).toBeUndefined();
  });

  it("aren't offered to a mind with no body", () => {
    playAs(ghost); // in no body
    expect(statusOf(kick({ thing: cellarDoor })).hidden).toBe("You have no body to act with.");
  });
});
