import {
  createEventRecord,
  createStore,
  createStory,
  readReplay,
  writeReplay,
  type EventRecord,
  type Passage,
  type Story,
} from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import { calendar, clock, daemon, dateText, holiday, startClock, timeOfDay } from "./index.js";

// #region start
startClock({ at: "23:30", date: "1923-10-31" });
holiday("thanksgiving", { month: "november", weekday: "thursday", nth: -1 });
holiday("christmas", { month: "december", date: 25 });
// #endregion
// #region market
export const market = daemon(
  "market",
  { at: "08:00", on: ["tuesday", "thursday"], running: true },
  () => `The market opens, ${dateText()}.`,
);
// #endregion
const feast = daemon(
  "feast",
  { at: "12:00", on: { holiday: "thanksgiving" }, running: true },
  () => "The feast begins.",
);

const passages: Passage[] = [
  {
    id: "Town",
    tags: [],
    body: () => [{ type: "link", label: "Sleep for three days", target: "Sleep" }],
  },
  {
    id: "Sleep",
    tags: [],
    effects: {
      enter: () => {
        clock.advance(3 * 24 * 60);
      },
    },
    body: () => [{ type: "text", text: "You wake." }],
  },
];
let record: EventRecord;
let story: Story;
const begin = () => {
  const store = createStore();
  record = createEventRecord(store);
  story = createStory(store, record, passages, { start: "Town" });
};
beforeEach(() => {
  begin();
  story.begin();
});
const said = () => record.events({ kinds: ["scheduled"] }).map((e) => e.text);
const DAY = 24 * 60;

describe("the real calendar", () => {
  it("dates the game from where it began", () => {
    // #region dates
    expect(dateText()).toBe("Wednesday, 31 October 1923");
    expect([calendar.weekday, calendar.month, calendar.date, calendar.year]).toEqual([
      "wednesday",
      "october",
      31,
      1923,
    ]);
    expect(calendar.season).toBe("autumn");
    clock.advance(60);
    expect(dateText()).toBe("Thursday, 1 November 1923");
    // #endregion
    expect(calendar.kind).toBe("gregorian");
  });

  it("has leap years, and seasons by month", () => {
    clock.advance(30 + (30 + 31 + 31 + 28) * DAY); // to 29 February 1924
    expect([dateText(), calendar.season]).toEqual(["Friday, 29 February 1924", "winter"]);
    clock.advance(DAY);
    expect([dateText(), calendar.season]).toEqual(["Saturday, 1 March 1924", "spring"]);
  });

  it("checks days, and knows its holidays", () => {
    expect(calendar.is({ weekday: ["tuesday", "thursday"] })).toBe(false);
    clock.advance(30);
    expect(calendar.is({ weekday: ["tuesday", "thursday"], month: "november" })).toBe(true);
    clock.advance(28 * DAY); // Thursday 29 November
    expect([calendar.holidays, calendar.is({ holiday: "thanksgiving" })]).toEqual([
      ["thanksgiving"],
      true,
    ]);
    clock.advance(26 * DAY); // Tuesday 25 December
    expect(calendar.holidays).toEqual(["christmas"]);
    expect(() => calendar.is({ weekday: "funday" })).toThrow(
      "calendar.is: \"funday\" isn't one of the calendar's weekdays",
    );
  });
});

describe("daemons at a time on days", () => {
  it("fire on those days only, even through a long sleep", () => {
    // #region week
    expect(market.firesAt).toBe(8 * 60 + 30); // Thursday 08:00
    clock.advance(7 * DAY);
    expect(said()).toEqual([
      "The market opens, Thursday, 1 November 1923.",
      "The market opens, Tuesday, 6 November 1923.",
    ]);
    // #endregion
    expect(timeOfDay()).toBe("11:30 pm");
  });

  it("fire on a holiday", () => {
    clock.advance(30 * DAY);
    expect(said().filter((s) => s.startsWith("The feast"))).toEqual(["The feast begins."]);
    expect(feast.firesAt).toBeGreaterThan(clock.minutes);
  });

  it("are replayed the same", () => {
    story.follow({ type: "link", label: "Sleep for three days", target: "Sleep" });
    const before = said();
    expect(before).toEqual(["The market opens, Thursday, 1 November 1923."]);
    const replay = readReplay(writeReplay(story.toReplay()));
    begin();
    story.playReplay(replay);
    expect([said(), dateText()]).toEqual([before, "Saturday, 3 November 1923"]);
  });

  it("explain a daemon given both every and at, or on without at", () => {
    expect(() => daemon("odd", { every: { minutes: 5 }, at: "08:00" }, () => "")).toThrow(
      "give it `every`",
    );
    expect(() => daemon("odd2", { on: ["monday"] } as never, () => "")).toThrow("give it `every`");
  });
});
