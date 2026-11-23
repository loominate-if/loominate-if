import {
  action,
  actLink,
  createEventRecord,
  everyAction,
  menuLink,
  useCandidates,
  createStore,
  createStory,
  object,
} from "@loominate-if/core";
import { describe, expect, it } from "vitest";
import { actionExplainer, linkExplainer } from "./explainers.js";
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
const wick = object("explained-wick", { name: "wick" });
const match = object("explained-match", { name: "match" });
export const trim = action<{ thing: typeof wick }>("trim", {
  on: wick,
  label: "Trim the wick",
  source: "@my-scope/lamps",
  check: () => "The scissors are blunt.",
});
export const strike = action<{ thing: typeof match; on: typeof wick }>("strike", {
  on: match,
  with: { on: wick },
  label: "Strike the match on the wick",
});

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
        action: {
          name: "light",
          reason: "There's no oil.",
          by: { stage: "check", rulebook: "light: check", rule: "light: own", source: "game" },
        },
        reason: "There's no oil.",
      },
      {
        label: "Snuff the lamp",
        available: false,
        shown: "hidden",
        action: {
          name: "snuff",
          reason: "It isn't lit.",
          by: { stage: "verify", rulebook: "snuff: verify", rule: "snuff: own", source: "game" },
        },
      },
    ]);
  });
});

describe("explaining things' actions", () => {
  it("lists the actions of things with menus and in reach, each once, with the rule that decided", () => {
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
              label: "wick",
              target: "wick",
              guard: menuLink({ thing: wick }),
            },
          ],
        },
      ],
      { start: "Room" },
    );
    story.begin();
    const context = { player: { story } } as unknown as PanelContext;
    const labels = () => actionExplainer.explain(context).map((e) => e.label);
    expect(labels()).toEqual(["Trim the wick", "Strike the match on the wick"]);
    useCandidates(() => [match, wick]);
    everyAction.verify.rule("no striking", (c) =>
      c.action === "strike" ? "It's too damp." : undefined,
    );
    try {
      // The match is in reach, but its action is listed once, from the wick.
      expect(labels()).toEqual(["Trim the wick", "Strike the match on the wick"]);
      expect(actionExplainer.explain(context)).toEqual([
        {
          label: "Trim the wick",
          available: false,
          shown: "disabled",
          action: {
            name: "trim",
            reason: "The scissors are blunt.",
            by: {
              stage: "check",
              rulebook: "trim: check",
              rule: "trim: own",
              source: "@my-scope/lamps",
            },
          },
          reason: "The scissors are blunt.",
        },
        {
          label: "Strike the match on the wick",
          available: false,
          shown: "hidden",
          action: {
            name: "strike",
            reason: "It's too damp.",
            by: {
              stage: "verify",
              rulebook: "every action: verify",
              rule: "no striking",
              source: "game",
            },
          },
        },
      ]);
    } finally {
      useCandidates(undefined);
      everyAction.verify.remove("no striking");
    }
  });
});
