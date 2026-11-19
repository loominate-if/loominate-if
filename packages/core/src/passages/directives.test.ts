import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
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
