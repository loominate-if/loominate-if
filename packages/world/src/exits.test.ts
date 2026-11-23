import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type StateStore,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import extension from "./extension.js";
import {
  actor,
  blockedReason,
  canReach,
  canSee,
  connect,
  direction,
  door,
  enterRoom,
  exitLinks,
  exitsOf,
  inScope,
  lockable,
  move,
  obstacle,
  place,
  registerRoom,
  setExit,
  startAs,
  thing,
} from "./index.js";

// #region directions
declare module "@loominate-if/world" {
  interface Directions {
    fore: true;
    aft: true;
  }
}
direction("fore", { opposite: "aft", label: "Fore" });
direction("aft", { opposite: "fore", label: "Aft" });
// #endregion

// #region connect
export const hall = place("hall", { name: "hall" });
export const library = place("library", { name: "library" });
export const cellar = place("cellar", { name: "cellar" });
export const cellarDoor = thing("cellarDoor", { ...door, ...lockable, name: "cellar door" });

connect(hall, {
  north: library,
  down: { to: cellar, via: cellarDoor },
});
connect(library, { south: { to: hall, minutes: 1 } });
connect(cellar, { up: { to: hall, via: cellarDoor } });
// #endregion

const deck = place("deck", { name: "deck" });
const hold = place("hold", { name: "hold" });
const bow = place("bow", { name: "bow" });
// #region obstacle
export const rubble = thing("rubble", {
  ...obstacle,
  name: "heap of rubble",
  isCleared: false,
  blocks() {
    return this.isCleared ? undefined : "Rubble blocks the way.";
  },
});
// #endregion
connect(deck, { fore: bow, down: { to: hold, via: rubble } });
connect(bow, { aft: deck });
connect(hold, {});

const you = actor("you", { body: { name: "you", location: hall } });
startAs(you);

// What the `room:` tag registers when a game loads.
for (const [room, id] of [
  [hall, "Hall"],
  [library, "Library"],
  [cellar, "Cellar"],
  [deck, "Deck"],
  [bow, "Bow"],
  [hold, "Hold"],
] as const) {
  registerRoom(room, { id, tags: [`room: ${room.id}`] });
}

let store: StateStore;
beforeEach(() => {
  store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

const summary = () =>
  exitLinks().map((l) =>
    l.guard ? `${l.label} -> ${l.target} [${l.guard.reason ?? ""}]` : `${l.label} -> ${l.target}`,
  );

describe("exits", () => {
  it("are listed in direction order, with where they go and how long they take", () => {
    expect(exitsOf(hall).map((e) => `${e.direction.name} ${e.to.id} ${e.via?.id ?? "-"}`)).toEqual([
      "north library -",
      "down cellar cellarDoor",
    ]);
    expect(exitsOf(library)[0]?.minutes).toBe(1);
    expect(exitsOf(place("attic", { name: "attic" }))).toEqual([]);
  });

  it("become links, disabled with a locked door's reason", () => {
    // #region links
    expect(summary()).toEqual(["North -> Library", "Down -> Cellar [The cellar door is locked.]"]);
    cellarDoor.unlock();
    expect(summary()).toEqual(["North -> Library", "Down -> Cellar [The cellar door is closed.]"]);
    cellarDoor.open();
    expect(summary()).toEqual(["North -> Library", "Down -> Cellar"]);
    // #endregion
  });

  it("name rooms the player has visited", () => {
    enterRoom(library);
    enterRoom(hall);
    expect(summary()[0]).toBe("North, to the library -> Library");
  });

  it("can use a game's own directions, and an obstacle of its own", () => {
    move(you, deck);
    expect(summary()).toEqual(["Down -> Hold [Rubble blocks the way.]", "Fore -> Bow"]);
    const down = exitsOf(deck).find((e) => e.direction.name === "down");
    expect(down && blockedReason(down, you)).toBe("Rubble blocks the way.");
    rubble.isCleared = true;
    expect(down && blockedReason(down, you)).toBeUndefined();
    expect(summary()).toEqual(["Down -> Hold", "Fore -> Bow"]);
  });

  it("change during play, and undo takes the change back", () => {
    const history = createHistory(store);
    setExit(hall, "north", null);
    setExit(hall, "east", { to: library, minutes: 3 });
    history.checkpoint("collapse");
    expect(exitsOf(hall).map((e) => e.direction.name)).toEqual(["east", "down"]);
    history.undo();
    expect(exitsOf(hall).map((e) => e.direction.name)).toEqual(["north", "down"]);
  });

  it("explain what's wrong with them", () => {
    expect(() => {
      connect(hall, {});
    }).toThrow(
      'connect "hall": its exits are already declared. Connect each room once, and change exits during play with setExit().',
    );
    expect(() => {
      connect(you, {});
    }).toThrow('connect "you": it isn\'t a place. Define it with place().');
    expect(() => {
      // @ts-expect-error `sideways` isn't a direction.
      connect(place("loft", { name: "loft" }), { sideways: hall });
    }).toThrow('connect "loft": there\'s no direction "sideways". Register it with direction().');
    expect(() => {
      setExit(place("shed", { name: "shed" }), "north", hall);
    }).toThrow(
      'setExit "shed" north: the room was never connected. Call connect(shed, {…}) in story.ts, even with no exits.',
    );
    expect(() => direction("north")).toThrow('direction "north" is already registered.');
  });
});

describe("doors", () => {
  it("are in scope from both rooms they join", () => {
    expect(canSee(you, cellarDoor)).toBe(true);
    expect(canReach(you, cellarDoor)).toBe(true);
    move(you, cellar);
    expect(canReach(you, cellarDoor)).toBe(true);
    move(you, library);
    expect(inScope(you, "reach").map((t) => t.id)).not.toContain("cellarDoor");
  });

  it("open for both sides at once", () => {
    cellarDoor.unlock();
    cellarDoor.open();
    move(you, cellar);
    expect(summary()).toEqual(["Up -> Hall"]);
  });
});

describe("rooms with several passages", () => {
  const run = (passages: { name: string; tags: string[] }[]) =>
    extension.checks[0]?.run({
      files: [
        {
          file: "rooms.weft",
          passages: passages.map((p) => ({
            name: { name: p.name },
            tags: p.tags.map((t, i) => {
              const [name, value] = t.split(": ");
              return {
                name: name ?? t,
                ...(value !== undefined && { value }),
                span: { start: i, end: i + 1 },
              };
            }),
          })),
        },
      ],
      isNamed: () => false,
      uses: () => [],
    });

  it("need one passage tagged arrive", () => {
    expect(run([{ name: "Hall", tags: ["room: hall"] }])).toEqual([]);
    expect(
      run([
        { name: "Hall", tags: ["room: hall", "arrive"] },
        { name: "Hall at Night", tags: ["room: hall"] },
      ]),
    ).toEqual([]);
    expect(
      run([
        { name: "Hall", tags: ["room: hall"] },
        { name: "Hall at Night", tags: ["room: hall"] },
      ])?.map((p) => p.message),
    ).toEqual([
      'The room `hall` is described by 2 passages, "Hall", "Hall at Night". Tag the one its exits lead to with `arrive`, as in `[room: hall, arrive]`.',
      'The room `hall` is described by 2 passages, "Hall", "Hall at Night". Tag the one its exits lead to with `arrive`, as in `[room: hall, arrive]`.',
    ]);
  });
});

describe("rooms no exit leads to (#72)", () => {
  type Use = {
    readonly file: string;
    readonly call?: { readonly callee: string; readonly argument: number };
  };
  const check = (
    rooms: Record<string, string>,
    uses: Record<string, Use[]>,
    options: { start?: string; named?: string[] } = {},
  ) =>
    extension.checks[1]?.run({
      files: [
        {
          file: "rooms.weft",
          passages: Object.entries(rooms).map(([passage, room], i) => ({
            name: { name: passage },
            tags: [{ name: "room", value: room, span: { start: i * 10, end: i * 10 + 5 } }],
          })),
        },
      ],
      ...(options.start !== undefined && { start: options.start }),
      isNamed: (name: string) => options.named?.includes(name) ?? false,
      uses: (name: string) => uses[name] ?? [],
    });
  const from = { file: "story.ts", call: { callee: "connect", argument: 0 } };
  const to = { file: "story.ts", call: { callee: "connect", argument: 1 } };

  it("warn at the room tag when nothing leads in", () => {
    expect(
      check(
        { Hall: "hall", Attic: "attic" },
        { hall: [from, to], attic: [from] },
        { start: "Hall" },
      ),
    ).toEqual([
      {
        severity: "warning",
        file: "rooms.weft",
        message:
          'No exit leads to the room `attic`, so the player can\'t reach "Attic". Connect a room to it in story.ts, as in connect(hall, { north: attic }), link to the passage, or start the game here.',
        span: { start: 10, end: 15 },
      },
    ]);
  });

  it("stay quiet for the start, a linked passage, or any other use, which might be a way in", () => {
    expect(check({ Attic: "attic" }, {}, { start: "Attic" })).toEqual([]);
    expect(check({ Attic: "attic" }, {}, { named: ["Attic"] })).toEqual([]);
    expect(
      check(
        { Attic: "attic" },
        { attic: [{ file: "story.ts", call: { callee: "move", argument: 1 } }] },
      ),
    ).toEqual([]);
    expect(check({ Attic: "rooms.attic" }, {})).toEqual([]); // not a plain name: can't follow it
  });
});
