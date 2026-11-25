/** The world model's coverage checks (#133): facts, topics, nodes, and actions out of the world. */
import {
  action,
  coverageChecks,
  createEventRecord,
  createStore,
  createStory,
  type ActionCall,
  type CoverageGame,
  type Passage,
} from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { actor, ask, convNode, defineFacts, place, startAs, thing, topic } from "./index.js";

const parlour = place("cov-parlour", { name: "parlour" });
const you = actor("cov-you", { body: { name: "you", location: parlour } });
const cook = actor("cov-cook", { body: { name: "cook", location: parlour } });
startAs(you);
const facts = defineFacts({
  covRecipe: "The cook has a secret recipe.",
  covAffair: { text: "The cook and the colonel are lovers.", name: "the affair" },
});
const tasting = convNode(cook, "tasting");
const unasked = convNode(cook, "unasked");
const fromCode = convNode(cook, "fromCode", { openedElsewhere: true });
const spoon = thing("cov-spoon", { name: "spoon", location: parlour });
topic(cook, { ask: facts.covRecipe, says: "“I couldn't say.”" });
topic(cook, { ask: spoon, opens: tasting, reveals: facts.covRecipe, says: "“Butter.”" });
topic(cook, { yes: true, in: tasting, says: "“Good.”" });
const locket = thing("cov-locket", { name: "locket" });
action<{ thing: typeof spoon }>("cov-stir", { on: spoon, label: "Stir with the spoon" });
action<{ thing: typeof locket }>("cov-open-locket", { on: locket, label: "Open the locket" });

const passages: Passage[] = [{ id: "Parlour", tags: [], body: () => [] }];
function begun(): CoverageGame {
  const store = createStore();
  const story = createStory(store, createEventRecord(store), passages, { start: "Parlour" });
  story.begin();
  return { story, passages };
}
const check = (name: string) => {
  const c = coverageChecks.get(name);
  if (!c) throw new Error(`no check ${name}`);
  return c;
};
const ours = (keys: Iterable<string>) => [...keys].filter((k) => k.includes("cov"));

describe("the world model's coverage checks (#133)", () => {
  it("find facts no topic is about, so no one can be asked about them", () => {
    const found = check("facts").unreachable?.(begun()) ?? [];
    expect(found.filter((f) => f.label.includes("cov")).map((f) => f.label)).toEqual([
      "the affair (covAffair)",
    ]);
    expect(found.find((f) => f.label.includes("covAffair"))?.why).toContain(
      "No topic is about it, so no one can be asked about it.",
    );
  });

  it("find nodes no topic opens, unless the game opens them from code", () => {
    const found = check("nodes").unreachable?.(begun()) ?? [];
    expect(found.filter((f) => f.label.includes("cov")).map((f) => [f.key, f.label])).toEqual([
      [unasked.id && `node:${unasked.id}`, "unasked (cov-cook:mind)"],
    ]);
    expect(fromCode.openedElsewhere).toBe(true);
  });

  it("find actions on things that are all out of the world as the game begins", () => {
    const found = check("actions out of the world").unreachable?.(begun()) ?? [];
    expect(found.filter((f) => f.key?.includes("cov")).map((f) => [f.key, f.label])).toEqual([
      ["action:cov-open-locket", "Open the locket"],
    ]);
  });

  it("count topics answered, facts learned, and nodes opened, from the game played", () => {
    const game = begun();
    const topics = check("topics");
    expect(
      topics
        .items?.(game)
        .filter((i) => i.key.includes("cov"))
        .map((i) => i.label),
    ).toEqual([
      "Ask the cook about the fact “The cook has a secret recipe.”",
      "Ask the cook about the spoon",
      "Say yes to the cook",
    ]);
    expect(ours(topics.reached?.(game) ?? [])).toEqual([]);
    game.story.act(ask({ who: cook, about: spoon }) as unknown as ActionCall);
    expect(ours(topics.reached?.(game) ?? [])).toHaveLength(1);
    expect(ours(check("facts").reached?.(game) ?? [])).toEqual(["fact:covRecipe"]);
    expect(ours(check("nodes").reached?.(game) ?? [])).toEqual([]);
    expect(tasting.id).toContain("tasting");
  });
});
