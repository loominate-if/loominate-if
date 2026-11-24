import { action, menuLink, object, type Passage } from "@loominate-if/core";
import { compassWidget, widgets } from "@loominate-if/presentation";
import { afterEach, describe, expect, it } from "vitest";
import { play } from "./play.js";

const bell = object("menus-bell", { name: "bell", rung: 0, polished: false });
action<{ thing: typeof bell }>("menus-ring", {
  on: bell,
  label: "Ring the bell",
  run: ({ thing }) => {
    thing.rung += 1;
  },
  report: "Ding!",
});
action<{ thing: typeof bell }>("menus-polish", {
  on: bell,
  label: "Polish the bell",
  check: () => "You have no cloth.",
});
const passages: Passage[] = [
  {
    id: "Hall",
    tags: [],
    body: () => [
      {
        type: "text",
        text: "A bell hangs here.",
        links: [
          {
            type: "link",
            label: "bell",
            target: "bell",
            guard: menuLink({ thing: bell }),
            start: 2,
            end: 6,
          },
        ],
      },
    ],
  },
];

afterEach(() => {
  if (widgets.get("compass")) widgets.remove("compass");
});

describe("menus and the compass in walkthroughs (#345)", () => {
  it("list a thing's menu, with why entries are disabled", () => {
    const game = play({ passages, start: "Hall" });
    // #region menu
    expect(game.menu(bell)).toEqual([
      { label: "Ring the bell" },
      { label: "Polish the bell", disabled: "You have no cloth." },
    ]);
    // #endregion
  });

  it("take an action by its label, as a move that undo takes back", () => {
    // #region act
    const game = play({ passages, start: "Hall" }).act("Ring the bell");
    expect(game.notices).toBe("Ding!");
    // #endregion
    expect(bell.rung).toBe(1);
    game.undo();
    expect(bell.rung).toBe(0);
    expect(() => game.act("Polish the bell")).toThrow(
      '"Polish the bell" can\'t be taken now: You have no cloth.',
    );
    expect(() => game.act("Kick the bell")).toThrow(
      'No menu offers "Kick the bell" in passage "Hall". The menus offer: "Ring the bell", "Polish the bell".',
    );
  });

  it("give the compass's ways, when the game has one", () => {
    const game = play({ passages, start: "Hall" });
    expect(game.compass).toBeUndefined();
    widgets.register(
      "compass",
      compassWidget({
        ways: () => [
          {
            direction: "north",
            label: "N",
            title: "North",
            available: false,
            reason: "It's locked.",
          },
        ],
        take: () => undefined,
      }),
    );
    expect(game.compass).toEqual([
      { direction: "north", label: "N", title: "North", available: false, reason: "It's locked." },
    ]);
  });
});
