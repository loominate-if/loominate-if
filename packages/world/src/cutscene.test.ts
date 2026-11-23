import {
  beat,
  createEventRecord,
  createStore,
  createStory,
  pageBreak,
  readReplay,
  wait,
  writeReplay,
  type EventRecord,
  type Passage,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { clock, fuse, minutes, startClock, timeOfDay } from "./index.js";

startClock({ at: "21:00" });
export const owl = fuse("owl", { after: minutes(90) }, () => "An owl hoots.");
export const wolves = fuse("wolves", { after: minutes(250) }, () => "Wolves howl, far off.");

// The passage below, as a game would write it:
// :: Night watch [cutscene]
// You settle in by the fire. It's {timeOfDay()}.
// {beat 2s, minutes: 120}
// The fire burns low. It's {timeOfDay()}.
// {beat 2s, minutes: 180}
// Grey light creeps over the hills. It's {timeOfDay()}.
// {page}
// You stand and stretch. It's {timeOfDay()}.
const passages: Passage[] = [
  {
    id: "Night watch",
    tags: ["cutscene"],
    effects: {
      enter: () => {
        owl.start();
        wolves.start();
      },
    },
    body: () => [
      { type: "text", text: `You settle in by the fire. It's ${timeOfDay()}.` },
      beat({ duration: 2000, minutes: 120 }),
      { type: "text", text: `The fire burns low. It's ${timeOfDay()}.` },
      beat({ duration: 2000, minutes: 180 }),
      { type: "text", text: `Grey light creeps over the hills. It's ${timeOfDay()}.` },
      pageBreak(),
      { type: "text", text: `You stand and stretch. It's ${timeOfDay()}.` },
      wait({ minutes: 0 }),
      { type: "text", text: "The end." },
    ],
  },
];

let record: EventRecord;
let story: Story;
const begin = () => {
  const store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Night watch" });
};
beforeEach(() => {
  begin();
  story.begin();
});
/** The part on screen's text, and what fuses said since the last beat. */
const part = () => {
  const nodes = story.render().nodes;
  const texts = nodes.filter((n) => n.type === "text").map((n) => (n as { text: string }).text);
  return texts.at(-1);
};
const said = () => record.events({ kinds: ["scheduled"] }).map((e) => e.text);

describe("a cut scene's game time", () => {
  it("passes as the player moves past each beat that says, and fuses fire in it in order", () => {
    expect([part(), clock.minutes]).toEqual(["You settle in by the fire. It's 9:00 pm.", 0]);
    story.advance(); // two real seconds; two game hours
    expect([part(), said()]).toEqual(["The fire burns low. It's 11:00 pm.", ["An owl hoots."]]);
    story.advance(); // three more hours
    expect([part(), said()]).toEqual([
      "Grey light creeps over the hills. It's 2:00 am.",
      ["An owl hoots.", "Wolves howl, far off."],
    ]);
    story.advance(); // a page break costs nothing unless it says
    expect([part(), clock.minutes]).toEqual(["You stand and stretch. It's 2:00 am.", 300]);
  });

  it("is the same in a replay, whatever the real time", () => {
    story.advance();
    story.advance();
    const replay = readReplay(writeReplay(story.toReplay()));
    begin();
    story.playReplay(replay);
    expect([clock.minutes, said()]).toEqual([300, ["An owl hoots.", "Wolves howl, far off."]]);
  });

  it("explains game minutes that aren't a number of minutes", () => {
    expect(() => beat({ duration: 1000, minutes: -5 })).toThrow(
      "{beat}: minutes -5 isn't a number of game minutes",
    );
    expect(() => wait({ minutes: 1.5 })).toThrow("{wait}: minutes 1.5");
  });
});
