import { afterEach, describe, expect, it } from "vitest";
import { action, actLink, type ActionCall } from "../actions/actions.js";
import { createEventRecord } from "../events/record.js";
import { createHistory } from "../state/history.js";
import { object } from "../objects/objects.js";
import { hook } from "../rules/hooks.js";
import { createStore } from "../state/store.js";
import { createStory, type MoveKind, type Passage } from "./story.js";

const lamp = object("moves-lamp", { name: "lamp", lit: false });
const light = action<{ thing: typeof lamp }>("moves-light", {
  run: ({ thing }) => {
    thing.lit = true;
  },
});

// #region outside
// A note the player keeps: outside the story, so writing it isn't a turn.
const notebook = object("moves-notebook", { text: "" });
const jot = action<{ text: string }>("moves-jot", {
  turn: false,
  run: ({ text }) => {
    notebook.text = text;
  },
});
// #endregion outside

const passages: Passage[] = [
  {
    id: "Hall",
    tags: [],
    body: () => [
      { type: "text", text: "A hall." },
      { type: "link", label: "Read the sign", target: "Sign" },
      {
        type: "link",
        label: "Light the lamp",
        target: "Light",
        guard: actLink({ call: light({ thing: lamp }) }),
      },
    ],
  },
  {
    id: "Sign",
    tags: [],
    body: () => [
      { type: "text", text: "It says: mind the step." },
      { type: "beat" },
      { type: "text", text: "Underneath: really." },
      { type: "continue", target: "Hall" },
    ],
  },
];

const heard: MoveKind[] = [];
afterEach(() => {
  heard.length = 0;
  hook("turnEnd").remove("listen");
});

describe("moves", () => {
  it("say what kind they are, and continues and beats don't count", () => {
    hook("turnEnd").rule("listen", ({ move }) => {
      heard.push(move);
    });
    const store = createStore();
    const story = createStory(store, createEventRecord(store), passages, { start: "Hall" });
    story.begin();
    const choose = (label: string) => {
      const c = story
        .render()
        .choices.find((x) => (x.type === "continue" ? "Continue" : x.label) === label);
      if (!c) throw new Error(`no ${label}`);
      story.follow(c);
    };
    choose("Read the sign");
    story.advance(); // past the beat: not a move
    choose("Continue");
    choose("Light the lamp");
    story.goTo("Sign");
    expect(heard).toEqual(["follow", "continue", "act", "goTo"]);
    expect(story.actions.map((a) => a.type)).toEqual([
      "follow",
      "advance",
      "follow",
      "act",
      "goTo",
    ]);
    expect(story.moves).toBe(3);
  });
});

describe("an action outside the story (turn: false, #397)", () => {
  it("is logged and changes state, but isn't a turn", () => {
    hook("turnEnd").rule("listen", ({ move }) => {
      heard.push(move);
    });
    const store = createStore();
    const story = createStory(store, createEventRecord(store), passages, { start: "Hall" });
    story.begin();
    story.act(jot({ text: "Mind the step." }) as unknown as ActionCall);
    expect(notebook.text).toBe("Mind the step.");
    expect(heard).toEqual([]);
    expect(story.moves).toBe(0);
    expect(story.actions.map((a) => a.type)).toEqual(["act"]);
    story.goTo("Sign");
    expect(heard).toEqual(["goTo"]);
    expect(story.moves).toBe(1);
  });

  it("is undone, and replayed, like any action", () => {
    hook("turnEnd").rule("listen", ({ move }) => {
      heard.push(move);
    });
    const store = createStore();
    const story = createStory(store, createEventRecord(store), passages, { start: "Hall" });
    const history = createHistory(store);
    story.begin();
    history.checkpoint("begun");
    story.act(jot({ text: "Mind the step." }) as unknown as ActionCall);
    history.checkpoint("jotted");
    const replay = story.toReplay();
    const jotted = store.snapshot();
    history.undo();
    expect(notebook.text).toBe("");
    // A replay of it gives the same state as writing it did.
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Hall" }).playReplay(replay);
    expect(again.snapshot()).toEqual(jotted);
  });
});
