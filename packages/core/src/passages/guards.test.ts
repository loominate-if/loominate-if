import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { createStore } from "../state/store.js";
import { StateError } from "../state/value.js";
import { createStory, type GuardMode, type Passage, type StoryOptions } from "./story.js";

/**
 * :: Cellar Stairs
 * [[Go down -> Cellar]]{when lantern.isLit}
 * [[Back up -> Kitchen]]
 */
function stairs(mode?: GuardMode, reason?: string): Passage {
  return {
    id: "Cellar Stairs",
    tags: [],
    body: ({ state }) => [
      {
        type: "link",
        label: "Go down",
        target: "Cellar",
        guard: {
          open: state.get("lantern", "lit") === true,
          condition: "lantern.isLit",
          ...(mode !== undefined && { mode }),
          ...(reason !== undefined && { reason }),
        },
      },
      { type: "link", label: "Back up", target: "Kitchen" },
    ],
  };
}

function setup(passage: Passage, options: Partial<StoryOptions> = {}) {
  const store = createStore();
  const passages: Passage[] = [
    passage,
    { id: "Cellar", tags: [], body: () => [] },
    { id: "Kitchen", tags: [], body: () => [] },
  ];
  const story = createStory(store, createEventRecord(store), passages, {
    start: "Cellar Stairs",
    ...options,
  });
  story.begin();
  return { store, story };
}

const labels = (story: ReturnType<typeof setup>["story"]) =>
  story.render().nodes.map((n) => (n.type === "link" ? [n.label, n.available, n.reason] : n.type));

describe("link guards", () => {
  it("leave open links alone", () => {
    const { store, story } = setup(stairs());
    store.set("lantern", "lit", true);
    const page = story.render();
    expect(page.choices.map((c) => c.target)).toEqual(["Cellar", "Kitchen"]);
    expect(page.unavailable).toEqual([]);
    expect(labels(story)).toEqual([
      ["Go down", true, undefined],
      ["Back up", true, undefined],
    ]);
  });

  it("hide a closed link in hidden mode", () => {
    const { story } = setup(stairs("hidden"));
    expect(labels(story)).toEqual([["Back up", true, undefined]]);
    expect(story.render().choices.map((c) => c.target)).toEqual(["Kitchen"]);
  });

  it("show a closed link, unfollowable, in disabled mode", () => {
    const { story } = setup(stairs("disabled", "too dark"));
    expect(labels(story)).toEqual([
      ["Go down", false, undefined],
      ["Back up", true, undefined],
    ]);
    expect(story.render().choices.map((c) => c.target)).toEqual(["Kitchen"]);
  });

  it("show the reason in disabled-with-reason mode", () => {
    const { story } = setup(stairs("disabled-with-reason", "It's too dark to see the steps."));
    expect(labels(story)).toEqual([
      ["Go down", false, "It's too dark to see the steps."],
      ["Back up", true, undefined],
    ]);
  });

  it("use the game-wide default when a link doesn't choose, hidden if not set", () => {
    expect(labels(setup(stairs()).story)).toEqual([["Back up", true, undefined]]);
    const { story } = setup(stairs(undefined, "Too dark."), {
      guardMode: "disabled-with-reason",
    });
    expect(labels(story)[0]).toEqual(["Go down", false, "Too dark."]);
  });

  it("let a link's own mode override the game-wide default", () => {
    const { story } = setup(stairs("hidden"), { guardMode: "disabled" });
    expect(labels(story)).toEqual([["Back up", true, undefined]]);
  });

  it("open when the condition starts holding", () => {
    const { store, story } = setup(stairs("disabled"));
    store.set("lantern", "lit", true);
    const down = story.render().choices.find((c) => c.target === "Cellar");
    if (!down) throw new Error("expected the link to open");
    story.follow(down);
    expect(story.current).toBe("Cellar");
  });

  it("refuse to follow a closed link, naming the condition", () => {
    const { story } = setup(stairs("disabled"));
    const link = { type: "link" as const, label: "Go down", target: "Cellar" };
    expect(() => story.follow(link)).toThrow(StateError);
    expect(() => story.follow(link)).toThrow(
      'follow: "Go down" in passage "Cellar Stairs" is unavailable because its condition `lantern.isLit` doesn\'t hold.',
    );
    expect(story.current).toBe("Cellar Stairs");
  });

  it("tell the inspector why each closed link is hidden or disabled", () => {
    for (const mode of ["hidden", "disabled", "disabled-with-reason"] as const) {
      const { story } = setup(stairs(mode));
      expect(story.render().unavailable).toEqual([
        {
          link: expect.objectContaining({ label: "Go down", target: "Cellar" }) as unknown,
          mode,
          condition: "lantern.isLit",
        },
      ]);
    }
  });
});
