// @vitest-environment jsdom
import {
  createEventRecord,
  createStore,
  createStory,
  object,
  type ActionCall,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { panels, type PanelContext } from "@loominate-if/inspector";
import axe from "axe-core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _topicRows,
  actor,
  anything,
  ask,
  convNode,
  hello,
  place,
  startAs,
  topic,
  topicBlock,
  topics,
} from "@loominate-if/world";
import "./inspector.js";

const study = place("study", { name: "study" });
const you = actor("you", { body: { name: "you", location: study } });
const maid = actor("maid", { body: { name: "maid", location: study } });
const cook = actor("cook", { body: { name: "cook", location: study } });
startAs(you);
const { tea, weather, affair } = topics({
  tea: "tea",
  weather: "the weather",
  affair: { name: "the affair", known: false },
});
const kitchen = object("panelKitchen", { open: false });
const teaQuestion = convNode(maid, "tea", {
  restricts: true,
  exit: "soft",
  objects: "“But miss, the tea?”",
});
topic(maid, { ask: tea, opens: teaQuestion, says: "“Tea, miss?”" });
topic(maid, { yes: true, in: teaQuestion, says: "“Right away.”" });
topic(maid, { ask: weather, priority: 2, when: () => kitchen.open, says: "“Cold.”" });
topic(maid, { ask: affair, says: "“Hush!”" });
topic(maid, { askOrTell: anything, says: "“I wouldn't know.”" });
topic(cook, { ask: tea, says: "“Kettle's on.”" });
// A compiled block's condition keeps its source and parts, as {ask weather, when: kitchen.open}.
const gardener = actor("gardener", { body: { name: "gardener", location: study } });
topicBlock(
  {
    about: weather,
    when: () => ({
      value: kitchen.open,
      text: "kitchen.open",
      parts: () => [{ text: "kitchen.open", value: kitchen.open }],
    }),
  },
  { id: "Gardener#L3", tags: ["actor: gardener"], body: () => [] },
  { id: "Gardener", directive: "ask", roles: { actor: gardener } },
);

let store: StateStore;
let story: Story;
beforeEach(() => {
  store = createStore();
  story = createStory(
    store,
    createEventRecord(store),
    [{ id: "Study", tags: [], body: () => [] }],
    {
      start: "Study",
    },
  );
  story.begin();
});
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};

function mount() {
  const element = document.createElement("div");
  document.body.replaceChildren(element);
  const view = panels
    .get("conversation")
    ?.mount(element, { player: { store } } as unknown as PanelContext);
  const rows = (index: number) =>
    [...(element.querySelectorAll("table")[index]?.querySelectorAll("tbody tr") ?? [])].map((r) =>
      [...r.children].map((c) => c.textContent).join(" | "),
    );
  const select = (id: string) => {
    const picker = element.querySelector("select");
    if (!picker) throw new Error("no picker");
    picker.value = id;
    picker.dispatchEvent(new Event("change"));
  };
  return { element, update: () => view?.update(), rows, select };
}

describe("the Conversation panel (#119)", () => {
  it("says when the player isn't talking, and why a character's topics aren't suggested", () => {
    expect(panels.get("conversation")?.title).toBe("Conversation");
    const { element, rows } = mount();
    expect(element.textContent).toContain("The player isn't talking to anyone.");
    expect(rows(0)[0]).toBe(
      "Ask the maid about teamaid:mind:ask:topic:tea#1opens: tea | — | Yes | No: The player isn't talking to them.",
    );
  });

  it("shows the conversation now: who's in it, their node, the exit, and each lock with what holds it", () => {
    act(hello({ who: maid }));
    act(ask({ who: maid, about: tea }));
    const { element, rows } = mount();
    expect(element.textContent).toContain(
      "the maid (addressed), node tea (restrictive), soft exit",
    );
    expect(element.textContent).toContain("Exit: soft");
    expect(rows(0)).toEqual(["soft | the maid's node tea | “But miss, the tea?”"]);
  });

  it("explains each topic: conditions as written, whether it answers, and why it isn't suggested", () => {
    act(hello({ who: maid }));
    act(ask({ who: maid, about: tea }));
    const { rows } = mount();
    expect(rows(1)).toEqual([
      "Ask the maid about teamaid:mind:ask:topic:tea#1opens: tea | — | No: Its node, tea, is open and restrictive, so the NPC presses the point instead. | No: The node tea is open and restrictive, so only its replies are suggested.",
      "Say yes to the maidmaid:mind:yes#2in the node tea | — | Yes | Yes",
      "Ask the maid about the weathermaid:mind:ask:topic:weather#3priority 2 | kitchen.open: false | No: Its condition is false. | No: It wouldn't answer now: Its condition is false.",
      "Ask the maid about the affairmaid:mind:ask:topic:affair#4 | — | No: Its node, tea, is open and restrictive, so the NPC presses the point instead. | No: The player doesn't know of the affair.",
      "Ask or tell the maid about anything elsemaid:mind:ask|tell:*#5 | — | No: Its node, tea, is open and restrictive, so the NPC presses the point instead. | No: Catch-alls aren't suggested; they answer whatever has no entry of its own.",
    ]);
  });

  it("shows another character's topics when chosen, kept across updates", () => {
    act(hello({ who: maid }));
    const { element, rows, select, update } = mount();
    select("cook");
    update();
    expect(element.querySelector("select")?.value).toBe("cook");
    expect(rows(0)).toEqual([
      "Ask the cook about teacook:mind:ask:topic:tea#1 | — | Yes | No: The player isn't talking to them.",
    ]);
  });

  it("shows a topic block's condition as written, with its parts", () => {
    expect(_topicRows(gardener)[0]?.condition).toEqual({
      text: "kitchen.open",
      value: false,
      parts: [{ text: "kitchen.open", value: false }],
    });
  });

  it("passes automated accessibility checks", async () => {
    act(hello({ who: maid }));
    const { element } = mount();
    expect((await axe.run(element)).violations).toEqual([]);
  });
});
