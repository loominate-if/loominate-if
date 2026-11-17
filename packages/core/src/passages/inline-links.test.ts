import { describe, expect, it } from "vitest";
import { createEventRecord } from "../events/record.js";
import { createStore } from "../state/store.js";
import { StateError } from "../state/value.js";
import { emphasis, prose } from "./prose.js";
import {
  createStory,
  type GuardMode,
  type LinkNode,
  type Passage,
  type TextNode,
} from "./story.js";

const ask = (open?: boolean, mode?: GuardMode, reason?: string): LinkNode => ({
  type: "link",
  label: "ask about it",
  target: "Hall",
  ...(open !== undefined && {
    guard: {
      open,
      condition: "met",
      ...(mode !== undefined && { mode }),
      ...(reason !== undefined && { reason }),
    },
  }),
});

function setup(...body: Passage["body"][]) {
  const store = createStore();
  const record = createEventRecord(store);
  const passages: Passage[] = [
    { id: "A", tags: [], body: body[0] ?? (() => []) },
    { id: "Hall", tags: [], body: () => [{ type: "text", text: "A long hall." }] },
    { id: "B", tags: [], body: () => [] },
  ];
  const story = createStory(store, record, passages, { start: "A" });
  story.begin();
  return { story, record };
}

describe("prose with links", () => {
  it("puts a link's label in the text and records its range", () => {
    expect(prose(["You could ", ask(), " now."])).toEqual({
      type: "text",
      text: "You could ask about it now.",
      links: [{ ...ask(), start: 10, end: 22 }],
    });
  });

  it("lets a style contain a link", () => {
    expect(prose([emphasis("Or ", ask()), "."])).toEqual({
      type: "text",
      text: "Or ask about it.",
      styles: [{ start: 0, end: 15, style: "emphasis" }],
      links: [{ ...ask(), start: 3, end: 15 }],
    });
  });
});

describe("inline links in a story", () => {
  it("renders an open link as a choice in reading order, and follows it", () => {
    const { story, record } = setup(() => [
      prose(["You could ", ask(), " now."]),
      { type: "link", label: "Leave", target: "B" },
    ]);
    const page = story.render();
    expect(page.nodes[0]).toEqual({
      type: "text",
      text: "You could ask about it now.",
      links: [{ ...ask(), start: 10, end: 22, available: true }],
    });
    expect(page.choices.map((c) => c.label)).toEqual(["ask about it", "Leave"]);
    story.follow(ask());
    expect(story.current).toBe("Hall");
    // The narrative keeps the whole sentence.
    expect(record.events({ kinds: ["narrative"] })[0]?.text).toBe("You could ask about it now.");
  });

  it("keeps a hidden link's label as plain text", () => {
    const { story } = setup(() => [prose(["You could ", ask(false, "hidden"), " now."])]);
    const page = story.render();
    expect(page.nodes).toEqual([{ type: "text", text: "You could ask about it now." }]);
    expect(page.choices).toEqual([]);
    expect(page.unavailable).toEqual([
      { link: { ...ask(false, "hidden"), start: 10, end: 22 }, mode: "hidden", condition: "met" },
    ]);
    expect(() => {
      story.follow(ask(false, "hidden"));
    }).toThrow(/unavailable because its condition `met` doesn't hold/);
  });

  it("shows a disabled link, with its reason", () => {
    const { story } = setup(() => [
      prose(["You could ", ask(false, "disabled-with-reason", "Not yet."), " now."]),
    ]);
    const [text] = story.render().nodes;
    expect(text).toMatchObject({
      links: [{ label: "ask about it", available: false, reason: "Not yet.", start: 10, end: 22 }],
    });
  });

  it("rejects links that don't fit, don't match their label, overlap, or cross a style", () => {
    const bad = (node: TextNode) => () => setup(() => [node]);
    const link = (start: number, end: number, label = "abc".slice(start, end)) => ({
      type: "link" as const,
      label,
      target: "Hall",
      start,
      end,
    });
    expect(bad({ type: "text", text: "abc", links: [link(1, 9, "bc")] })).toThrow(
      `passage "A": the link "bc" at 1–9 doesn't fit the text "abc". Inline links need 0 ≤ start < end ≤ text length, in order, without overlapping.`,
    );
    expect(bad({ type: "text", text: "abc", links: [link(0, 2), link(1, 3)] })).toThrow(
      /doesn't fit/,
    );
    expect(bad({ type: "text", text: "abc", links: [link(0, 2, "xy")] })).toThrow(
      `passage "A": the link "xy" at 0–2 covers "ab", not its label. An inline link's label is the text it covers.`,
    );
    expect(
      bad({
        type: "text",
        text: "abc",
        styles: [{ start: 1, end: 3, style: "strong" }],
        links: [link(0, 2)],
      }),
    ).toThrow(
      `passage "A": the link "ab" at 0–2 and the strong 1–3 style partly overlap. A style may contain a link or sit inside its label, but not cross it.`,
    );
    expect(bad({ type: "text", text: "abc", links: [link(0, 0, "")] })).toThrow(StateError);
  });
});
