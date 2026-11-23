import { createEventRecord, createStore, createStory } from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  calendar,
  clock,
  countedDays,
  dateText,
  defineCalendar,
  holiday,
  startClock,
  useCalendar,
} from "./index.js";

const DAY = 24 * 60;
startClock({ at: "06:00", date: { year: 1023, month: "Harvest", date: 28 } });
// #region own
export const reckoning = defineCalendar({
  months: [
    { name: "Frostmoot", days: 30 },
    { name: "Thaw", days: 28 },
    { name: "Greening", days: 31 },
    { name: "Highsun", days: 30 },
    { name: "Harvest", days: 29 },
  ],
  week: [
    "Firstday",
    "Seconday",
    "Thirdday",
    "Fourthday",
    "Fifthday",
    "Sixthday",
    "Seventhday",
    "Eighthday",
  ],
  leap: { month: "Thaw", days: 1, when: (year) => year % 4 === 0 },
  seasons: { winter: ["Frostmoot", "Thaw"], summer: ["Greening", "Highsun"], autumn: ["Harvest"] },
});
// #endregion
// #region counted
export const survival = countedDays({
  week: ["Moonday", "Sunday", "Starday"],
  seasons: [
    { name: "dry", days: 5 },
    { name: "wet", days: 3 },
  ],
});
// #endregion
holiday("landfall", { day: 4 });

beforeEach(() => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});

describe("a calendar of the game's own", () => {
  it("has its own months, week, leap years, and seasons", () => {
    useCalendar(reckoning);
    expect([dateText(), calendar.season, calendar.kind]).toEqual([
      "Seconday, 28 Harvest 1023",
      "autumn",
      "custom",
    ]);
    clock.advance(2 * DAY);
    expect([dateText(), calendar.season]).toEqual(["Fourthday, 1 Frostmoot 1024", "winter"]);
    clock.advance(58 * DAY); // 1024 is a leap year: Thaw has a 29th
    expect(dateText()).toBe("Sixthday, 29 Thaw 1024");
    expect(calendar.is({ weekday: "sixthday", month: "thaw" })).toBe(true);
  });
});

describe("a calendar of counted days", () => {
  it("counts days, with a week and seasons that come round again", () => {
    useCalendar(survival);
    // #region days
    expect([dateText(), calendar.month, calendar.year]).toEqual([
      "Moonday, day 1",
      undefined,
      undefined,
    ]);
    clock.advance(3 * DAY);
    expect([dateText(), calendar.season, calendar.holidays]).toEqual([
      "Moonday, day 4",
      "dry",
      ["landfall"],
    ]);
    // #endregion
    clock.advance(2 * DAY);
    expect([calendar.day, calendar.season]).toEqual([6, "wet"]);
    clock.advance(3 * DAY);
    expect([calendar.day, calendar.season]).toEqual([9, "dry"]);
    useCalendar(countedDays());
    expect(dateText()).toBe("Day 9");
  });
});
