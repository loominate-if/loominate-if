import {
  createEventRecord,
  createStore,
  createStory,
  type EventRecord,
  type Passage,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  connect,
  container,
  defineFacts,
  happen,
  move,
  openable,
  place,
  playAs,
  startAs,
  thing,
} from "./index.js";

const facts = defineFacts({ someoneUpstairs: "Someone is upstairs." });

// #region house
export const landing = place("landing", { name: "landing" });
export const hall = place("hall", { name: "hall" });
export const cellar = place("cellar", { name: "cellar", isDark: true });
export const garden = place("garden", { name: "garden" });
connect(landing, { down: hall });
connect(hall, { up: landing, down: cellar, out: garden });
connect(cellar, { up: hall });
connect(garden, { in: hall });

export const bedroomDoor = thing("bedroomDoor", { name: "bedroom door", location: landing });
// #endregion
const chest = thing("chest", { ...container, ...openable, name: "chest", location: hall });
const bell = thing("bell", { name: "bell", location: chest });

const you = actor("you", { body: { name: "you", location: hall } });
const mira = actor("mira", { body: { name: "Mira", location: garden } });
// #region leaves
export const cat = actor("cat", {
  body: {
    name: "cat",
    location: hall,
    leaves(toward: string | undefined) {
      return `The cat slinks off ${toward ?? "somewhere"}.`;
    },
    arrives() {
      return undefined; // it comes and goes as it pleases, unseen
    },
  },
});
// #endregion
startAs(you);

const slam = () => {
  // #region slam
  happen(bedroomDoor, {
    seen: "The bedroom door slams shut.",
    heard: "A door slams.",
    far: (from) => `You hear a door slam ${from}.`,
    reveals: facts.someoneUpstairs,
  });
  // #endregion
};

/** What the next move's effect does. */
let change: () => void = () => undefined;

const passages: Passage[] = [
  {
    id: "Hall",
    tags: [],
    body: () => [
      { type: "text", text: "The hall." },
      { type: "link", label: "Wait", target: "Hall" },
    ],
    effects: {
      enter: () => {
        change();
      },
    },
  },
];

let story: Story;
let record: EventRecord;
beforeEach(() => {
  change = () => undefined;
  const store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
});

/** What the player noticed since the game began. */
const noticed = () => record.events({ kinds: ["perception"] }).map((e) => `${e.sense}: ${e.text}`);

/** Runs `effect` during a move, as an effect would. */
const during = (effect: () => void) => {
  change = effect;
  story.follow({ type: "link", label: "Wait", target: "Hall" });
};

describe("something that happens", () => {
  it("is heard from the next room, with the way it came", () => {
    during(slam);
    expect(noticed()).toEqual(["hear: You hear a door slam from above."]);
    expect(you.knows(facts.someoneUpstairs)).toBe(true);
    expect(you.sourceOf(facts.someoneUpstairs)?.from?.id).toBe("bedroomDoor");
    expect(mira.knows(facts.someoneUpstairs)).toBe(false); // two exits away
  });

  it("is seen in its own room, and heard where it can't be seen", () => {
    during(() => {
      move(you, landing);
      slam();
      move(you, cellar); // too far
      slam();
    });
    expect(noticed()).toEqual(["see: The bedroom door slams shut."]);
    expect(you.hasSeen(bedroomDoor)).toBe(true);
    during(() => {
      move(you, hall);
      happen(bell, { seen: "The bell glints.", heard: "Something rings inside the chest." });
    });
    expect(noticed().at(-1)).toBe("hear: Something rings inside the chest.");
  });

  it("carries as far as it's told, or no further", () => {
    during(() => {
      move(you, garden);
      slam(); // two exits away: unheard
      happen(bedroomDoor, { far: "Somewhere, a door bangs.", carries: 2 });
    });
    expect(noticed()).toEqual(["hear: Somewhere, a door bangs."]);
    expect(() => {
      happen(bedroomDoor, { far: "x", carries: 1.5 });
    }).toThrow('happen "bedroomDoor": carries must be a whole number of exits, 0 or more.');
  });

  it("tells only the mind the player controls, though every mind learns", () => {
    during(() => {
      move(mira, hall);
      playAs(mira);
      slam();
    });
    expect(mira.knows(facts.someoneUpstairs)).toBe(true);
    expect(you.knows(facts.someoneUpstairs)).toBe(true);
    expect(noticed().filter((n) => n.includes("door")).length).toBe(1);
  });
});

describe("actors coming and going", () => {
  it("are narrated with the way they came or went", () => {
    during(() => {
      move(mira, hall);
      move(mira, landing);
      move(mira, garden); // out of sight: silent
    });
    expect(noticed()).toEqual(["see: Mira arrives from outside.", "see: Mira leaves upstairs."]);
    expect(you.hasSeen(mira)).toBe(true);
  });

  it("can say it their own way, or not at all", () => {
    during(() => {
      move(cat, cellar);
      move(cat, hall);
    });
    expect(noticed()).toEqual(["see: The cat slinks off downstairs."]);
  });

  it("aren't narrated in the dark, or for the player's own moves", () => {
    during(() => {
      move(you, cellar);
      move(mira, cellar);
      move(you, hall);
    });
    expect(noticed()).toEqual([]);
  });
});
