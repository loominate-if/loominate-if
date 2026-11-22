import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  spawn,
  t,
  type Passage,
  type StateSnapshot,
} from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import {
  actor,
  canReach,
  canSee,
  container,
  contents,
  inScope,
  move,
  openable,
  place,
  placeOf,
  startAs,
  thing,
  thingTemplate,
} from "./index.js";

const vault = place("vault", { name: "vault" });
const hall = place("hall", { name: "hall" });
// #region template
export const chest = thing("chest", { ...container, ...openable, name: "chest", location: vault });
export const coin = thingTemplate("coin", { name: "gold coin" });
export const pouch = thingTemplate("pouch", { ...container, name: "leather pouch" });
// #endregion
const you = actor("you", { body: { name: "you", location: vault } });
startAs(you);

/** A story whose one passage fills the chest when the player opens it. */
const passages: Passage[] = [
  {
    id: "Vault",
    tags: [],
    body: () => [{ type: "link", label: "Open the chest", target: "Open" }],
  },
  {
    id: "Open",
    tags: [],
    effects: {
      enter: () => {
        // #region spawn
        chest.open();
        move(spawn(coin, chest), chest); // gen:chest:coin-1
        move(spawn(coin, chest), chest); // gen:chest:coin-2
        // #endregion
      },
    },
    body: () => [{ type: "continue", target: "Vault" }],
  },
];

function begin(snapshot?: StateSnapshot) {
  const store = createStore(snapshot);
  const story = createStory(store, createEventRecord(store), passages, { start: "Vault" });
  story.begin();
  const history = createHistory(store);
  history.checkpoint("begun");
  const open = () => {
    story.follow({ type: "link", label: "Open the chest", target: "Open" });
    history.checkpoint("opened");
  };
  return { store, story, history, open };
}

describe("things made during play", () => {
  it("are in the containment tree, sorted by ID", () => {
    const { open } = begin();
    open();
    expect(contents(chest).map((c) => c.id)).toEqual(["gen:chest:coin-1", "gen:chest:coin-2"]);
    const [first] = contents(chest);
    expect(first && placeOf(first)?.id).toBe("vault");
    expect(first?.name).toBe("gold coin");
  });

  it("can be moved, sensed, and named", () => {
    const { open } = begin();
    open();
    const [first] = contents(chest);
    if (!first) throw new Error("no coin");
    expect(canSee(you, first)).toBe(true);
    expect(canReach(you, first)).toBe(true);
    expect(t`You find {a ${first}}.`()).toBe("You find a gold coin.");
    move(first, you);
    expect(contents(you).map((c) => c.id)).toEqual(["gen:chest:coin-1"]);
    move(you, hall);
    expect(inScope(you, "reach").map((c) => c.id)).toContain("gen:chest:coin-1");
    expect(inScope(you, "reach").map((c) => c.id)).not.toContain("gen:chest:coin-2");
  });

  it("take their mixins: a made container holds things", () => {
    begin();
    const bag = spawn(pouch, you, "bag");
    move(bag, you);
    const [made] = contents(chest);
    expect(made).toBeUndefined();
    const extra = spawn(coin, bag);
    move(extra, bag);
    expect(contents(bag).map((c) => c.id)).toEqual(["gen:you:bag:coin-1"]); // IDs nest by origin
    expect(() => {
      move(bag, extra);
    }).toThrow("can't hold things");
  });

  it("are restored by undo and saves, in place, with the same IDs", () => {
    const { store, history, open } = begin();
    open();
    history.undo();
    expect(contents(chest)).toEqual([]);
    history.redo();
    expect(contents(chest)).toHaveLength(2);
    const loaded = begin(JSON.parse(JSON.stringify(store.snapshot())) as StateSnapshot);
    expect(contents(chest).map((c) => c.id)).toEqual(["gen:chest:coin-1", "gen:chest:coin-2"]);
    // The next coin gets the next ID, as it would have before saving.
    loaded.story.follow({ type: "continue", target: "Vault" });
    loaded.story.follow({ type: "link", label: "Open the chest", target: "Open" });
    expect(contents(chest).map((c) => c.id)).toEqual([
      "gen:chest:coin-1",
      "gen:chest:coin-2",
      "gen:chest:coin-3",
      "gen:chest:coin-4",
    ]);
  });

  it("replay to the same things", () => {
    const { story, open } = begin();
    open();
    const replay = story.toReplay();
    const store = createStore();
    const again = createStory(store, createEventRecord(store), passages, { start: "Vault" });
    again.playReplay(replay);
    expect(contents(chest).map((c) => c.id)).toEqual(["gen:chest:coin-1", "gen:chest:coin-2"]);
  });
});
