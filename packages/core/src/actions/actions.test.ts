import { afterEach, describe, expect, it } from "vitest";
import { createEventRecord, type EventRecord } from "../events/record.js";
import { object } from "../objects/objects.js";
import { createStory, type Passage, type Story } from "../passages/story.js";
import { readReplay, writeReplay } from "../replay/replay.js";
import { hook } from "../rules/hooks.js";
import { createHistory } from "../state/history.js";
import { createStore, type StateStore } from "../state/store.js";
import {
  action,
  actionsFor,
  actLink,
  everyAction,
  perform,
  statusOf,
  useCandidates,
} from "./actions.js";

const door = object("door", {
  name: "cellar door",
  isOpen: false,
  isLocked: true,
  open() {
    this.isOpen = true;
  },
});
const bell = object("bell", { name: "bell", rung: 0 });
const hammer = object("hammer", { name: "hammer", isHeavy: true });
const spoon = object("spoon", { name: "spoon", isHeavy: false });

// #region open
export const open = action<{ thing: typeof door }>("open", {
  label: ({ thing }) => `Open the ${thing.name}`,
  verify: ({ thing }) => (thing.isOpen ? "It's already open." : undefined),
  check: ({ thing }) => (thing.isLocked ? "It's locked." : undefined),
  run: ({ thing }) => {
    thing.open();
  },
  report: ({ thing }) => `You open the ${thing.name}.`,
  minutes: 1,
});
// #endregion
const ring = action<{ thing: typeof bell }>("ring", {
  run: ({ thing }) => {
    thing.rung += 1;
  },
  report: "Ding.",
});
const unlock = action<{ thing: typeof door }>("unlock", {
  run: ({ thing }) => {
    thing.isLocked = false;
  },
});

const passages: Passage[] = [
  {
    id: "Hall",
    tags: [],
    body: () => [
      { type: "text", text: "A hall." },
      {
        type: "link",
        label: "Open the door",
        target: "Open the door",
        guard: actLink({ call: open({ thing: door }) }),
      },
      {
        type: "link",
        label: "Ring the bell",
        target: "Ring the bell",
        guard: actLink({ call: ring({ thing: bell }) }),
      },
      {
        type: "link",
        label: "Unlock it",
        target: "Unlock it",
        guard: actLink({ call: unlock({ thing: door }) }),
      },
    ],
  },
];

let store: StateStore;
let record: EventRecord;
const begin = (): Story => {
  store = createStore();
  record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Hall" });
  story.begin();
  return story;
};
const choose = (story: Story, label: string): void => {
  const choice = story.render().choices.find((c) => c.label === label);
  if (!choice) throw new Error(`no choice ${label}`);
  story.follow(choice);
};
const results = (): string[] =>
  record.events({ kinds: ["action-result"] }).map((e) => (e as { text: string }).text);

const added: (() => void)[] = [];
afterEach(() => {
  for (const undo of added.splice(0)) undo();
});

describe("actions from links", () => {
  it("are disabled with check's reason, and hidden when verify fails", () => {
    const story = begin();
    const page = story.render();
    expect(page.unavailable.map((u) => `${u.link.label}: ${u.mode}, ${u.condition}`)).toEqual([
      "Open the door: disabled-with-reason, open: It's locked.",
    ]);
    choose(story, "Unlock it");
    choose(story, "Open the door");
    // Now it's open, verify hides it: it makes no sense to open it again.
    const after = story.render();
    expect(after.choices.map((c) => c.label)).toEqual(["Ring the bell", "Unlock it"]);
    expect(after.unavailable.map((u) => `${u.mode} ${u.condition}`)).toEqual([
      "hidden open: It's already open.",
    ]);
  });

  it("are performed, staying on the passage, with their report recorded", () => {
    const story = begin();
    choose(story, "Ring the bell");
    choose(story, "Ring the bell");
    expect(story.current).toBe("Hall");
    expect(bell.rung).toBe(2);
    expect(results()).toEqual(["Ding.", "Ding."]);
    expect(story.actions.map((a) => a.type)).toEqual(["act", "act"]);
    expect(record.events({ kinds: ["action"] }).map((e) => e.action)).toEqual(["ring", "ring"]);
  });

  it("are undone, saved, and replayed like any move", () => {
    const story = begin();
    const history = createHistory(store);
    history.checkpoint("begun");
    choose(story, "Unlock it");
    history.checkpoint("unlocked");
    choose(story, "Open the door");
    history.checkpoint("opened");
    expect(door.isOpen).toBe(true);
    history.undo();
    expect(door.isOpen).toBe(false);
    history.redo();
    // A replay file, written and read, takes the same actions.
    const replay = readReplay(writeReplay(story.toReplay()));
    expect(replay.actions).toEqual([
      { type: "act", action: "unlock", args: { thing: { $ref: "door" } }, label: "Unlock it" },
      { type: "act", action: "open", args: { thing: { $ref: "door" } }, label: "Open the door" },
    ]);
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Hall" }).playReplay(replay);
    expect(door.isOpen).toBe(true);
  });
});

describe("stages", () => {
  it("are rulebooks: a rule can be added, replaced, or removed", () => {
    const story = begin();
    // #region rules
    open.check.rule(
      "not while the bell rings",
      ({ thing }) => (bell.rung > 0 ? `The bell drowns out the ${thing.name}.` : undefined),
      { before: "open: own" },
    );
    // #endregion
    added.push(() => {
      open.check.remove("not while the bell rings");
    });
    choose(story, "Ring the bell");
    expect(statusOf(open({ thing: door })).disabled).toBe("The bell drowns out the cellar door.");
    open.check.replace("not while the bell rings", () => undefined);
    expect(statusOf(open({ thing: door })).disabled).toBe("It's locked.");
  });

  it("apply to every action through everyAction", () => {
    const story = begin();
    everyAction.check.rule("not after midnight", () => "It's too late for that.");
    added.push(() => {
      everyAction.check.remove("not after midnight");
    });
    expect(story.render().choices).toEqual([]);
    expect(statusOf(ring({ thing: bell })).disabled).toBe("It's too late for that.");
  });

  it("can be performed from code, and refuse with their reason", () => {
    begin();
    expect(perform(open({ thing: door }))).toEqual({ done: false, reason: "It's locked." });
    expect(results()).toEqual(["It's locked."]);
  });

  it("spend time through the actionTime hook, which a clock handles", () => {
    const story = begin();
    const spent: string[] = [];
    hook("actionTime").rule("test clock", ({ action: name, minutes }) => {
      spent.push(`${name} ${String(minutes)}`);
    });
    added.push(() => {
      hook("actionTime").remove("test clock");
    });
    choose(story, "Unlock it");
    choose(story, "Open the door");
    expect(spent).toEqual(["open 1"]); // unlock takes no time
  });

  it("tag their report with reportTags (#387)", () => {
    begin();
    const hum = action<{ thing: typeof bell }>("hum", {
      report: "You hum.",
      reportTags: ["no-log"],
    });
    perform(hum({ thing: bell }));
    perform(ring({ thing: bell }));
    expect(record.events({ kinds: ["action-result"] }).map((e) => e.tags)).toEqual([
      ["no-log"],
      [],
    ]);
  });

  it("explain a name that's taken, or a thing named like the context", () => {
    expect(() => action("open")).toThrow(
      'action "open": another action has this name, perhaps one a package',
    );
    const odd = action<{ actor: typeof door }>("odd");
    expect(() => odd({ actor: door })).toThrow('a thing can\'t be called "actor"');
  });
});

describe("other things, filled in by menus", () => {
  const strike = action<{ thing: typeof bell; tool: typeof hammer }>("strike", {
    on: bell,
    with: { tool: (t) => "isHeavy" in t && t.isHeavy === true },
    label: ({ thing, tool }) => `Strike the ${thing.name} with the ${tool.name}`,
  });
  const tap = action<{ thing: typeof bell; tool: typeof spoon }>("tap", {
    on: bell,
    with: { tool: spoon },
    label: ({ tool }) => `Tap it with the ${tool.name}`,
  });
  const labels = (of: { id: string }) =>
    actionsFor(of)
      .filter((c) => c.action === (strike as unknown) || c.action === (tap as unknown))
      .map((c) => statusOf(c).label);

  it("are fixed things, or, with candidates, the things that suit", () => {
    begin();
    expect(labels(bell)).toEqual(["Tap it with the spoon"]); // no candidates
    useCandidates(() => [door, hammer, spoon]);
    added.push(() => {
      useCandidates(undefined);
    });
    expect(labels(bell)).toEqual(["Strike the bell with the hammer", "Tap it with the spoon"]);
    expect(labels(hammer)).toEqual(["Strike the bell with the hammer"]);
    expect(labels(spoon)).toEqual(["Tap it with the spoon"]);
    expect(labels(door)).toEqual([]);
  });
});
