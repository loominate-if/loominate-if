import {
  actLink,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  readReplay,
  writeReplay,
  type EventRecord,
  type LinkNode,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  closingTime,
  connect,
  door,
  enterRoom,
  exitLinks,
  minutes,
  openingHours,
  place,
  registerRoom,
  startAs,
  startClock,
  thing,
  timeOfDay,
  wait,
  type Place,
} from "./index.js";

startClock({ at: "16:50" });
export const street = place("street", { name: "street" });
export const bakery = place("bakery", { name: "bakery" });
export const bakeryDoor = thing("bakeryDoor", {
  ...door,
  ...openingHours({ of: bakery, open: "09:00", close: "17:00" }),
  name: "bakery door",
  isOpen: true,
});
connect(street, { in: { to: bakery, via: bakeryDoor } });
connect(bakery, { out: { to: street, via: bakeryDoor } });
export const till = thing("till", { name: "till", isPaying: false, location: bakery });
// #region closing
closingTime(bakeryDoor, [
  { after: minutes(5), say: "The baker glares at you over the counter." },
  {
    after: minutes(20),
    say: "“We're closed, dear,” says the baker, and shows you out.",
    moveTo: street,
    unless: () => till.isPaying,
  },
]);
// #endregion
const you = actor("you", { body: { name: "you", location: bakery } });
startAs(you);

const waitLink = (n: number): LinkNode => ({
  type: "link",
  label: `Wait ${String(n)} minutes`,
  target: "Wait",
  guard: actLink({ call: wait({ minutes: n }) }),
});
const room = (id: string, r: Place, extra: LinkNode[] = []): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [...exitLinks(), waitLink(5), waitLink(30), ...extra],
  };
};
const passages: Passage[] = [
  room("Bakery", bakery, [
    { type: "link", label: "Start paying", target: "Paying" },
    { type: "link", label: "Finish paying", target: "Paid" },
  ]),
  room("Street", street),
  {
    id: "Paying",
    tags: [],
    effects: { enter: () => void (till.isPaying = true) },
    body: () => [{ type: "continue", target: "Bakery" }],
  },
  {
    id: "Paid",
    tags: [],
    effects: { enter: () => void (till.isPaying = false) },
    body: () => [{ type: "text", text: "You pay for the bread." }],
  },
];

let store: StateStore;
let record: EventRecord;
let story: Story;
const begin = () => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Bakery" });
};
beforeEach(() => {
  begin();
  story.begin();
});
const choose = (label: string) => {
  const c = story
    .render()
    .choices.find((x) => (x.type === "continue" ? "Continue" : x.label)?.startsWith(label));
  if (!c) throw new Error(`no ${label} in ${story.current ?? ""}`);
  story.follow(c);
};
const told = () => record.events({ kinds: ["scheduled", "action-result"] }).map((e) => e.text);

describe("closing time", () => {
  it("glares, then shows the customer out, each step stopping a wait", () => {
    // #region shown out
    choose("Wait 30 minutes"); // to 17:20, but the glare at 17:05 stops it
    expect([timeOfDay(), story.current]).toEqual(["5:05 pm", "Bakery"]);
    choose("Wait 30 minutes");
    expect([timeOfDay(), story.current]).toEqual(["5:20 pm", "Street"]);
    expect(told()).toEqual([
      "The baker glares at you over the counter.",
      "Your wait ends at 5:05 pm.",
      "“We're closed, dear,” says the baker, and shows you out.",
      "Your wait ends at 5:20 pm.",
    ]);
    // #endregion
    expect(story.moves).toBe(2);
  });

  it("leaves alone a customer who goes", () => {
    choose("Wait 30 minutes"); // the glare, at 17:05
    choose("Out");
    choose("Wait 30 minutes");
    expect(told().filter((t) => t.includes("shows you out"))).toEqual([]);
    expect(story.current).toBe("Street");
  });

  it("waits while the customer is paying, then shows them out", () => {
    choose("Start paying");
    choose("Continue");
    choose("Wait 30 minutes");
    choose("Wait 30 minutes"); // 17:20 comes and goes: still paying
    expect(story.current).toBe("Bakery");
    choose("Finish paying"); // the next move: shown out
    expect(story.current).toBe("Street");
    expect(told().at(-1)).toBe("“We're closed, dear,” says the baker, and shows you out.");
  });

  it("does nothing if no one is inside at closing", () => {
    choose("Out");
    choose("Wait 30 minutes");
    expect(told()).toEqual(["You wait 30 minutes."]);
  });

  it("is undone and replayed with the game", () => {
    const history = createHistory(store);
    history.checkpoint("begun");
    choose("Wait 30 minutes");
    history.checkpoint("glared");
    choose("Wait 30 minutes");
    history.checkpoint("out");
    history.undo();
    expect(story.current).toBe("Bakery");
    history.redo();
    const replay = readReplay(writeReplay(story.toReplay()));
    const before = told();
    begin();
    story.playReplay(replay);
    expect([story.current, told()]).toEqual(["Street", before]);
  });
});
