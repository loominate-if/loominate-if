import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type Passage,
  type StateSnapshot,
  type Story,
} from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import {
  actor,
  defineFacts,
  enterRoom,
  place,
  playAs,
  player,
  registerRoom,
  startAs,
  thing,
  totalVisitsTo,
  visitsTo,
} from "./index.js";

const facts = defineFacts({ secret: "The heir is an impostor." });
const study = place("study", { name: "study" });
const lobby = place("lobby", { name: "lobby" });
const globe = thing("globe", { name: "globe", location: study });
const you = actor("you", { body: { name: "you", location: lobby } });
const mira = actor("mira", { body: { name: "Mira", location: lobby } });
startAs(you);
registerRoom(study, { id: "Study", tags: ["room: study"] });

/** How many times the study's first-visit effect has run. */
const welcomes = { count: 0 };

const passages: Passage[] = [
  {
    id: "Lobby",
    tags: [],
    body: ({ firstVisit }) => [
      { type: "text", text: firstVisit ? "A lobby you don't know." : "The lobby again." },
      { type: "link", label: "Study", target: "Study" },
    ],
  },
  {
    id: "Study",
    tags: ["room: study"],
    body: ({ firstVisit, visits }) => [
      {
        type: "text",
        text: firstVisit ? "A study you don't know." : `The study (${String(visits)}).`,
      },
      { type: "link", label: "Lobby", target: "Lobby" },
    ],
    effects: {
      firstVisit: () => {
        welcomes.count += 1;
      },
      enter: (context) => {
        enterRoom(study, context);
      },
    },
  },
];

function begin(snapshot: StateSnapshot = {}) {
  const store = createStore(snapshot);
  const story = createStory(store, createEventRecord(store), passages, { start: "Lobby" });
  story.begin();
  return { store, story };
}

const go = (story: Story, label: string): string => {
  const choice = story.render().choices.find((c) => c.label === label);
  if (!choice) throw new Error(`no choice ${label}`);
  story.follow(choice);
  const first = story.render().nodes[0];
  return first?.type === "text" ? first.text : "";
};

describe("visits", () => {
  it("are remembered by the player's mind, so a new player character's first visit is a first visit", () => {
    welcomes.count = 0;
    const { story } = begin();
    go(story, "Study");
    expect(go(story, "Lobby")).toBe("The lobby again.");
    // #region switch
    playAs(mira);
    expect(go(story, "Study")).toBe("A study you don't know.");
    expect(story.visits("Study")).toBe(1); // Mira's
    expect(story.totalVisits("Study")).toBe(2); // everyone's
    expect(visitsTo(study)).toBe(1);
    expect(totalVisitsTo(study)).toBe(2);
    // #endregion
    expect(welcomes.count).toBe(2); // the first-visit effect ran for each of them
    playAs(you);
    expect(go(story, "Lobby")).toBe("The lobby again.");
    expect(go(story, "Study")).toBe("The study (2).");
  });

  it("can be forgotten for good, one passage, a room, or all", () => {
    const { story } = begin();
    go(story, "Study");
    go(story, "Lobby");
    you.forgetVisits("Lobby");
    expect(story.visits("Lobby")).toBe(0);
    expect(story.visits("Study")).toBe(1);
    you.forget(study); // its passages too, and that it was seen
    expect(story.visits("Study")).toBe(0);
    expect(visitsTo(study)).toBe(0);
    expect(you.hasSeen(study)).toBe(false);
    go(story, "Study");
    you.forgetVisits();
    expect([story.visits("Study"), story.visits("Lobby"), visitsTo(study)]).toEqual([0, 0, 0]);
    expect(story.totalVisits("Study")).toBe(2);
  });

  it("are kept in saves, and undo takes them back", () => {
    const { store, story } = begin();
    go(story, "Study");
    playAs(mira);
    const loaded = begin(JSON.parse(JSON.stringify(store.snapshot())) as StateSnapshot);
    expect(loaded.story.visits("Study")).toBe(0); // Mira's
    playAs(you);
    expect(loaded.story.visits("Study")).toBe(1);
    const history = createHistory(loaded.store);
    history.checkpoint("loaded");
    go(loaded.story, "Lobby");
    go(loaded.story, "Study");
    history.checkpoint("again");
    expect(loaded.story.visits("Study")).toBe(2);
    history.undo();
    expect(loaded.story.visits("Study")).toBe(1);
  });
});

describe("amnesia", () => {
  it("blocks every memory until it's lifted, and new ones still form", () => {
    const { story } = begin();
    go(story, "Study");
    player.learn(facts.secret);
    // #region amnesia
    you.loseMemory();
    expect(you.hasAmnesia).toBe(true);
    expect(you.knows(facts.secret)).toBe(false);
    expect(you.hasSeen(globe)).toBe(false);
    go(story, "Lobby");
    expect(go(story, "Study")).toBe("A study you don't know.");
    you.regainMemory();
    expect(you.knows(facts.secret)).toBe(true);
    expect(story.visits("Study")).toBe(2); // one before, one during
    // #endregion
    expect(player.hasAmnesia).toBe(false);
    expect(visitsTo(study)).toBe(2);
  });

  it("keeps the first source of a fact learned twice, and forgetting reaches blocked memories", () => {
    begin();
    you.learn(facts.secret, { from: mira });
    you.loseMemory();
    you.learn(facts.secret, { from: globe });
    expect(you.sourceOf(facts.secret)?.from?.id).toBe("globe");
    you.regainMemory();
    expect(you.sourceOf(facts.secret)?.from?.id).toBe("mira");
    you.loseMemory();
    you.forget(facts.secret);
    you.regainMemory();
    expect(you.knows(facts.secret)).toBe(false);
  });
});
