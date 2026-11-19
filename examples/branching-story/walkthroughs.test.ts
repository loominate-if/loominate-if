// Gate 1's walkthroughs: the story played to each ending, with the features
// it uses checked along the way (ADR 0027).
import { play } from "@loominate-if/testing";
import { describe, expect, it } from "vitest";
import { keeper, lamp, night, SHIPS } from "./story.js";

/** Plays from the start to the cottage, past the opening's page break and beat. */
const arrive = (seed?: string) =>
  play(seed === undefined ? {} : { seed })
    .advance()
    .advance()
    .choose("Begin");

describe("The Last Watch", () => {
  it("opens over two pages, with a pause before the first choice", () => {
    const game = play();
    expect(game.text).toBe(
      "The supply boat left you here in October, with a crate of oil, a crate of tins, and the promise that someone would come back in spring.",
    );
    expect(game.beat).toEqual({ type: "beat", page: true });
    game.advance();
    // The page break clears the first page; the timed beat holds back the last line.
    expect(game.text).toMatch(/^Tonight the wind has a voice\./);
    expect(game.beat).toEqual({ type: "beat", duration: 1500 });
    expect(game.choices).toEqual([]);
    game.advance();
    expect(game.text).toContain("It is time to light the lamp.");
    expect(game.choices).toEqual(["Begin"]);
  });

  it("keeps the lamp dark until the matches are found, and says why", () => {
    const game = arrive().choose("Climb the tower");
    expect(game.text).toContain("A hundred and twelve steps to the top.");
    expect(game.choices).toEqual(["Go back down"]);
    expect(game.unavailable).toEqual([
      {
        label: "Light the lamp",
        condition: "keeper.hasMatches",
        reason: "Your pockets are empty. The matches are in the shed.",
        shown: true,
      },
    ]);
    game.choose("Go back down").choose("supply shed");
    expect(keeper.hasMatches).toBe(true);
    expect(game.text).toContain("you find a tin of matches");
    game.choose("Back to the cottage");
    expect(game.text).toMatch(/^The cottage is as you left it\./);
    game.choose("Climb the tower");
    expect(game.text).toContain("The steps again, slick with damp.");
    expect(game.choices).toEqual(["Light the lamp", "Go back down"]);
  });

  it("ends at dawn when the keeper signals the ship", () => {
    const game = arrive().choose("supply shed").choose("Back to the cottage");
    game.choose("Climb the tower").choose("Light the lamp");
    expect(lamp.lit).toBe(true);
    expect(game.text).toContain(`Far out, a ship's lights: ${night.ship}`);
    expect(game.choices).toEqual(["Signal the ship", "Write in the log", "Sleep until morning"]);

    game.choose("Signal the ship");
    expect(night.signalled).toBe(true);
    // The ship turns only once the pause is over: an effect written after a beat.
    expect(night.turned).toBe(false);
    game.advance();
    expect(night.turned).toBe(true);
    expect(game.text).toContain("the ship's lights swing away to the south");
    expect(game.beat).toEqual({ type: "beat" });
    game.advance().choose("Back to the lamp");

    // Signalling is now shown disabled, and sleeping leads to the good ending.
    expect(game.unavailable.map((u) => [u.label, u.shown])).toContainEqual([
      "Signal the ship",
      true,
    ]);
    game.choose("Sleep until morning");
    expect(game.passage).toBe("Dawn");
    expect(game.text).toContain(`${night.ship}, safe.`);
    expect(game.choices).toEqual([]);
  });

  it("ends in a wreck when the keeper sleeps without signalling", () => {
    const game = arrive().choose("supply shed").choose("Back to the cottage");
    game.choose("Climb the tower").choose("Light the lamp").choose("Sleep until morning");
    expect(game.passage).toBe("Wreck");
    expect(game.text).toContain(`It reads ${night.ship}.`);
  });

  it("ends by the hearth when the keeper climbs, then loses their nerve", () => {
    const game = arrive();
    expect(game.choices).toEqual(["supply shed", "Climb the tower"]);
    game.choose("Climb the tower").choose("Go back down");
    // Hidden until the keeper has been up the stairs.
    expect(game.choices).toEqual(["supply shed", "Climb the tower", "Stay by the fire"]);
    game.choose("Stay by the fire");
    expect(game.passage).toBe("Hearth");
    expect(lamp.lit).toBe(false);
  });

  it("burns oil each time the keeper leaves the lamp room, and logs it", () => {
    const game = arrive().choose("supply shed").choose("Back to the cottage");
    game.choose("Climb the tower").choose("Light the lamp");
    game.choose("Write in the log");
    expect(game.text).toContain("Entry 1:");
    expect(game.text).toContain("Oil for 2 nights.");
    game.choose("Continue").choose("Write in the log");
    expect(game.text).toContain("Entry 2:");
    expect(game.text).toContain("Oil for 1 night.");
    expect(lamp.oil).toBe(1);
    expect(night.logEntries).toBe(2);
  });

  it("undoes a move, and the effects it ran", () => {
    const game = arrive().choose("supply shed").choose("Back to the cottage");
    game.choose("Climb the tower").choose("Light the lamp");
    expect(lamp.lit).toBe(true);
    game.undo();
    expect(game.passage).toBe("Stairs");
    expect(lamp.lit).toBe(false);
  });

  it("carries on exactly from a save, without running effects again", () => {
    const game = arrive().choose("supply shed").choose("Back to the cottage");
    game.choose("Climb the tower").choose("Light the lamp").choose("Write in the log");
    const saved = game.store.snapshot();
    const loaded = play({ from: saved });
    expect(loaded.passage).toBe("Log");
    // Loading, and drawing the passage again and again, runs none of its effects.
    void loaded.text;
    void loaded.text;
    expect(night.logEntries).toBe(1);
    expect(lamp.oil).toBe(2);
    expect(loaded.store.snapshot()).toEqual(saved);
    loaded.choose("Continue");
    expect(loaded.text).toContain(night.ship);
  });

  it("chooses the ship from the seed, the same every time, and replays exactly", () => {
    const ship = (seed: string) => {
      arrive(seed);
      return night.ship;
    };
    expect(SHIPS).toContain(ship("stormy"));
    expect(ship("stormy")).toBe(ship("stormy"));
    expect(new Set(["a", "b", "c", "d", "e", "f"].map(ship)).size).toBeGreaterThan(1);

    const game = arrive("stormy").choose("supply shed").choose("Back to the cottage");
    game.choose("Climb the tower").choose("Light the lamp").choose("Signal the ship").skip();
    const replay = game.replay();
    const snapshot = game.store.snapshot();
    const fresh = arrive("stormy").choose("supply shed").choose("Back to the cottage");
    fresh.choose("Climb the tower").choose("Light the lamp").choose("Signal the ship").skip();
    expect(fresh.replay()).toEqual(replay);
    expect(fresh.store.snapshot()).toEqual(snapshot);
  });
});
