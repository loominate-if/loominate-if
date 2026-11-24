// Gate 2's walkthroughs (ADR 0027): containment, the locked gate shown
// disabled with its reason in menus and the compass, unlocking it, and the
// toll keeper, who reacts through rules; then save, load, undo, and replay.
// #region setup
import { play } from "@loominate-if/testing";
import { describe, expect, it } from "vitest";
import { coin, gate, gateKey, keeper, pass, satchel, strongbox, you } from "./story.js";

/** Plays from the road into the tollhouse, with the pebble from the road. */
const arrive = (seed?: string) =>
  play(seed === undefined ? {} : { seed })
    .act("Take the river pebble")
    .choose("East");

/** Pays the toll as the keeper wants it: the pass, then the coin. */
const pay = (seed?: string) =>
  arrive(seed)
    .act("Show the travel pass to the toll keeper")
    .act("Give the silver coin to the toll keeper");
// #endregion

describe("The Tollhouse", () => {
  it("starts on the road, with a satchel holding a coin and a pass", () => {
    const game = play();
    expect(game.passage).toBe("Road");
    expect(game.text).toContain(
      "You carry a satchel, which holds a silver coin and a travel pass.",
    );
    expect([satchel.location?.id, coin.location?.id, pass.location?.id]).toEqual([
      you.id,
      satchel.id,
      satchel.id,
    ]);
    // The key is in the strongbox, which is shut, so it isn't listed.
    expect(gateKey.location?.id).toBe(strongbox.id);
    expect(arrive().text).toContain("The toll keeper sits by a strongbox, shut tight.");
  });

  it("shows the gate locked, with why, in its menu, the compass, and the way north", () => {
    // #region locked
    const game = arrive();
    expect(game.menu(gate)).toEqual([
      { label: "Examine the toll gate" },
      { label: "Open the toll gate", disabled: "The toll gate is locked." },
      { label: "Unlock the toll gate", disabled: "You need the iron key." },
    ]);
    expect(game.compass?.find((w) => w.direction === "north")).toEqual({
      direction: "north",
      label: "N",
      title: "North",
      available: false,
      reason: "The toll gate is locked.",
    });
    expect(game.unavailable).toContainEqual(
      expect.objectContaining({ label: "North", reason: "The toll gate is locked.", shown: true }),
    );
    // #endregion
    // The strongbox's key is round the keeper's neck, out of reach.
    expect(game.menu(strongbox)).toContainEqual({
      label: "Unlock the strongbox",
      disabled: "You need the little brass key.",
    });
  });

  it("has a keeper who reacts, through rules, to what you show and give them", () => {
    // #region keeper
    const game = arrive();
    game.act("Give the river pebble to the toll keeper");
    expect(game.notices).toBe("The toll keeper doesn't want the river pebble.");
    game.act("Give the silver coin to the toll keeper");
    expect(game.notices).toBe("“Pass first,” says the keeper, pushing the coin back.");
    expect(coin.location?.id).toBe(satchel.id);
    game.act("Show the travel pass to the toll keeper");
    expect(game.notices).toBe("“All in order,” says the keeper. “Toll's one silver coin.”");
    game.act("Give the silver coin to the toll keeper");
    expect(game.notices).toBe(
      "The keeper bites the coin, unlocks the strongbox, and opens it. “Key's inside.”",
    );
    // #endregion
    expect([coin.location?.id, keeper.isPaid, strongbox.isOpen]).toEqual([keeper.id, true, true]);
    expect(game.text).toContain("a strongbox, open, holding an iron key.");
    expect(pass.location?.id).toBe(satchel.id);
  });

  it("opens the way north once the gate's unlocked, to the far bank", () => {
    const game = pay().act("Take the iron key").act("Unlock the toll gate");
    expect(gate.isLocked).toBe(false);
    const north = () => game.compass?.find((w) => w.direction === "north");
    // Unlocked isn't open: the gate still bars the way, saying so.
    expect(north()).toMatchObject({ available: false, reason: "The toll gate is closed." });
    game.act("Open the toll gate");
    expect(north()?.available).toBe(true);
    game.choose("North");
    expect(game.passage).toBe("Bridge");
    game.choose("North");
    expect(game.passage).toBe("Far Bank");
    expect(game.text).toContain("The road goes on, and so do you.");
  });

  it("undoes paying the toll, and everything the keeper did", () => {
    const game = pay();
    game.undo();
    expect([coin.location?.id, keeper.isPaid, strongbox.isLocked, strongbox.isOpen]).toEqual([
      satchel.id,
      false,
      true,
      false,
    ]);
    expect(keeper.hasSeenPass).toBe(true);
  });

  it("carries on exactly from a save, without the keeper reacting again", () => {
    const game = pay().act("Take the iron key");
    const saved = game.store.snapshot();
    const loaded = play({ from: saved });
    expect(loaded.passage).toBe("Tollhouse");
    void loaded.text;
    expect(loaded.store.snapshot()).toEqual(saved);
    expect([gateKey.location?.id, coin.location?.id]).toEqual([you.id, keeper.id]);
    loaded.act("Unlock the toll gate").act("Open the toll gate").choose("North");
    expect(loaded.passage).toBe("Bridge");
  });

  it("replays exactly, from the seed and the moves", () => {
    const moves = (seed: string) => pay(seed).act("Take the iron key").act("Unlock the toll gate");
    const game = moves("ferry");
    const replay = game.replay();
    const snapshot = game.store.snapshot();
    const fresh = moves("ferry");
    expect(fresh.replay()).toEqual(replay);
    expect(fresh.store.snapshot()).toEqual(snapshot);
  });
});
