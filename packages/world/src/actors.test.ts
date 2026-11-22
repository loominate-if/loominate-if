import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  StateError,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  actor,
  body,
  bodyOf,
  contents,
  inScope,
  leaveBody,
  mind,
  mindOf,
  move,
  passengersOf,
  place,
  playAs,
  playerBody,
  playerMind,
  possess,
  startAs,
  swapBodies,
  thing,
} from "./index.js";

const hall = place("hall", { name: "the hall" });
const attic = place("attic", { name: "the attic" });

// #region actor
export const mira = actor("mira", {
  body: { name: "Mira", location: hall, strength: 2 },
  mind: { courage: 3 },
});
// #endregion
// #region player
export const you = actor("you", { body: { name: "you", location: hall } });
startAs(you);
// #endregion
const tom = actor("tom", {
  body: { name: "Tom", location: attic },
  mind: {
    mood: "sleepy",
    /** A mind's method sees the actor's other properties through `this`. */
    greet(): string {
      return `${this.name} is ${this.mood}.`;
    },
    /** A getter stays derived: it's never stored. */
    get isAwake(): boolean {
      return this.mood !== "sleepy";
    },
  },
});
// #region minds
export const ghost = mind("ghost", { name: "the ghost", malice: 2 });
export const statue = body("statue", { name: "marble statue", location: hall });
// #endregion
const coin = thing("coin", { name: "silver coin", location: mira });

let store: StateStore;

beforeEach(() => {
  store = createStore();
  newStory(store);
});

function newStory(s: StateStore): void {
  createStory(s, createEventRecord(s), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
}

const ids = (things: readonly { id: string }[]) => things.map((t) => t.id);

/** The player's body, which these tests always have. */
function playerAt() {
  const at = playerBody();
  if (!at) throw new Error("The player has no body.");
  return at;
}

describe("actor", () => {
  it("reads each property from its half", () => {
    expect(mira.courage).toBe(3);
    expect(mira.strength).toBe(2);
    expect(mira.mind.id).toBe("mira:mind");
    expect(mira.body).toBe(mira);
    mira.courage = 4;
    mira.strength = 1;
    expect(store.entity("mira:mind")).toEqual({ courage: 4 });
    expect(store.entity("mira")).toEqual({ strength: 1 });
    expect(tom.greet()).toBe("Tom is sleepy.");
    expect(tom.isAwake).toBe(false);
    tom.mood = "alert";
    expect(tom.isAwake).toBe(true);
    expect(store.entity("tom:mind")).toEqual({ mood: "alert" });
  });

  it("is its body: things go in it, and it moves", () => {
    expect(ids(contents(mira))).toEqual(["coin"]);
    move(mira, attic);
    expect(mira.location?.id).toBe("attic");
    expect(coin.location?.id).toBe("mira");
  });

  it("starts with its mind in control of its body", () => {
    expect(mindOf(mira)?.id).toBe("mira:mind");
    expect(bodyOf(mira)?.id).toBe("mira");
    expect(mindOf(statue)).toBeUndefined();
    expect(bodyOf(ghost)).toBeUndefined();
  });

  it("refuses a key in both halves", () => {
    expect(() =>
      actor("twin", {
        body: { name: "twin", mood: "calm" },
        // @ts-expect-error `mood` is in the body too.
        mind: { mood: "calm" },
      }),
    ).toThrow(
      'actor "twin": "mood" is in both its body and its mind; give one of them another name.',
    );
  });
});

describe("possession", () => {
  it("takes control, and keeps the displaced mind as a passenger", () => {
    const history = createHistory(store);
    // #region possess
    possess(ghost, mira);
    expect(mindOf(mira)?.id).toBe("ghost");
    expect(ids(passengersOf(mira))).toEqual(["mira:mind"]);
    expect(mira.courage).toBe(3); // still Mira's own
    // #endregion
    history.checkpoint("possess");
    history.undo();
    expect(mindOf(mira)?.id).toBe("mira:mind");
    expect(passengersOf(mira)).toEqual([]);
  });

  it("casts the displaced mind out when asked", () => {
    possess(ghost, mira, { displaced: "out" });
    expect(mindOf(mira)?.id).toBe("ghost");
    expect(bodyOf(mira.mind)).toBeUndefined();
    expect(passengersOf(mira)).toEqual([]);
  });

  it("rides along as a passenger, leaving the body's mind in control", () => {
    possess(ghost, mira, { as: "passenger" });
    expect(mindOf(mira)?.id).toBe("mira:mind");
    expect(ids(passengersOf(mira))).toEqual(["ghost"]);
  });

  it("leaves the old body empty, and an empty body can be filled", () => {
    possess(ghost, statue);
    possess(ghost, mira, { displaced: "out" });
    expect(mindOf(statue)).toBeUndefined();
    possess(mira.mind, statue);
    expect(mindOf(statue)?.id).toBe("mira:mind");
    leaveBody(mira.mind);
    expect(mindOf(statue)).toBeUndefined();
  });

  it("swaps two minds' bodies", () => {
    // #region swap
    swapBodies(you, tom);
    expect(mindOf(tom)?.id).toBe("you:mind");
    expect(mindOf(you)?.id).toBe("tom:mind");
    expect(tom.mood).toBe("sleepy"); // the actor's own mind, wherever it is
    // #endregion
  });

  it("survives save and load", () => {
    possess(ghost, mira);
    swapBodies(you, tom);
    const loaded = createStore(store.snapshot());
    newStory(loaded);
    expect(mindOf(mira)?.id).toBe("ghost");
    expect(ids(passengersOf(mira))).toEqual(["mira:mind"]);
    expect(mindOf(tom)?.id).toBe("you:mind");
    expect(playerBody()?.id).toBe("tom");
  });

  it("explains what isn't a mind or a body", () => {
    expect(() => {
      possess(statue, mira);
    }).toThrow(
      'possess "statue" into "mira": "statue" isn\'t a mind. Define it with mind() or actor().',
    );
    expect(() => {
      possess(ghost, hall);
    }).toThrow(
      'possess "ghost" into "hall": "hall" isn\'t a body. Define it with body() or actor().',
    );
    expect(() => mind("lost", { inhabits: hall })).toThrow(
      'mind "lost": it inhabits "hall", which isn\'t a body. Define it with body() or actor().',
    );
    expect(() => mind("rival", { inhabits: mira })).toThrow(
      'mind "rival": "mira:mind" already starts in control of "mira". Give one of them isPassenger: true.',
    );
  });
});

describe("the player", () => {
  it("is whichever mind the player controls, and nothing else is special", () => {
    expect(playerMind().id).toBe("you:mind");
    expect(playerBody()?.id).toBe("you");
    // #region play-as
    playAs(mira);
    expect(playerMind().id).toBe("mira:mind");
    expect(ids(inScope(playerAt(), "see"))).toContain("statue");
    // #endregion
  });

  it("follows the player's mind into another body", () => {
    swapBodies(you, tom);
    expect(playerMind().id).toBe("you:mind");
    expect(playerBody()?.id).toBe("tom");
    expect(ids(inScope(playerAt(), "see"))).toEqual(["attic"]);
  });

  it("is named once", () => {
    expect(() => {
      startAs(mira);
    }).toThrow(StateError);
  });

  it("must be named before it's asked for", async () => {
    vi.resetModules();
    const fresh = await import("./index.js");
    expect(() => fresh.playerMind()).toThrow(
      "playerMind: nobody is the player yet. Call startAs() in story.ts with the mind or actor the player starts as.",
    );
  });
});
