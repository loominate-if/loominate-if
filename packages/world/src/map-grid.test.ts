/** Rooms on a grid by compass direction (#426). */
import { describe, expect, it } from "vitest";
import { gridLayout, type GridExit } from "./map-grid.js";

const cells = (layout: ReturnType<typeof gridLayout>) =>
  Object.fromEntries([...layout.cells].map(([id, c]) => [id, [c.x, c.y]]));

describe("gridLayout", () => {
  it("puts each room one step from the start in its exit's direction, north up", () => {
    const exits: GridExit[] = [
      { from: "hall", to: "library", direction: "north" },
      { from: "hall", to: "kitchen", direction: "east" },
      { from: "hall", to: "porch", direction: "southwest" },
      { from: "library", to: "hall", direction: "south" },
    ];
    const layout = gridLayout(["kitchen", "hall", "library", "porch"], exits, "hall");
    expect(cells(layout)).toEqual({
      hall: [0, 0],
      library: [0, -1],
      kitchen: [1, 0],
      porch: [-1, 1],
    });
    expect([...layout.bent]).toEqual([]);
    expect(layout.nudged).toEqual([]);
  });

  it("places a room reached only by an exit into it, from the other side", () => {
    const layout = gridLayout(
      ["hall", "yard"],
      [{ from: "yard", to: "hall", direction: "west" }],
      "hall",
    );
    expect(cells(layout)).toEqual({ hall: [0, 0], yard: [1, 0] });
  });

  it("nudges a room whose cell is taken, and bends its exit", () => {
    const exits: GridExit[] = [
      { from: "hall", to: "library", direction: "north" },
      { from: "hall", to: "study", direction: "east" },
      { from: "study", to: "attic", direction: "northwest" },
    ];
    const layout = gridLayout(["hall", "library", "study", "attic"], exits, "hall");
    expect(layout.nudged).toEqual(["attic"]);
    expect(layout.bent).toEqual(new Set([2]));
    expect(new Set(Object.values(cells(layout)).map(String)).size).toBe(4);
  });

  it("puts rooms by up, in, and a game's own directions nearby, bent", () => {
    const exits: GridExit[] = [
      { from: "deck", to: "hold", direction: "down" },
      { from: "deck", to: "bow", direction: "fore" },
    ];
    const layout = gridLayout(["deck", "hold", "bow"], exits, "deck");
    expect(cells(layout).deck).toEqual([0, 0]);
    expect(layout.bent).toEqual(new Set([0, 1]));
    expect(new Set(Object.values(cells(layout)).map(String)).size).toBe(3);
  });

  it("lays out rooms not reached from the start to the right", () => {
    const layout = gridLayout(
      ["hall", "library", "island", "shore"],
      [
        { from: "hall", to: "library", direction: "east" },
        { from: "island", to: "shore", direction: "south" },
      ],
      "hall",
    );
    expect(cells(layout)).toEqual({ hall: [0, 0], library: [1, 0], island: [3, 0], shore: [3, 1] });
  });

  it("gives the same layout for the same rooms and exits", () => {
    const exits: GridExit[] = [
      { from: "a", to: "b", direction: "north" },
      { from: "a", to: "c", direction: "north" },
      { from: "c", to: "d", direction: "up" },
    ];
    expect(cells(gridLayout(["a", "b", "c", "d"], exits, "a"))).toEqual(
      cells(gridLayout(["a", "b", "c", "d"], exits, "a")),
    );
  });

  it("puts pinned rooms in their cells, fitting the rest around them", () => {
    const exits: GridExit[] = [
      { from: "hall", to: "library", direction: "north" },
      { from: "library", to: "attic", direction: "up" },
      { from: "hall", to: "yard", direction: "east" },
    ];
    const layout = gridLayout(
      ["hall", "library", "attic", "yard"],
      exits,
      "hall",
      new Map([
        ["attic", { x: 0, y: -2 }],
        ["yard", { x: 3, y: 0 }],
      ]),
    );
    expect(cells(layout)).toEqual({ hall: [0, 0], library: [0, -1], attic: [0, -2], yard: [3, 0] });
    // The pinned rooms aren't nudged; the east exit doesn't run one step, so it's bent.
    expect(layout.nudged).toEqual([]);
    expect(layout.bent).toEqual(new Set([1, 2]));
  });

  it("walks on from a pinned room that the start doesn't reach", () => {
    const layout = gridLayout(
      ["hall", "island", "shore"],
      [{ from: "island", to: "shore", direction: "south" }],
      "hall",
      new Map([["island", { x: 5, y: 5 }]]),
    );
    expect(cells(layout)).toEqual({ hall: [0, 0], island: [5, 5], shore: [5, 6] });
  });
});
