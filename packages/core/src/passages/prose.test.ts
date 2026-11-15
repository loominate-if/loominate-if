import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { createStore } from "../state/store.js";
import { StateError } from "../state/value.js";
import { emphasis, prose, strong } from "./prose.js";
import { createStory, type Passage, type TextNode } from "./story.js";

describe("prose", () => {
  it("builds plain text with no styles", () => {
    expect(prose(["Fog has ", "swallowed the platform."])).toEqual({
      type: "text",
      text: "Fog has swallowed the platform.",
    });
  });

  it("turns styled parts into ranges over the text", () => {
    expect(prose(["It goes ", emphasis("further"), " than ", strong("that"), "."])).toEqual({
      type: "text",
      text: "It goes further than that.",
      styles: [
        { start: 8, end: 15, style: "emphasis" },
        { start: 21, end: 25, style: "strong" },
      ],
    });
  });

  it("nests styles, outer range first", () => {
    expect(prose([strong("very ", emphasis("much"), " so")]).styles).toEqual([
      { start: 0, end: 12, style: "strong" },
      { start: 5, end: 9, style: "emphasis" },
    ]);
  });

  it("prints numbers and drops styles that end up empty", () => {
    const depth = 40;
    const name = "";
    expect(prose(["Down ", strong(depth), " feet", emphasis(name), "."])).toEqual({
      type: "text",
      text: "Down 40 feet.",
      styles: [{ start: 5, end: 7, style: "strong" }],
    });
  });

  it("carries a line ID", () => {
    expect(prose(["a"], { line: "p#1" })).toEqual({ type: "text", text: "a", line: "p#1" });
  });
});

describe("styles in a story", () => {
  const setup = (node: TextNode) => {
    const store = createStore();
    const record = createEventRecord(store);
    const passages: Passage[] = [{ id: "A", tags: [], body: () => [node] }];
    return { record, story: createStory(store, record, passages, { start: "A" }) };
  };

  it("renders styles and records them on narrative events", () => {
    const node = prose(["It goes ", emphasis("further"), "."], { line: "a#1" });
    const { story, record } = setup(node);
    story.begin();
    expect(story.render().nodes).toEqual([node]);
    expect(record.events({ kinds: ["narrative"] })).toEqual([
      {
        seq: 1,
        kind: "narrative",
        tags: [],
        text: "It goes further.",
        styles: [{ start: 8, end: 15, style: "emphasis" }],
        line: "a#1",
      },
    ]);
  });

  it("rejects styles that don't fit the text, or that cross", () => {
    const outside = setup({
      type: "text",
      text: "abc",
      styles: [{ start: 1, end: 9, style: "strong" }],
    });
    expect(() => {
      outside.story.begin();
    }).toThrow(StateError);
    // The failed move leaves nothing behind, so the same error comes again.
    expect(outside.story.current).toBeUndefined();
    expect(() => {
      outside.story.begin();
    }).toThrow(
      `passage "A": the strong 1–9 style doesn't fit the text "abc". Styles need 0 ≤ start < end ≤ text length.`,
    );
    const empty = setup({
      type: "text",
      text: "abc",
      styles: [{ start: 1, end: 1, style: "strong" }],
    });
    expect(() => {
      empty.story.begin();
    }).toThrow(/doesn't fit/);
    const crossing = setup({
      type: "text",
      text: "abcdef",
      styles: [
        { start: 0, end: 3, style: "strong" },
        { start: 2, end: 5, style: "emphasis" },
      ],
    });
    expect(() => {
      crossing.story.begin();
    }).toThrow(
      `passage "A": the strong 0–3 and emphasis 2–5 styles partly overlap. Styles may nest but not cross.`,
    );
  });
});
