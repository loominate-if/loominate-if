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
    const b = [...container.querySelectorAll("button")].find((x) => x.textContent === label);
    if (!b) throw new Error(`no ${label} in ${container.textContent ?? ""}`);
    b.click();
  };
  const passage = () =>
    [...container.querySelectorAll(".loominate-passage > p")].map((p) => p.textContent);
  return { story, click, passage, errors };
}

describe("a redirected move on the page", () => {
  it("shows where the player was sent, from an effect", () => {
    const { story, click, passage, errors } = play();
    click("Fall through");
    expect([story.current, errors]).toEqual(["Street", []]);
    // What was noticed on the way stays with the move.
    expect(passage()).toEqual(["A street.", "The floor gives way!", "Back in"]);
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
