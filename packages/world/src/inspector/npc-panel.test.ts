// @vitest-environment jsdom
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type History,
  type StateStore,
  type Story,
} from "@loominate-if/core";
import { panels, type PanelContext } from "@loominate-if/inspector";
import axe from "axe-core";
import { beforeEach, describe, expect, it } from "vitest";
import {
  actAs,
  actor,
  agenda,
  clock,
  connect,
  everyTurn,
  go,
  minutes,
  place,
  schedule,
  simulate,
  startAgenda,
  startAs,
  startClock,
  stepToward,
} from "@loominate-if/world";
import "./inspector.js";

startClock({ at: "12:00", date: "2026-11-24" }); // a Tuesday
const study = place("study", { name: "study" });
const hall = place("hall", { name: "hall" });
const kitchen = place("kitchen", { name: "kitchen" });
const vault = place("vault", { name: "vault" });
const market = place("market", { name: "market" });
const home = place("home", { name: "cottage" });
connect(kitchen, { east: hall });
connect(hall, { west: kitchen, east: study });
connect(study, { west: hall });
const you = actor("you", { body: { name: "you", location: study } });
const butler = actor("butler", { body: { name: "butler", location: kitchen } });
const thief = actor("thief", { body: { name: "thief", location: vault } });
const baker = actor("baker", { body: { name: "baker", location: home } });
// Paced: a turn every five minutes on the clock (#137).
const watchman = actor("watchman", { body: { name: "watchman", location: vault } });
simulate(watchman, { every: minutes(5) });
startAs(you);
agenda(butler, "warn the player", {
  priority: 10,
  starts: false,
  act: ({ npc, done }) => {
    if (stepToward(npc, you)) done();
  },
});
agenda(butler, "polish the silver", { act: () => undefined });
simulate(thief);
everyTurn(thief, "try the door", ({ npc }) => {
  actAs(npc, go({ way: "north" })); // the vault has no way out
});
schedule(baker, [
  { at: "06:00", in: market, on: { weekday: "tuesday" } },
  { at: "20:00", in: home },
]);

let store: StateStore;
let story: Story;
let history: History;
beforeEach(() => {
  store = createStore();
  story = createStory(
    store,
    createEventRecord(store),
    [{ id: "Study", tags: [], body: () => [{ type: "link", label: "Wait", target: "Study" }] }],
    { start: "Study" },
  );
  story.begin();
  history = createHistory(store);
  history.clear();
  store.commit();
});
const wait = () => {
  story.follow({ type: "link", label: "Wait", target: "Study" });
  history.checkpoint("Wait");
};
/** The game as the inspector sees it: its store, and its undo history to travel through. */
const player = () => ({
  store,
  get history() {
    return { past: history.past, future: history.future };
  },
  travel(steps: number) {
    for (let i = 0; i < Math.abs(steps); i++) {
      if (steps < 0) history.undo();
      else history.redo();
    }
  },
});

function mount() {
  const element = document.createElement("div");
  document.body.replaceChildren(element);
  const view = panels.get("npcs")?.mount(element, { player: player() } as unknown as PanelContext);
  const tables = () => [...element.querySelectorAll("table")];
  const rows = (t: HTMLTableElement | undefined) =>
    [...(t?.querySelectorAll("tbody tr") ?? [])].map((r) =>
      [...r.children].map((c) => c.textContent).join(" | "),
    );
  return {
    element,
    update: () => view?.update(),
    npcs: () => rows(tables()[0]),
    timeline: () => rows(tables()[1]),
    showAll: () => {
      const box = element.querySelector<HTMLInputElement>("input[type=checkbox]");
      box?.click();
    },
  };
}

describe("the NPCs panel (#108)", () => {
  it("shows where each NPC is, their level, whether they get a turn and why, their agenda, and timetable", () => {
    expect(panels.get("npcs")?.title).toBe("NPCs");
    const { npcs } = mount();
    expect(npcs()).toEqual([
      "baker:mind | market | scheduled | no, out of sight | — | 06:00 market (weekday: tuesday) → next 20:00 home, 8:00 pm",
      'butler:mind | kitchen | observed | yes, busy with an agenda item | "warn the player" (priority 10, inactive, ready)"polish the silver" (priority 0, active, ready, acts next) | —',
      "thief:mind | vault | simulated | yes, simulated | — | —",
      "watchman:mind | vault | simulated, every 5 minutes | yes, simulated | — | —",
    ]);
  });

  it("shows which agenda item acts next as it changes", () => {
    const { npcs, update } = mount();
    startAgenda(butler, "warn the player");
    update();
    expect(npcs()[1]).toContain('"warn the player" (priority 10, active, ready, acts next)');
  });

  it("lists what NPCs did offstage, newest first, with why an action was refused", () => {
    wait();
    const { timeline, showAll } = mount();
    expect(timeline()).toEqual([
      expect.stringMatching(/^1 \| 12:\d\d pm \| thief:mind \| go: refused, .+ \| no$/),
    ]);
    showAll();
    expect(timeline()).toHaveLength(1); // the player saw nothing
  });

  it("counts an NPC coming into the player's sight as seen", () => {
    startAgenda(butler, "warn the player");
    wait(); // kitchen to hall, unseen
    wait(); // hall to study, where the player is
    const { timeline, showAll } = mount();
    showAll();
    expect(
      timeline()
        .filter((r) => r.includes("butler"))
        .map((r) => r.split(" | ").slice(3).join(" | ")),
    ).toEqual(["go: done | yes", "go: done | no"]);
  });

  it("lists timetable moves, and catches the baker going home", () => {
    const { timeline, update } = mount();
    clock.advance(8 * 60); // 20:00
    update();
    expect(timeline()[0]).toBe("start | 8:00 pm | baker:mind | timetable: to home | no");
  });

  it("links each entry to its move, to go back to, and forward to again, as the History tab does (#138)", () => {
    startAgenda(butler, "warn the player");
    wait(); // move 1: kitchen to hall
    wait(); // move 2: hall to study
    const { element, timeline, showAll, update } = mount();
    showAll();
    const butlers = () => timeline().filter((r) => r.includes("butler"));
    expect(butlers().map((r) => r.split(" | ")[0])).toEqual(["2", "1"]);
    const button = (label: string) =>
      [...element.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.getAttribute("aria-label") === label,
      );
    // Where the game is now is marked, not a way to go.
    expect(button("move 2, now")?.disabled).toBe(true);
    button("Go to move 1")?.click();
    update();
    expect(history.past).toHaveLength(1);
    // Move 2 is undone, but still ahead: listed, to go forward to again.
    expect(butlers()).toEqual([
      expect.stringMatching(/^2 \| .+ \| go: done \(ahead, undone\) \| yes$/),
      expect.stringMatching(/^1 \| .+ \| go: done \| no$/),
    ]);
    button("Go to move 2, ahead")?.click();
    update();
    expect(history.past).toHaveLength(2);
  });

  it("passes automated accessibility checks", async () => {
    wait();
    const { element } = mount();
    const results = await axe.run(element, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`))).toEqual([]);
  });
});
