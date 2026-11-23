import { afterEach, describe, expect, it } from "vitest";
import { action, actLink } from "../actions/actions.js";
import { createEventRecord } from "../events/record.js";
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
