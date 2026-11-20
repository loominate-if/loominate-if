import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { object, resetObjects } from "../objects/objects.js";
import { createStore } from "../state/store.js";
import { continueTo, linkGuard, namedEffect } from "./directives.js";
import { createStory } from "./story.js";

describe("core's directive functions", () => {
  it("make continue points, with a label only when given", () => {
    expect(continueTo({ target: "Platform" })).toEqual({ type: "continue", target: "Platform" });
    expect(continueTo({ target: "Platform", label: "On" })).toEqual({
      type: "continue",
      target: "Platform",
      label: "On",
    });
  });

  it("make link guards, where a reason means disabled with it", () => {
    const condition = { value: false, text: "lantern.isLit" };
    expect(linkGuard({ condition })).toEqual({ open: false, condition: "lantern.isLit" });
    expect(linkGuard({ condition, mode: "hidden" })).toEqual({
      open: false,
      condition: "lantern.isLit",
      mode: "hidden",
    });
    expect(linkGuard({ condition: { ...condition, value: true }, reason: "Too dark." })).toEqual({
      open: true,
      condition: "lantern.isLit",
      mode: "disabled-with-reason",
      reason: "Too dark.",
    });
  });

  it("explain a closed guard with its parts' values, written for the inspector", () => {
    resetObjects();
    const shed = object("shed", { name: "shed" });
    const reads: string[] = [];
    const part = (text: string, value: unknown) => {
      reads.push(text);
      return { text, value };
    };
    const condition = {
      value: false,
      text: "lamp.where === shed && lamp.tags.length > 0",
      parts: () => [
        part("lamp.where", shed),
        part("lamp.tags", ["brass", 2, null]),
        part("lamp.opts", { bright: true, name: "lamp" }),
        part("lamp.label", "Lamp"),
        part("lamp.gone", undefined),
        { text: "door.open", error: "Cannot read properties of null (reading 'open')" },
      ],
    };
    expect(linkGuard({ condition }).parts).toEqual([
      { text: "lamp.where", value: "→ shed" },
      { text: "lamp.tags", value: '["brass", 2, null]' },
      { text: "lamp.opts", value: '{ bright: true, name: "lamp" }' },
      { text: "lamp.label", value: '"Lamp"' },
      { text: "lamp.gone", value: "undefined" },
      { text: "door.open", error: "Cannot read properties of null (reading 'open')" },
    ]);
    // An open guard has nothing to explain, so its parts are never evaluated.
    reads.length = 0;
    expect(linkGuard({ condition: { ...condition, value: true } })).not.toHaveProperty("parts");
    expect(reads).toEqual([]);
    // Parts that can't be listed at all are left out, and the guard still works.
    const broken = {
      ...condition,
      parts: () => {
        throw new Error("no");
      },
    };
    expect(linkGuard({ condition: broken })).toEqual({ open: false, condition: condition.text });
  });

  it("make named effects, with a duration and options only when given", () => {
    expect(namedEffect({ name: ["fade"] })).toEqual({ type: "effect", name: "fade" });
    expect(
      namedEffect({ name: ["typewriter"], duration: 2000, options: { cursor: true } }),
    ).toEqual({ type: "effect", name: "typewriter", duration: 2000, options: { cursor: true } });
    expect(() => namedEffect({ name: ["fade", "in"] })).toThrow(
      "{effect fade in}: an effect's name is one word, such as {effect fade}.",
    );
  });
});

describe("named effects in a passage", () => {
  it("are rendered in order, and change neither state nor the event record", () => {
    const store = createStore();
    const record = createEventRecord(store);
    const story = createStory(
      store,
      record,
      [
        {
          id: "Door",
          tags: [],
          body: () => [
            namedEffect({ name: ["shake"] }),
            { type: "text", text: "The door bursts open." },
            namedEffect({ name: ["fade"], duration: 300 }),
            { type: "link", label: "Run", target: "Door" },
          ],
        },
      ],
      { start: "Door" },
    );
    story.begin();
    expect(story.render().nodes.map((n) => n.type)).toEqual(["effect", "text", "effect", "link"]);
    expect(story.render().choices).toHaveLength(1);
    expect(record.events().map((e) => e.kind)).not.toContain("effect");
    expect(JSON.stringify(record.events())).not.toContain("shake");
  });
});
