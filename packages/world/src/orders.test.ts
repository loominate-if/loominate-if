import {
  action,
  actionsFor,
  createEventRecord,
  createStore,
  createStory,
  statusOf,
  t,
  type ActionCall,
  type EventRecord,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  askFor,
  askToCome,
  askToWait,
  companion,
  companionState,
  door,
  isWithin,
  lockable,
  obeying,
  order,
  place,
  startAs,
  thing,
  type Thing,
} from "./index.js";

const hall = place("hall", { name: "hall" });
const you = actor("you", { body: { name: "you", location: hall } });
const tom = actor("tom", { body: { name: "Tom", location: hall } });
const mira = actor("mira", { body: { name: "Mira", location: hall } });
const cook = actor("cook", { body: { name: "cook", location: hall } });
const cellarDoor = thing("cellarDoor", {
  ...door,
  ...lockable,
  name: "cellar door",
  location: hall,
  isLocked: true,
});
const vaultDoor = thing("vaultDoor", {
  ...door,
  ...lockable,
  name: "vault door",
  location: hall,
  isLocked: true,
});
thing("lockpick", { name: "lockpick", location: tom });
const key = thing("key", { name: "key", location: mira });
const spoon = thing("spoon", { name: "spoon", location: cook });
companion(tom);
companion(mira);
startAs(you);

// #region orders
// Picking a lock needs a lockpick: Tom has one, Mira doesn't.
export const pickLock = action<{ thing: Thing }>("pickLock", {
  label: ({ thing }) => t`Pick {the thing}`({ thing }),
  seen: ({ body }) => (body ? t`{The subj body} {picks} the lock.`({ body }) : ""),
  verify: ({ thing }) =>
    (thing as { isLocked?: boolean }).isLocked === true ? undefined : "It isn't locked.",
  check: ({ body }) =>
    body && [...["lockpick"]].some((id) => isWithin({ id }, body))
      ? undefined
      : "Not without a lockpick.",
  run: ({ thing }) => {
    (thing as unknown as { isLocked: boolean }).isLocked = false;
  },
});
export const askToPick = order(pickLock);
// What a companion won't do: Tom won't touch the vault.
obeying.rule("Tom won't touch the vault", ({ who, call }) =>
  who.id === "tom" && call.args["thing"] === vaultDoor
    ? "Tom shakes his head. “Not the vault.”"
    : undefined,
);
// #endregion

let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, [{ id: "Hall", tags: [], body: () => [] }], { start: "Hall" });
  story.begin();
  seen = 0;
});
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};
let seen = 0;
const said = () => {
  const all = record.events({ kinds: ["action-result", "perception"] });
  const out = all.slice(seen).map((e) => e.text);
  seen = all.length;
  return out;
};
const menu = (of: { id: string }) =>
  actionsFor(of)
    .map(statusOf)
    .filter((s) => s.hidden === undefined)
    .map((s) => s.label);

describe("orders (#123)", () => {
  it("have the NPC do the action as themselves, with their own things", () => {
    expect(statusOf(askToPick({ who: tom, thing: cellarDoor })).label).toBe(
      "Ask Tom to pick the cellar door",
    );
    act(askToPick({ who: tom, thing: cellarDoor }));
    expect(said()).toEqual(["You ask Tom to pick the cellar door.", "Tom picks the lock."]);
    expect(cellarDoor.isLocked).toBe(false);
  });

  it("show why they can't, as their answer", () => {
    act(askToPick({ who: mira, thing: vaultDoor }));
    expect(said()).toEqual([
      "You ask Mira to pick the vault door.",
      "Mira can't: Not without a lockpick.",
    ]);
    expect(vaultDoor.isLocked).toBe(true);
  });

  it("can be refused, by a rule in obeying, or because they aren't a companion", () => {
    act(askToPick({ who: tom, thing: vaultDoor }));
    act(askToPick({ who: cook, thing: vaultDoor }));
    expect(said()).toEqual([
      "You ask Tom to pick the vault door.",
      "Tom shakes his head. “Not the vault.”",
      "You ask the cook to pick the vault door.",
      "The cook has no reason to take orders from you.",
    ]);
  });

  it("aren't offered when they make no sense for the NPC", () => {
    expect(statusOf(askToPick({ who: tom, thing: spoon as never })).hidden).toBe(
      "It isn't locked.",
    );
  });

  it("include waiting and coming along, on a companion's menu", () => {
    expect(menu(mira)).toContain("Ask Mira to wait here");
    expect(menu(cook)).not.toContain("Ask the cook to wait here");
    act(askToWait({ thing: mira as never }));
    expect([said(), companionState(mira)]).toEqual([
      ["You ask Mira to wait here.", "Mira waits here."],
      "waiting",
    ]);
    expect(menu(mira)).toContain("Ask Mira to come along");
    expect(menu(mira)).not.toContain("Ask Mira to wait here");
    act(askToCome({ thing: mira as never }));
    expect(companionState(mira)).toBe("accompanying");
  });

  it("include asking for what someone carries, which they give through give", () => {
    expect(menu(key)).toContain("Ask Mira for the key");
    act(askFor({ thing: key as never, from: mira as never }));
    expect(key.location?.id).toBe("you");
    act(askFor({ thing: spoon as never, from: cook as never }));
    expect(said().at(-1)).toBe("The cook has no reason to take orders from you.");
    expect(spoon.location?.id).toBe("cook");
  });

  it("give the same state for the same moves (determinism)", () => {
    act(askToPick({ who: tom, thing: cellarDoor }));
    act(askFor({ thing: key as never, from: mira as never }));
    const again = createStore();
    createStory(again, createEventRecord(again), [{ id: "Hall", tags: [], body: () => [] }], {
      start: "Hall",
    }).playReplay(story.toReplay());
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
