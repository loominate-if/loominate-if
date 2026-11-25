/** Shareable seeds (#132): memorable words, tied to the game's version. */
import { createEventRecord, createStore, createStory, randomStream } from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { _SEED_WORDS } from "./seed-words.js";
import { _dailySeed, _freshWordSeed, _parseSeed, _sharedSeed } from "./seed.js";

describe("seed words (#132)", () => {
  it("are distinct, short, lowercase words, enough for millions of seeds", () => {
    expect(new Set(_SEED_WORDS).size).toBe(_SEED_WORDS.length);
    expect(_SEED_WORDS.every((w) => /^[a-z]{2,9}$/.test(w))).toBe(true);
    expect(_SEED_WORDS.length ** 3).toBeGreaterThan(100_000_000);
  });

  it("make a seed of three words, drawing again past the last whole multiple", () => {
    const words = ["amber", "lantern", "fog"];
    const draws = [2 ** 32 - 1, 0, 4, 2];
    expect(_freshWordSeed(words, () => draws.shift() ?? 0)).toBe("amber-lantern-fog");
  });

  it("give the same seed all day, and another the next", () => {
    expect(_dailySeed(_SEED_WORDS, "2026-11-25")).toBe(_dailySeed(_SEED_WORDS, "2026-11-25"));
    expect(_dailySeed(_SEED_WORDS, "2026-11-25")).not.toBe(_dailySeed(_SEED_WORDS, "2026-11-26"));
    expect(_dailySeed(_SEED_WORDS, "2026-11-25")).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it("are shared with the version, and read back however they're typed", () => {
    expect(_sharedSeed("amber-lantern-fog", "1.2.0")).toBe("amber-lantern-fog@1.2.0");
    expect(_parseSeed("amber-lantern-fog@1.2.0")).toEqual({
      seed: "amber-lantern-fog",
      version: "1.2.0",
    });
    expect(_parseSeed("  Amber Lantern  fog ")).toEqual({ seed: "amber-lantern-fog" });
    expect(_parseSeed(" @1.0")).toBeUndefined();
  });
});

describe("the same seed and version (#132)", () => {
  const roll = randomStream("seed-test-world");
  const world = (seed: string) => {
    const store = createStore();
    const drawn: number[] = [];
    createStory(
      store,
      createEventRecord(store),
      [
        {
          id: "Start",
          tags: [],
          effects: {
            enter: () => {
              for (let i = 0; i < 5; i++) drawn.push(roll.int(1, 1000));
            },
          },
          body: () => [{ type: "text", text: "A world." }],
        },
      ],
      { start: "Start", seed },
    ).begin();
    return drawn;
  };

  it("gives the same world, from the seed as it's shared", () => {
    const shared = _parseSeed(_sharedSeed("amber-lantern-fog", "1.0.0"))?.seed ?? "";
    expect(world(shared)).toEqual(world("amber-lantern-fog"));
    expect(world("amber-lantern-fog")).not.toEqual(world("amber-lantern-moss"));
  });
});
