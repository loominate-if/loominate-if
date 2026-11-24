// @vitest-environment jsdom
import {
  createEventRecord,
  createStore,
  createStory,
  hook,
  redirect,
  type Passage,
} from "@loominate-if/core";
import { afterEach, describe, expect, it } from "vitest";
import { mountPage } from "./page.js";

let shoo = false;
const passages: Passage[] = [
  {
    id: "Shop",
    tags: [],
    body: () => [
      { type: "text", text: "A shop." },
      { type: "link", label: "Fall through", target: "Trapdoor" },
      { type: "link", label: "Pay", target: "Paid" },
      { type: "link", label: "Out", target: "Garden" },
    ],
  },
  {
    id: "Trapdoor",
    tags: [],
    effects: {
      enter: ({ emit }) => {
        emit("perception", { text: "The floor gives way!", sense: "see" });
        redirect("Street");
      },
    },
    body: () => [{ type: "text", text: "A trapdoor." }],
  },
  {
    // What led here, told on arrival with the `lead` tag, as companions coming along (#121).
    id: "Garden",
    tags: [],
    effects: {
      enter: ({ emit }) => {
        emit("action-result", { text: "You and Mira head out." }, ["lead"]);
        emit("action-result", { text: "A bee buzzes." });
      },
    },
    body: () => [{ type: "text", text: "A garden." }],
  },
  {
    id: "Paid",
    tags: [],
    body: () => [
      { type: "text", text: "You pay." },
      { type: "continue", target: "Shop" },
    ],
  },
  {
    id: "Street",
    tags: [],
    body: () => [
      { type: "text", text: "A street." },
      { type: "link", label: "Back in", target: "Shop" },
    ],
  },
];

afterEach(() => {
  if (
    hook("turnEnd")
      .rules()
      .some((r) => r.name === "shoo")
  )
    hook("turnEnd").remove("shoo");
  shoo = false;
});

function play() {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Shop" });
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  const errors: unknown[] = [];
  mountPage(container, { story, record }, { onError: (e) => errors.push(e) });
  const click = (label: string) => {
    const b = [...container.querySelectorAll<HTMLElement>("a, button")].find(
      (x) => x.textContent === label,
    );
    if (!b) throw new Error(`no ${label} in ${container.textContent ?? ""}`);
    b.click();
  };
  const passage = () =>
    [...container.querySelectorAll(".loominate-passage > p")].map((p) => p.textContent);
  const drawer = () =>
    [...container.querySelectorAll(".loominate-turn")].map((t) =>
      [...t.children].map((p) => p.textContent),
    );
  return { story, click, passage, drawer, errors };
}

describe("a redirected move on the page", () => {
  it("shows where the player was sent, from an effect", () => {
    const { story, click, passage, errors } = play();
    click("Fall through");
    expect([story.current, errors]).toEqual(["Street", []]);
    // What led to the redirect comes first, before the passage the player was sent to.
    expect(passage()).toEqual(["The floor gives way!", "A street.", "Back in"]);
  });

  it("puts a notice tagged lead before the passage's text, wherever it was recorded", () => {
    const { click, passage } = play();
    click("Out");
    expect(passage()).toEqual(["You and Mira head out.", "A garden.", "A bee buzzes."]);
  });

  it("puts what led to it between the two passages in the story so far", () => {
    const { click, drawer } = play();
    click("Fall through");
    click("Back in");
    expect(drawer().at(-1)).toEqual(["A trapdoor.", "The floor gives way!", "A street."]);
  });

  it("shows where the player was sent, from the end of the move", () => {
    hook("turnEnd").rule("shoo", () => {
      if (shoo) redirect("Street");
    });
    const { story, click, passage, errors } = play();
    shoo = true;
    click("Pay");
    expect([story.current, errors]).toEqual(["Street", []]);
    expect(passage()).toEqual(["A street.", "Back in"]);
  });
});
