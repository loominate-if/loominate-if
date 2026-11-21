import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  StateError,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  canHear,
  canReach,
  canSee,
  container,
  contents,
  inScope,
  isInLight,
  isWithin,
  lightSource,
  lockable,
  move,
  openable,
  place,
  placeOf,
  surface,
  thing,
  transparent,
} from "./index.js";

// Defined out of ID order, to show that results are sorted by ID, not by definition.
// #region places
const hall = place("hall", { name: "the hall" });
const study = place("study", { name: "the study" });
const cellar = place("cellar", { name: "the cellar", isDark: true });
// #endregion

const player = thing("player", { ...container, name: "you", location: study });
// #region things
const table = thing("table", { ...surface, name: "oak table", location: study });
const coin = thing("coin", { name: "silver coin", location: table });
const box = thing("box", { ...container, ...openable, name: "tin box", location: study });
const gem = thing("gem", { name: "green gem", location: box });
const clock = thing("clock", { name: "ticking clock", location: box });
const caseOf = thing("case", {
  ...container,
  ...openable,
  ...transparent,
  name: "glass case",
  location: study,
});
const ring = thing("ring", { name: "gold ring", location: caseOf });
// #endregion
const wardrobe = thing("wardrobe", {
  ...container,
  ...openable,
  name: "wardrobe",
  location: study,
});
const coat = thing("coat", { name: "old coat", location: wardrobe });
const lamp = thing("lamp", { ...lightSource, name: "brass lamp", location: hall });
// #region chest
const chest = thing("chest", {
  ...container,
  ...openable,
  ...lockable,
  name: "oak chest",
  location: cellar,
  /** A method of its own, beside the mixins'. */
  describe(): string {
    return `${this.name}, ${this.isOpen ? "open" : "closed"}${this.isLocked ? " and locked" : ""}`;
  },
});
// #endregion
const rat = thing("rat", { name: "rat", location: cellar });

let store: StateStore;

beforeEach(() => {
  // Each test plays a new story, so objects start from their definitions.
  store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

const ids = (things: readonly { id: string }[]) => things.map((t) => t.id);

describe("containment", () => {
  it("lists what's in or on a thing, sorted by ID", () => {
    expect(ids(contents(study))).toEqual(["box", "case", "player", "table", "wardrobe"]);
    expect(ids(contents(table))).toEqual(["coin"]);
    expect(placeOf(coin)?.id).toBe("study");
    expect(placeOf(study)?.id).toBe("study");
    expect(isWithin(coin, study)).toBe(true);
    expect(isWithin(coin, box)).toBe(false);
  });

  it("moves a thing with one change, which undo takes back", () => {
    const history = createHistory(store);
    move(coin, player);
    history.checkpoint("take coin");
    expect(coin.location?.id).toBe("player");
    expect(ids(contents(player))).toEqual(["coin"]);
    expect(ids(contents(table))).toEqual([]);
    expect(store.entity("coin")).toEqual({ location: { $ref: "player" } });
    history.undo();
    expect(coin.location?.id).toBe("table");
  });

  it("moves things out of the world and back", () => {
    move(gem, null);
    expect(gem.location).toBeNull();
    expect(placeOf(gem)).toBeUndefined();
    move(gem, table);
    expect(ids(contents(table))).toEqual(["coin", "gem"]);
  });

  it("explains moves that make no sense", () => {
    expect(() => {
      move(box, gem);
    }).toThrow(
      'move "box" to "gem": it can\'t hold things. Spread container or surface into its definition.',
    );
    expect(() => {
      move(box, box);
    }).toThrow('move "box" to "box": that would put it inside itself.');
    move(box, player);
    expect(() => {
      move(player, box);
    }).toThrow('move "player" to "box": that would put it inside itself.');
    expect(() => {
      move(study, hall);
    }).toThrow(StateError);
    expect(() => {
      move({ id: "ghost" }, hall);
    }).toThrow('move "ghost": it isn\'t defined with thing() or place().');
  });
});

describe("mixins", () => {
  it("compose without a class hierarchy: a container that opens and locks", () => {
    expect(chest.describe()).toBe("oak chest, closed and locked");
    expect(chest.open()).toBe(false);
    chest.unlock();
    expect(chest.open()).toBe(true);
    expect(chest.lock()).toBe(false);
    chest.close();
    expect(chest.lock()).toBe(true);
    expect(chest.describe()).toBe("oak chest, closed and locked");
  });

  it("give each thing only what it spreads in", () => {
    expect("isOpen" in table).toBe(false);
    expect(box.isOpen).toBe(false);
    expect(lamp.isLit).toBe(false);
    lamp.light();
    expect(store.entity("lamp")).toEqual({ isLit: true });
  });
});

describe("scope", () => {
  it("sees what's in the place, on surfaces, and in transparent or open containers", () => {
    expect(ids(inScope(player, "see"))).toEqual([
      "box",
      "case",
      "coin",
      "ring",
      "study",
      "table",
      "wardrobe",
    ]);
    expect(canSee(player, gem)).toBe(false);
    box.open();
    expect(canSee(player, gem)).toBe(true);
    expect(canSee(player, clock)).toBe(true);
  });

  it("reaches what it can see, except behind closed glass", () => {
    // #region scope
    expect(canSee(player, ring)).toBe(true);
    expect(canReach(player, ring)).toBe(false);
    expect(canReach(player, coin)).toBe(true);
    caseOf.open();
    expect(canReach(player, ring)).toBe(true);
    // #endregion
  });

  it("hears through closed containers, but not into another place", () => {
    expect(canHear(player, clock)).toBe(true);
    expect(canSee(player, clock)).toBe(false);
    expect(canHear(player, lamp)).toBe(false);
    expect(canSee(player, lamp)).toBe(false);
  });

  it("includes what the observer carries, but not the observer", () => {
    move(coin, player);
    expect(ids(inScope(player, "reach"))).toContain("coin");
    expect(ids(inScope(player, "reach"))).not.toContain("player");
    expect(canSee(player, player)).toBe(true);
  });

  it("from inside a closed container, senses only what's in it, and hears the room", () => {
    move(player, wardrobe);
    wardrobe.close();
    expect(ids(inScope(player, "reach"))).toEqual(["coat", "wardrobe"]);
    expect(canReach(player, coat)).toBe(true);
    expect(canSee(player, table)).toBe(false);
    expect(canHear(player, table)).toBe(true);
    // Shut in the dark, the player sees nothing, though the study is lit.
    expect(isInLight(player)).toBe(false);
    expect(ids(inScope(player, "see"))).toEqual([]);
  });
});

describe("light", () => {
  it("sees nothing in a dark place until a light source is lit", () => {
    // #region light
    move(player, cellar);
    move(lamp, cellar);
    expect(isInLight(player)).toBe(false);
    expect(ids(inScope(player, "see"))).toEqual([]);
    expect(canReach(player, rat)).toBe(true);
    lamp.light();
    expect(isInLight(player)).toBe(true);
    expect(ids(inScope(player, "see"))).toEqual(["cellar", "chest", "lamp", "rat"]);
    // #endregion
  });

  it("is lit by a lamp the observer carries, and not by one shut in a box", () => {
    move(player, cellar);
    lamp.light();
    move(lamp, player);
    expect(canSee(player, rat)).toBe(true);
    chest.unlock();
    chest.open();
    move(lamp, chest);
    expect(canSee(player, rat)).toBe(true);
    chest.close();
    expect(isInLight(player)).toBe(false);
    expect(canSee(player, lamp)).toBe(false);
  });

  it("isn't lit by a lamp in a closed box, which lights only the box", () => {
    move(player, cellar);
    move(lamp, cellar);
    lamp.light();
    move(rat, chest);
    chest.unlock();
    chest.open();
    move(lamp, chest);
    chest.close();
    // The lamp lights the inside of the chest, not the cellar.
    expect(canSee(player, lamp)).toBe(false);
    expect(ids(inScope(player, "see"))).toEqual([]);
  });

  it("is lit by a lamp behind glass, since light passes where sight does", () => {
    const lantern = thing("lantern", {
      ...lightSource,
      name: "lantern",
      isLit: true,
      location: caseOf,
    });
    move(player, cellar);
    move(caseOf, cellar);
    expect(canSee(player, rat)).toBe(true);
    expect(canSee(player, lantern)).toBe(true);
    expect(canReach(player, lantern)).toBe(false);
  });

  it("needs no light to reach or hear", () => {
    move(player, cellar);
    expect(canSee(player, rat)).toBe(false);
    expect(canReach(player, rat)).toBe(true);
    expect(canHear(player, rat)).toBe(true);
  });
});
