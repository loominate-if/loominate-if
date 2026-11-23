import { createEventRecord, createStore, createStory } from "@loominate-if/core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  calendar,
  clock,
  connect,
  dayParts,
  door,
  exitLinks,
  isOpenNow,
  openingHours,
  place,
  registerRoom,
  startAs,
  startClock,
  thing,
} from "./index.js";

startClock({ at: "08:30", date: "1923-11-02" }); // a Friday
const street = place("street", { name: "street" });
export const bakery = place("bakery", { name: "bakery" });
export const tavern = place("tavern", { name: "tavern" });
// #region hours
export const bakeryDoor = thing("bakeryDoor", {
  ...door,
  ...openingHours({
    open: "09:00",
    close: "17:00",
    on: ["monday", "tuesday", "wednesday", "thursday", "friday"],
  }),
  name: "bakery door",
});
export const tavernDoor = thing("tavernDoor", {
  ...door,
  ...openingHours({ open: "17:00", close: "01:00" }), // until after midnight
  name: "tavern door",
});
connect(street, { in: { to: bakery, via: bakeryDoor }, east: { to: tavern, via: tavernDoor } });
// #endregion
connect(bakery, { out: { to: street, via: bakeryDoor } });
for (const [room, id] of [
  [street, "Street"],
  [bakery, "Bakery"],
  [tavern, "Tavern"],
] as const) {
  registerRoom(room, { id, tags: [`room: ${room.id}`] });
}
const you = actor("you", { body: { name: "you", location: street } });
startAs(you);

beforeEach(() => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
  bakeryDoor.open();
  tavernDoor.open();
});
const exits = () => exitLinks().map((l) => `${l.label}: ${l.guard?.reason ?? "open"}`);
const DAY = 24 * 60;

describe("opening hours", () => {
  it("block the way outside them, saying when it opens", () => {
    // #region closed
    expect(exits()).toEqual([
      "East: The tavern is closed until 5:00 pm.",
      "In: The bakery is closed until 9:00 am.",
    ]);
    clock.advance(30); // 9:00 on Friday
    expect(exits()).toEqual(["East: The tavern is closed until 5:00 pm.", "In: open"]);
    clock.advance(8 * 60); // 17:00 on Friday
    expect(exits()).toEqual(["East: open", "In: The bakery is closed until 9:00 am on Monday."]);
    // #endregion
    expect(isOpenNow(bakeryDoor)).toBe(false);
  });

  it("run past midnight, on the day they opened", () => {
    clock.advance(16 * 60); // 00:30 on Saturday
    expect(isOpenNow(tavernDoor)).toBe(true);
    clock.advance(60); // 01:30
    expect(exits()[0]).toBe("East: The tavern is closed until 5:00 pm.");
    clock.advance(23 * 60); // 00:30 on Sunday
    expect(exits()[1]).toBe("In: The bakery is closed until 9:00 am tomorrow.");
  });

  it("come before the door's own reason, and leave it when open", () => {
    clock.advance(30);
    bakeryDoor.close();
    expect(exits()[1]).toBe("In: The bakery door is closed.");
    clock.advance(10 * 60);
    expect(exits()[1]).toBe("In: The bakery is closed until 9:00 am on Monday.");
  });

  it("can change during play", () => {
    bakeryDoor.hours = { open: "08:00", close: "12:00", on: null };
    expect(isOpenNow(bakeryDoor)).toBe(true);
  });
});

describe("parts of the day", () => {
  it("name the time, for text and checks", () => {
    // #region parts
    expect([clock.part, clock.is("morning"), clock.between("08:00", "09:00")]).toEqual([
      "morning",
      true,
      true,
    ]);
    clock.advance(13 * 60); // 21:30
    expect([clock.part, calendar.is({ part: "night", weekday: "friday" })]).toEqual([
      "night",
      true,
    ]);
    expect(clock.between("21:00", "02:00")).toBe(true); // past midnight
    // #endregion
    clock.advance(DAY - 15 * 60 - 30); // 06:00
    expect(clock.part).toBe("dawn");
    expect(() => clock.is("teatime")).toThrow('"teatime" isn\'t a part of the day');
  });

  it("can be named by the game", () => {
    try {
      dayParts({
        morning: "06:00",
        noon: "11:30",
        afternoon: "13:00",
        evening: "18:00",
        night: "22:00",
      });
      clock.advance(3 * 60 + 30); // 12:00
      expect(clock.part).toBe("noon");
      clock.advance(14 * 60); // 02:00: still the night from before
      expect(clock.part).toBe("night");
    } finally {
      dayParts({
        dawn: "05:00",
        morning: "07:00",
        afternoon: "12:00",
        evening: "17:00",
        night: "21:00",
      });
    }
  });
});
