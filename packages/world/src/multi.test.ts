import {
  action,
  actionsFor,
  createEventRecord,
  createStore,
  createStory,
  perform,
  statusOf,
  t,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { actor, container, move, openable, place, startAs, thing, type Thing } from "./index.js";

const shed = place("shed", { name: "shed" });
const yard = place("yard", { name: "yard" });
// #region things
export const crate = thing("crate", { ...container, ...openable, name: "crate", location: shed });
export const crowbar = thing("crowbar", { name: "crowbar", location: yard });
export const knife = thing("knife", { name: "knife", isSharp: true, location: shed });
export const axe = thing("axe", { name: "axe", isSharp: true, location: shed });
export const rope = thing("rope", { name: "rope", location: shed });
// #endregion
const you = actor("you", { body: { name: "you", location: shed } });
startAs(you);

// #region pry
export const pry = action<{ thing: typeof crate; tool: Thing }>("pry", {
  on: crate,
  with: { tool: crowbar },
  label: t`Pry {the thing} open with {the tool}`,
  verify: ({ thing }) => (thing.isOpen ? "It's open already." : undefined),
  run: ({ thing }) => {
    thing.open();
  },
  report: t`You lever {the thing} open with {the tool}.`,
});
// #endregion
// #region cut
const isSharp = (t: object): boolean => "isSharp" in t && t.isSharp === true;
export const cut = action<{ thing: Thing; blade: Thing }>("cut", {
  for: (t) => t.id === "rope",
  with: { blade: isSharp },
  label: t`Cut {the thing} with {the blade}`,
  report: t`You cut {the thing} with {the blade}.`,
});
// #endregion

beforeEach(() => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  });
});

/** What a thing's menu offers from these actions, without the hidden ones. */
const menu = (of: { id: string }) =>
  actionsFor(of)
    .filter((c) => ["pry", "cut"].includes(c.action.actionName))
    .map(statusOf)
    .filter((s) => s.hidden === undefined)
    .map((s) => s.label);

describe("multi-object actions", () => {
  it("are offered only when every participant is in reach", () => {
    expect(menu(crate)).toEqual([]); // the crowbar's in the yard
    move(crowbar, shed);
    // #region menus
    expect(menu(crate)).toEqual(["Pry the crate open with the crowbar"]);
    expect(menu(crowbar)).toEqual(["Pry the crate open with the crowbar"]);
    // #endregion
    move(you, yard);
    move(crowbar, yard);
    expect(menu(crowbar)).toEqual([]); // the crate's in the shed
  });

  it("offer one entry for each thing that suits a role, on every participant's menu", () => {
    // #region suits
    expect(menu(rope)).toEqual(["Cut the rope with the axe", "Cut the rope with the knife"]);
    expect(menu(knife)).toEqual(["Cut the rope with the knife"]);
    // #endregion
    expect(menu(crate)).toEqual([]);
    move(axe, yard);
    expect(menu(rope)).toEqual(["Cut the rope with the knife"]);
  });

  it("are performed with all their things", () => {
    move(crowbar, you);
    const [call] = actionsFor(crowbar).filter((c) => c.action.actionName === "pry");
    if (!call) throw new Error("no pry");
    expect(perform(call)).toEqual({ done: true });
    expect(crate.isOpen).toBe(true);
    expect(statusOf(call).hidden).toBe("It's open already.");
  });

  it("explain a role `with` can't fill", () => {
    expect(() => action<{ thing: Thing }>("bad", { with: { actor: crowbar } as never })).toThrow(
      '`with` can\'t fill "actor"',
    );
  });
});
