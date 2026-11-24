// @vitest-environment jsdom
import { createEventRecord, createStore, createStory } from "@loominate-if/core";
import { explainers, panels, type PanelContext } from "@loominate-if/inspector";
import axe from "axe-core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actor,
  clock,
  daemon,
  fuse,
  minutes,
  modify,
  moves,
  place,
  startAs,
  startClock,
  stats,
} from "@loominate-if/world";
import "./inspector.js";

startClock({ at: "21:00" });
declare module "@loominate-if/world" {
  interface Stats {
    strength: true;
    wits: true;
  }
}
stats({ strength: { on: "body", start: 2 }, wits: { on: "mind", start: 3 } });
const yard = place("yard", { name: "yard" });
const hero = actor("hero", { body: { name: "hero", location: yard } });
startAs(hero);
const collapse = fuse("collapse", { after: minutes(30), interrupts: true }, () => "Crash.");
const kettle = fuse("kettle", { after: moves(3), standsOut: true }, () => "Whistle.");
const bells = daemon(
  "bells",
  { every: minutes(15), priority: 2, joins: "outside", clause: () => "bells rang" },
  () => "Bells.",
);
const drip = daemon("drip", { every: moves(2), source: "@my-scope/caves" }, () => "Drip.");
fuse("letter", { after: minutes(60) }, () => "A letter arrives.");
daemon("market", { at: "08:00", on: ["tuesday", "thursday"], running: true }, () => "Market.");

beforeEach(() => {
  const store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});

/** The panel's rows, each as its cells' text. */
const rows = (element: HTMLElement) =>
  [...element.querySelectorAll("tbody tr")].map((r) =>
    [...r.children].map((c) => c.textContent).join(" | "),
  );

describe("the Fuses and daemons panel", () => {
  it("lists each, with whether it's running, cancelled, stopped, or fired, and when it fires next", async () => {
    const panel = panels.get("schedule");
    expect(panel?.title).toBe("Fuses and daemons");
    const element = document.createElement("div");
    document.body.replaceChildren(element);
    const view = panel?.mount(element, {} as PanelContext);
    collapse.start();
    kettle.start();
    kettle.cancel();
    bells.start();
    drip.start();
    drip.stop();
    clock.advance(20);
    view?.update();
    expect(rows(element)).toEqual([
      "collapse | fuse | Running | 9:30 pm, in 10 minutes | after 30 minutes, interrupts | game",
      "kettle | fuse | Cancelled | — | after 3 moves, stands out | game",
      "bells | daemon | Running | 9:30 pm, in 10 minutes | every 15 minutes, priority 2, joins “outside” | game",
      "drip | daemon | Stopped | — | every 2 moves | @my-scope/caves",
      "letter | fuse | Not started | — | after 60 minutes | game",
      // 1 January 2000, the default start, was a Saturday: the next Tuesday is three days on.
      "market | daemon | Running | 8:00 am, in 3520 minutes | at 08:00 on tuesday, thursday | game",
    ]);
    clock.advance(10);
    view?.update();
    expect(rows(element)[0]).toBe(
      "collapse | fuse | Fired | — | after 30 minutes, interrupts | game",
    );
    expect((await axe.run(element)).violations).toEqual([]);
  });
});

describe("the Stats panel (#95)", () => {
  it("lists each body's stats, base and modified, with their modifiers", async () => {
    const panel = panels.get("stats");
    expect(panel?.title).toBe("Stats");
    const element = document.createElement("div");
    document.body.replaceChildren(element);
    const view = panel?.mount(element, {} as PanelContext);
    modify(hero, "strength", { by: 2, from: "potion", lasts: minutes(30) });
    modify(hero, "wits", { times: 2, from: "insight" });
    view?.update();
    expect(rows(element)).toEqual([
      "hero | strength | 2 | 4 | potion +2, until 9:30 pm",
      "hero (hero:mind) | wits | 3 | 6 | insight ×2, until removed",
    ]);
    expect((await axe.run(element)).violations).toEqual([]);
  });
});

describe("the Topics explainer", () => {
  it("is in the Choices tab, left out when no one here has topics", () => {
    const topics = explainers.get("topics");
    expect(topics?.title).toBe("Topics");
    expect(topics?.hideWhenEmpty).toBe(true);
    expect(topics?.explain({ player: {} } as unknown as PanelContext)).toEqual([]);
  });
});
