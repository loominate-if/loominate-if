import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { createHistory } from "../state/history.js";
import { createStore } from "../state/store.js";
import { createStory, type LinkNode, type Passage, type Story } from "./story.js";
import { storylet, storyletDraw, storyletLinks, storyletStatus, storyletsIn } from "./storylets.js";

const weather = { raining: false };
const mira = { affection: 0 };

// #region storylets
storylet("Rainy visit", {
  when: { "it's raining": () => weather.raining, "Mira likes you": () => mira.affection >= 3 },
  priority: 2,
  once: true,
  deck: "evenings",
});
storylet("Card game", { deck: "evenings", cooldown: 2 });
storylet("Long walk", { deck: "evenings", cooldown: 2, label: "Go for a long walk" });
storylet("Letter", { deck: "mornings" });
// #endregion

const back = { type: "link", label: "Back", target: "Home" } as const;
const passages: Passage[] = [
  {
    id: "Home",
    tags: [],
    body: () => [
      { type: "text", text: "Evening falls." },
      ...storyletLinks({ deck: ["evenings"], limit: 2 }),
    ],
  },
  {
    id: "Dawn",
    tags: [],
    // What `{storylet mornings}` compiles to: a draw as the player arrives.
    effects: { enter: () => storyletDraw({ deck: ["mornings"] }) },
    body: () => [{ type: "text", text: "Nothing happens this morning." }, back],
  },
  ...["Rainy visit", "Card game", "Long walk", "Letter"].map((id): Passage => ({
    id,
    tags: [],
    body: () => [{ type: "text", text: id }, back],
  })),
];

const start = (seed = "s"): Story => {
  const store = createStore();
  const story = createStory(store, createEventRecord(store), passages, { start: "Home", seed });
  story.begin();
  return story;
};
const hand = (story: Story) => story.render().choices.map((c) => (c as LinkNode).label);
const pick = (story: Story, label: string) => {
  const choice = story.render().choices.find((c) => (c as LinkNode).label === label);
  if (!choice) throw new Error(`no ${label} in ${hand(story).join(", ")}`);
  story.follow(choice);
};

describe("storylets", () => {
  it("offer the eligible ones in a hand, highest priority first, and say why the rest aren't", () => {
    const story = start();
    expect(hand(story).sort()).toEqual(["Card game", "Go for a long walk"]);
    expect(storyletStatus().find((s) => s.passage === "Rainy visit")).toMatchObject({
      reason: "Not while these don't hold: it's raining; Mira likes you.",
      failing: ["it's raining", "Mira likes you"],
    });
    weather.raining = true;
    mira.affection = 3;
    // Priority 2 comes first, and the hand holds two.
    expect(hand(story)[0]).toBe("Rainy visit");
    expect(hand(story)).toHaveLength(2);
    pick(story, "Rainy visit");
    pick(story, "Back");
    expect(hand(story)).not.toContain("Rainy visit");
    expect(storyletStatus().find((s) => s.passage === "Rainy visit")).toMatchObject({
      seen: 1,
      reason: "It's once only, and it's been seen.",
    });
    weather.raining = false;
    mira.affection = 0;
  });

  it("rest after they're seen, for a cooldown, and then the one seen longest ago comes first", () => {
    const story = start();
    pick(story, "Card game");
    pick(story, "Back"); // one move since
    expect(hand(story)).toEqual(["Go for a long walk"]);
    expect(storyletStatus().find((s) => s.passage === "Card game")?.reason).toBe(
      "It's resting: 1 move more.",
    );
    pick(story, "Go for a long walk");
    pick(story, "Back");
    // The card game has rested; the walk was seen more recently, so it's resting still.
    expect(hand(story)).toEqual(["Card game"]);
  });

  it("can be drawn as the player arrives, or not, if none is eligible", () => {
    const story = start();
    expect(storyletsIn("mornings")).toEqual(["Letter"]);
    story.goTo("Dawn");
    expect(story.current).toBe("Letter"); // drawn
    story.goTo("Dawn");
    expect(story.current).toBe("Letter"); // no cooldown, no once: drawn again
  });

  it("are undone with the game", () => {
    const store = createStore();
    const story = createStory(store, createEventRecord(store), passages, {
      start: "Home",
      seed: "s",
    });
    story.begin();
    const history = createHistory(store);
    history.checkpoint("home");
    pick(story, "Card game");
    history.checkpoint("played");
    history.undo();
    expect(storyletStatus().find((s) => s.passage === "Card game")?.seen).toBe(0);
  });

  it("are selected deterministically: the same seed and moves give the same hands, and a replay repeats them", () => {
    /** The hands a player sees taking the first storylet each time, for six moves. */
    const hands = (story: Story) => {
      const seen: string[][] = [];
      for (let i = 0; i < 3; i++) {
        seen.push(hand(story));
        const [first] = hand(story);
        if (first === undefined) break;
        pick(story, first);
        pick(story, "Back");
      }
      return seen;
    };
    const store = createStore();
    const a = createStory(store, createEventRecord(store), passages, {
      start: "Home",
      seed: "seed-1",
    });
    a.begin();
    const played = hands(a);
    expect(hands(start("seed-1"))).toEqual(played);
    const replayed = createStore();
    createStory(replayed, createEventRecord(replayed), passages, { start: "Home" }).playReplay(
      a.toReplay(),
    );
    expect(replayed.entity("$storylets")).toEqual(store.entity("$storylets"));
    expect(replayed.entity("$storyletCount")).toEqual(store.entity("$storyletCount"));
    // Ties are broken by the seed: some seed puts the walk first, and some the card game.
    const firsts = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((seed) => hand(start(seed))[0]),
    );
    expect(firsts).toEqual(new Set(["Card game", "Go for a long walk"]));
  });

  // Last: a storylet naming no passage stops every story from beginning.
  it("must each name a passage, checked as the story begins", () => {
    storylet("Rainy vist", { deck: "evenings" });
    expect(() => start()).toThrow(
      "storylet \"Rainy vist\": there's no passage with this name. Check the spelling against the passage's :: line.",
    );
  });
});
