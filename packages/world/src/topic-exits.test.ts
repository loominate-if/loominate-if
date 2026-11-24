import {
  continueTo,
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  statusOf,
  type ActionCall,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  ask,
  connect,
  conversation,
  convNode,
  enterRoom,
  exitLinks,
  goodbye,
  no,
  place,
  placeOf,
  registerRoom,
  startAs,
  topic,
  topicLinks,
  topics,
  yes,
  type Place,
  conversationMode,
} from "./index.js";

const parlour = place("parlour", { name: "parlour" });
const hall = place("hall", { name: "hall" });
connect(parlour, { east: hall });
connect(hall, { west: parlour });
const you = actor("you", { body: { name: "you", location: parlour } });
const inspector = actor("inspector", { body: { name: "inspector", location: parlour } });
const widow = actor("widow", { body: { name: "widow", location: parlour } });
const { murder, husband, will } = topics({
  murder: "the murder",
  husband: "her husband",
  will: "the will",
});
startAs(you);
// These test {topics} in the passage, which conversation mode's layout lists instead (#118).
conversationMode(false);

// #region exits
export const accusation = convNode(inspector, "accusation", {
  exit: "hard",
  presses: "“Answer the question.”",
});
topic(inspector, { ask: murder, opens: accusation, says: "“Did you do it?”" });
topic(inspector, { no: true, in: accusation, says: "“We'll see.”" });

export const confession = convNode(widow, "confession", {
  exit: "soft",
  objects: "“Please, I haven't finished!”",
});
topic(widow, { ask: will, opens: confession, says: "“There's something you should know.”" });
topic(widow, { ask: husband, hearMeOut: "The widow's tale", says: "“Let me tell you about him.”" });
// #endregion

const room = (id: string, r: Place): Passage => {
  registerRoom(r, { id, tags: [`room: ${r.id}`] });
  return {
    id,
    tags: [`room: ${r.id}`],
    effects: { enter: () => enterRoom(r) },
    body: () => [...topicLinks(), ...exitLinks()],
  };
};
const passages: Passage[] = [
  room("Parlour", parlour),
  room("Hall", hall),
  {
    id: "The widow's tale",
    tags: ["cutscene"],
    body: () => [
      { type: "text", text: "He was a hard man, she says, and a careful one." },
      continueTo({ back: "back" }),
    ],
  },
];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Parlour" });
  story.begin();
  seen = 0;
});
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};
let seen = 0;
const said = () => {
  const all = record.events({ kinds: ["action-result"] }).filter((e) => !e.tags.includes("player"));
  const out = all.slice(seen).map((e) => e.text);
  seen = all.length;
  return out;
};
const choice = (label: string) =>
  story.render().choices.find((c) => (c.label ?? "Continue").startsWith(label));
/** A link shown disabled, with its reason. */
const disabled = (label: string) =>
  story.render().unavailable.find((u) => u.link.label.startsWith(label))?.link.guard?.reason;
const follow = (label: string) => {
  const c = choice(label);
  if (!c)
    throw new Error(
      `no ${label}: ${story
        .render()
        .choices.map((x) => x.label)
        .join(", ")}`,
    );
  story.follow(c);
};

describe("exit control (#117)", () => {
  it("is free by default: goodbye and the exits work", () => {
    act(ask({ who: inspector, about: will }));
    expect(conversation.exit).toBe("free");
    act(goodbye({}));
    expect(conversation.active).toBe(false);
  });

  it("holds the player with a hard lock until they answer: goodbye and exits disabled, with why", () => {
    act(ask({ who: inspector, about: murder }));
    expect(conversation.exit).toBe("hard");
    expect(statusOf(goodbye({})).disabled).toBe("You can't leave until you answer the inspector.");
    expect(disabled("East")).toBe("You can't leave until you answer the inspector.");
    expect(story.render().choices.map((c) => c.label)).toEqual(["Say no"]);
    act(ask({ who: inspector, about: will })); // changing the subject is pressed
    act(yes({})); // not a reply he has: pressed too
    expect(said().slice(1)).toEqual(["“Answer the question.”", "“Answer the question.”"]);
    act(no({}));
    expect([said(), conversation.exit, disabled("East")]).toEqual([
      ["“We'll see.”"],
      "free",
      undefined,
    ]);
  });

  it("meets the first try at leaving with an objection under a soft lock, and lets the player insist", () => {
    act(ask({ who: widow, about: will }));
    expect(conversation.exit).toBe("soft");
    act(goodbye({}));
    expect([said().at(-1), conversation.active]).toEqual(["“Please, I haven't finished!”", true]);
    act(goodbye({}));
    expect(conversation.active).toBe(false);
  });

  it("does the same for the room's exits under a soft lock", () => {
    act(ask({ who: widow, about: will }));
    follow("East");
    expect([said().at(-1), placeOf(you)?.id]).toEqual(["“Please, I haven't finished!”", "parlour"]);
    follow("East");
    expect([placeOf(you)?.id, conversation.active]).toEqual(["hall", false]);
  });

  it("tells a cut scene for hear me out, then returns to the conversation", () => {
    act(ask({ who: widow, about: husband }));
    expect(story.current).toBe("The widow's tale");
    expect(conversation.addressee?.id).toBe("widow");
    follow("Continue");
    expect([story.current, conversation.addressee?.id]).toEqual(["Parlour", "widow"]);
  });

  it("can always be undone, through a lock", () => {
    const history = createHistory(store);
    history.clear();
    store.commit();
    act(ask({ who: inspector, about: murder }));
    history.checkpoint();
    expect(conversation.exit).toBe("hard");
    history.undo();
    expect([conversation.active, conversation.exit]).toEqual([false, "free"]);
  });

  it("give the same state for the same moves (determinism)", () => {
    act(ask({ who: widow, about: will }));
    follow("East");
    follow("East");
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Parlour" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
