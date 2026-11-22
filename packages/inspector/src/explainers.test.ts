import {
  action,
  actLink,
  createEventRecord,
  createStore,
  createStory,
  object,
} from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { linkExplainer } from "./explainers.js";
import type { PanelContext } from "./panels.js";

const lamp = object("explained-lamp", { isLit: false, oil: 0 });
const light = action<{ thing: typeof lamp }>("light", {
  verify: ({ thing }) => (thing.isLit ? "It's already lit." : undefined),
  check: ({ thing }) => (thing.oil === 0 ? "There's no oil." : undefined),
});
const snuff = action<{ thing: typeof lamp }>("snuff", {
  verify: ({ thing }) => (thing.isLit ? undefined : "It isn't lit."),
});
const tap = action<{ thing: typeof lamp }>("tap");

describe("explaining action links", () => {
  it("names the action, and why it's hidden or disabled", () => {
    const store = createStore();
    const story = createStory(
      store,
      createEventRecord(store),
      [
        {
          id: "Room",
          tags: [],
          body: () => [
            {
              type: "link",
              label: "Light the lamp",
              target: "Light the lamp",
              guard: actLink({ call: light({ thing: lamp }) }),
            },
            {
              type: "link",
              label: "Snuff the lamp",
              target: "Snuff the lamp",
              guard: actLink({ call: snuff({ thing: lamp }) }),
            },
            {
              type: "link",
              label: "Tap the lamp",
              target: "Tap the lamp",
              guard: actLink({ call: tap({ thing: lamp }) }),
            },
          ],
        },
      ],
      { start: "Room" },
    );
    story.begin();
    const explained = linkExplainer.explain({ player: { story } } as unknown as PanelContext);
    expect(explained).toEqual([
      { label: "Tap the lamp", available: true, action: { name: "tap" } },
      {
        label: "Light the lamp",
        available: false,
        shown: "disabled",
        action: { name: "light", reason: "There's no oil." },
        reason: "There's no oil.",
      },
      {
        label: "Snuff the lamp",
        available: false,
        shown: "hidden",
        action: { name: "snuff", reason: "It isn't lit." },
      },
    ]);
  });
});
