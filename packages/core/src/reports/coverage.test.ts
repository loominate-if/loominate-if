/** Core's coverage checks (#133): passages a player can visit, and actions on things. */
import { describe, expect, it } from "vitest";
import { action, type ActionCall } from "../actions/actions.js";
import { createEventRecord } from "../events/record.js";
import { object } from "../objects/objects.js";
import { createStory, type Passage } from "../passages/story.js";
import { createStore } from "../state/store.js";
import { coverageChecks, type CoverageGame } from "./coverage.js";

const bell = object("cov-bell", { rung: 0 });
const ring = action<{ thing: typeof bell }>("cov-ring", {
  on: bell,
  label: "Ring the bell",
  run: ({ thing }) => {
    thing.rung += 1;
  },
});
action("cov-shout", { label: "Shout" });

const passages: Passage[] = [
  { id: "Hall", tags: [], body: () => [{ type: "link", label: "Up", target: "Tower" }] },
  { id: "Tower", tags: [], body: () => [] },
];

function begun(): CoverageGame {
  const store = createStore();
  const story = createStory(store, createEventRecord(store), passages, { start: "Hall" });
  story.begin();
  return { story, passages };
}
const check = (name: string) => {
  const c = coverageChecks.get(name);
  if (!c) throw new Error(`no check ${name}`);
  return c;
};

describe("core's coverage checks (#133)", () => {
  it("list every passage, and the ones visited", () => {
    const game = begun();
    expect(check("passages").items?.(game)).toEqual([
      { key: "passage:Hall", label: "Hall" },
      { key: "passage:Tower", label: "Tower" },
    ]);
    expect([...(check("passages").reached?.(game) ?? [])]).toEqual(["passage:Hall"]);
  });

  it("list actions on things, by label, and the ones taken", () => {
    const game = begun();
    const items = check("actions").items?.(game) ?? [];
    expect(items).toContainEqual({ key: "action:cov-ring", label: "Ring the bell" });
    // Not on a thing, so not in any menu: not one to reach.
    expect(items.map((i) => i.key)).not.toContain("action:cov-shout");
    game.story.act(ring({ thing: bell }) as unknown as ActionCall);
    expect([...(check("actions").reached?.(game) ?? [])]).toEqual(["action:cov-ring"]);
  });
});
