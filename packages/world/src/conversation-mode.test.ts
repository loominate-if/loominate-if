import {
  continueTo,
  createEventRecord,
  createStore,
  createStory,
  object,
  type ActionCall,
  type EventRecord,
  type Passage,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import {
  _actionListOf,
  display,
  storyLog,
  widgets,
  type ActionListData,
  type CastData,
  type WidgetHost,
} from "@loominate-if/presentation";
import { beforeEach, describe, expect, it } from "vitest";
import {
  _addressAction,
  _cast,
  agenda,
  actor,
  approach,
  ask,
  clock,
  conversation,
  convNode,
  expressionOf,
  goodbye,
  hello,
  joinConversation,
  place,
  portrait,
  schedule,
  setExpression,
  startAs,
  startClock,
  topic,
  topics,
  yes,
} from "./index.js";

const study = place("study", { name: "study" });
const garden = place("garden", { name: "garden" });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: study } });
const gardener = actor("gardener", { body: { name: "Mr Jenkins", location: study } });
const cook = actor("cook", { body: { name: "cook", location: study } });
startAs(you);
startClock({ at: "19:58" });
const { letter, roses } = topics({ letter: "the letter", roses: "the roses" });

// #region portraits
portrait(butler, { image: "butler.png", expressions: { stern: "butler-stern.png" } });
topic(butler, { ask: letter, expression: "stern", says: "“I couldn't say, sir.”" });
// #endregion
topic(gardener, { ask: roses, says: "“Coming on nicely.”" });
topic(gardener, { bye: true, implicit: true, says: "“Must see to the beds.”" });
// The gardener goes out to the garden at eight, by his timetable.
schedule(gardener, [
  { at: "06:00", in: study },
  { at: "20:00", in: garden },
]);

// #region approach
const dinner = convNode(cook, "dinner", { presses: "“Well? Dinner?”" });
topic(cook, { yes: true, in: dinner, says: "“Good. Eight sharp.”" });
const kitchen = object("kitchen", { isReady: false });
agenda(cook, "announce dinner", {
  ready: () => kitchen.isReady,
  act: ({ npc, done }) => {
    if (approach(npc, { says: "“Will you be wanting dinner?”", opens: dinner })) done();
  },
});
// #endregion

topic(cook, { ask: letter, hearMeOut: "Cook's tale", says: "“Let me tell you.”" });
const passages: Passage[] = [
  { id: "Study", tags: [], body: () => [{ type: "link", label: "Wait", target: "Study" }] },
  {
    id: "Cook's tale",
    tags: ["cutscene"],
    body: () => [{ type: "text", text: "Years ago…" }, continueTo({ back: "back" })],
  },
];
let store: StateStore;
let record: EventRecord;
let story: Story;
beforeEach(() => {
  store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Study" });
  story.begin();
});
const act = <A>(call: ActionCall<A>) => {
  story.act(call as unknown as ActionCall);
};
const said = () =>
  record
    .events({ kinds: ["action-result"] })
    .filter((e) => !e.tags.includes("player"))
    .map((e) => e.text);
const data = <D>(name: string): D => widgets.get(name)?.data({ story, record }) as D;
/** A page, as the widgets see it, making their moves. */
const host = {
  act: (call: ActionCall) => {
    story.act(call);
  },
} as unknown as WidgetHost;

describe("conversation mode (#118)", () => {
  it("switches to the conversation layout while talking, and back after", () => {
    expect(display.layout).toBe("page");
    act(hello({ who: butler }));
    expect(display.layout).toBe("conversation");
    act(goodbye({}));
    expect(display.layout).toBe("page");
  });

  it("shows the cast, with portraits, expressions an entry sets, and initials", () => {
    act(ask({ who: butler, about: letter }));
    joinConversation(gardener);
    expect(_cast()).toEqual([
      {
        id: "butler",
        name: "butler",
        initials: "B",
        addressed: true,
        image: "butler-stern.png",
        expression: "stern",
      },
      { id: "gardener", name: "Mr Jenkins", initials: "MJ", addressed: false },
    ]);
    expect(data<CastData>("conversation-cast").label).toBe("In the conversation");
    setExpression(butler, undefined);
    expect([expressionOf(butler), _cast()[0]?.image]).toEqual([undefined, "butler.png"]);
    expect(() => setExpression(butler, "jolly")).toThrow('has no expression "jolly"');
  });

  it("offers the topics as buttons that take them, and addresses whoever's portrait is chosen", () => {
    act(hello({ who: butler }));
    joinConversation(cook);
    const topicsList = data<ActionListData>("conversation-topics");
    expect(topicsList.items.map((i) => i.label)).toEqual(["Ask about the letter", "Say goodbye"]);
    const take = _actionListOf(widgets.get("conversation-topics") as never)?.take;
    take?.(host, 0);
    expect(said().at(-1)).toBe("“I couldn't say, sir.”");
    // Choosing the cook's portrait turns to her, and the topics are hers: her letter tells a tale.
    act(_addressAction({ who: cook })); // what choosing her portrait takes
    expect(conversation.addressee?.id).toBe("cook");
    expect(data<ActionListData>("conversation-topics").items.map((i) => i.label)).toEqual([
      "Ask about the letter",
      "Say goodbye",
    ]);
  });

  it("ends cleanly when an NPC leaves on their timetable: they say goodbye, and the layout goes back", () => {
    act(hello({ who: gardener })); // 19:59
    act(ask({ who: gardener, about: roses })); // 20:00: off to the garden
    expect(clock.minutes).toBe(2);
    expect([conversation.active, display.layout]).toEqual([false, "page"]);
    expect(said().slice(-2)).toEqual(["“Coming on nicely.”", "“Must see to the beds.”"]);
  });

  it("lets an NPC start one through an agenda item, with approach", () => {
    story.follow({ type: "link", label: "Wait", target: "Study" });
    expect(conversation.active).toBe(false);
    kitchen.isReady = true;
    story.follow({ type: "link", label: "Wait", target: "Study" });
    expect([conversation.addressee?.id, display.layout]).toEqual(["cook", "conversation"]);
    expect(said().at(-1)).toBe("“Will you be wanting dinner?”");
    act(yes({}));
    expect(said().at(-1)).toBe("“Good. Eight sharp.”");
  });

  it("record the player's lines, and where each conversation starts and ends, for the transcript", () => {
    act(hello({ who: butler }));
    act(ask({ who: butler, about: letter }));
    act(goodbye({}));
    expect(
      record
        .events({ kinds: ["action-result"] })
        .filter((e) => e.tags.includes("player"))
        .map((e) => e.text),
    ).toEqual([
      "You greet the butler.",
      "You ask the butler about the letter.",
      "You say goodbye to the butler.",
    ]);
    expect(record.events({ kinds: ["conversation"] }).map((e) => [e.event, e.with])).toEqual([
      ["started", ["butler:mind"]],
      ["ended", ["butler:mind"]],
    ]);
  });

  it("shows a hear-me-out cut scene in the usual layout, and the conversation's again after", () => {
    act(hello({ who: cook }));
    act(ask({ who: cook, about: letter }));
    expect([story.current, display.layout]).toEqual(["Cook's tale", "page"]);
    story.follow({ type: "continue", target: "Study" });
    expect([story.current, display.layout, conversation.addressee?.id]).toEqual([
      "Study",
      "conversation",
      "cook",
    ]);
  });

  it("name speakers in the story log, by their bodies' names (#127)", () => {
    act(ask({ who: butler, about: letter }));
    expect(
      storyLog(record.events()).map((e) => [e.speaker ?? (e.player ? "(you)" : ""), e.text]),
    ).toEqual([
      ["(you)", "You ask the butler about the letter."],
      ["Butler", "“I couldn't say, sir.”"],
    ]);
  });

  it("give the same state for the same moves (determinism)", () => {
    act(hello({ who: butler }));
    act(ask({ who: butler, about: letter }));
    act(goodbye({}));
    const again = createStore();
    createStory(again, createEventRecord(again), passages, { start: "Study" }).playReplay(
      story.toReplay(),
    );
    expect(again.snapshot()).toEqual(store.snapshot());
  });
});
