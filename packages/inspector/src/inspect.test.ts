// @vitest-environment jsdom
/** The inspector shell and its state tree (#45). */
import {
  createEventRecord,
  createMemoryStorage,
  createStore,
  hook,
  linkGuard,
  object,
  rulebook,
  type Passage,
} from "@loominate-if/core";
import { layouts, playGame, widgets, type Player } from "@loominate-if/presentation";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHOWN_EVENTS } from "./event-log.js";
import { explainers } from "./explainers.js";
import { KEPT_TURNS } from "./rules.js";
import { inspect, type Inspector } from "./inspect.js";
import { panels, type InspectorPanel } from "./panels.js";

const shed = object("shed", { name: "shed" });
/** A rulebook the tower consults, as a package's might be. */
const weather = rulebook<undefined, string>("weather", { kind: "decide", otherwise: () => "calm" });
const keeper = object("keeper", { pockets: { coins: [1, 2], matches: false } });
const lamp = object("lamp", { lit: false, oil: 3, where: shed });

const passages: Passage[] = [
  {
    id: "Cottage",
    tags: [],
    effects: {
      firstVisit: () => {
        keeper.pockets.matches = true;
      },
    },
    body: () => [
      { type: "text", text: "A cold cottage." },
      { type: "link", label: "Climb", target: "Tower" },
      // Guards as the compiler builds them, with their condition's parts.
      {
        type: "link",
        label: "Light the stove",
        target: "Tower",
        guard: linkGuard({
          condition: {
            value: lamp.lit && lamp.oil > 0,
            text: "lamp.lit && lamp.oil > 0",
            parts: () => [
              { text: "lamp.lit", value: lamp.lit },
              { text: "lamp.oil > 0", value: lamp.oil > 0 },
              { text: "lamp.oil", value: lamp.oil },
            ],
          },
          reason: "The lamp isn't lit.",
        }),
      },
      {
        type: "link",
        label: "Sleep",
        target: "Tower",
        guard: linkGuard({
          condition: { value: lamp.lit, text: "lamp.lit" },
          mode: "hidden",
        }),
      },
    ],
  },
  {
    id: "Tower",
    tags: [],
    effects: {
      enter: ({ emit }) => {
        weather.run(undefined);
        lamp.lit = true;
        emit("system", { text: "The lamp is lit." }, ["lamp", "light"]);
        emit("system", { text: "The wind rises." }, ["weather"]);
      },
    },
    body: () => [
      { type: "text", text: "The lamp burns." },
      { type: "link", label: "Down", target: "Cottage" },
      { type: "link", label: "Shout", target: "Echo" },
    ],
  },
  {
    // A move that records more events than the log draws.
    id: "Echo",
    tags: [],
    effects: {
      enter: ({ emit }) => {
        for (let i = 0; i < 520; i++) emit("system", { text: `Echo ${String(i)}` });
      },
    },
    body: () => [{ type: "text", text: "Your voice echoes." }],
  },
];

let docked = true;
const live: { destroy(): void }[] = [];
afterEach(() => {
  for (const x of live.splice(0)) x.destroy();
  sessionStorage.clear();
  document.body.replaceChildren();
  widgets.remove("game-menu");
  const page = layouts.get("page");
  if (page)
    layouts.replace("page", { regions: page.regions }, { source: "@loominate-if/presentation" });
  for (const key of ["clock", "broken", "where"]) if (panels.has(key)) panels.remove(key);
  docked = true;
});

/** Whether a node in the tree is showing: no closed node hides it, other than its own. */
const shown = (node: Element): boolean => {
  for (let d = node.parentElement?.closest("details"); d; d = d.parentElement?.closest("details")) {
    if (!d.open && !(node.tagName === "SUMMARY" && node.parentElement === d)) return false;
  }
  return true;
};

/** jsdom has no matchMedia; this one says whether the window is wide enough to dock. */
window.matchMedia = ((query: string) => ({
  matches: docked,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
})) as unknown as typeof window.matchMedia;

async function setup(options: { open?: boolean } = {}) {
  document.documentElement.lang = "en";
  document.title = "Test";
  const container = document.createElement("div");
  document.body.append(container);
  const player: Player = await playGame(container, {
    passages,
    start: "Cottage",
    game: { id: "inspected", version: "1.0.0" },
    storage: createMemoryStorage(),
    seed: () => "fixed",
  });
  live.push(player);
  const inspector: Inspector = inspect(player, options);
  live.push(inspector);
  const root = document.querySelector("[data-loominate-inspector]")?.shadowRoot;
  if (!root) throw new Error("no inspector");
  const q = <E extends Element = HTMLElement>(selector: string) => root.querySelector<E>(selector);
  const qa = <E extends Element = HTMLElement>(selector: string) => [
    ...root.querySelectorAll<E>(selector),
  ];
  const follow = (label: string) => {
    const link = [...container.querySelectorAll("button, a")].find((b) => b.textContent === label);
    if (!(link instanceof HTMLElement)) throw new Error(`no link "${label}"`);
    link.click();
  };
  /** The tree's objects and properties as text, one per line, marking changes with `*`. */
  const tree = () =>
    qa(".tree summary, .tree .leaf")
      .filter(shown)
      .map(
        (n) =>
          `${n.closest("[data-changed]") === n ? "*" : ""}${n.textContent?.replace(" (changed)", "") ?? ""}`,
      );
  const expand = (path: string) => {
    const details = q<HTMLDetailsElement>(`details[data-path="${path}"]`);
    if (!details) throw new Error(`no node ${path}`);
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  };
  return { player, inspector, root, q, qa, follow, tree, expand, container };
}

describe("the inspector", () => {
  it("opens beside the game from its button, narrowing the game, and closes again", async () => {
    const { inspector, q } = await setup();
    const panel = q("aside");
    const toggle = q<HTMLButtonElement>(".toggle");
    expect(panel?.hidden).toBe(true);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    toggle?.click();
    expect(inspector.isOpen).toBe(true);
    expect(panel?.hidden).toBe(false);
    expect(document.documentElement.style.marginInlineEnd).toBe("24rem");
    expect(q(".tabs [aria-selected=true]")?.textContent).toBe("State");

    q<HTMLButtonElement>(".close")?.click();
    expect(inspector.isOpen).toBe(false);
    expect(panel?.hidden).toBe(true);
    expect(document.documentElement.style.marginInlineEnd).toBe("");
  });

  it("covers the game instead of narrowing it on a narrow screen", async () => {
    docked = false;
    const { inspector } = await setup();
    inspector.open();
    expect(document.documentElement.style.marginInlineEnd).toBe("");
  });

  it("opens and closes with Control+`, and Escape closes it, returning focus", async () => {
    const user = userEvent.setup();
    const { inspector, root, container } = await setup();
    const link = container.querySelector<HTMLElement>(".loominate-link");
    link?.focus();
    await user.keyboard("{Control>}`{/Control}");
    expect(inspector.isOpen).toBe(true);
    expect(root.activeElement?.textContent).toBe("Inspector");
    await user.keyboard("{Escape}");
    expect(inspector.isOpen).toBe(false);
    expect(document.activeElement).toBe(link);
    await user.keyboard("{Control>}`{/Control}");
    await user.keyboard("{Control>}`{/Control}");
    expect(inspector.isOpen).toBe(false);
    // Opened with focus nowhere in particular, closing leaves it on the inspector's button.
    (document.activeElement as HTMLElement | null)?.blur();
    inspector.open();
    root.querySelector<HTMLElement>("h2")?.focus();
    await user.keyboard("{Escape}");
    expect(root.activeElement?.textContent).toBe("Inspector");
    expect(root.activeElement?.className).toBe("toggle");
  });

  it("stays open through a reload in the same tab", async () => {
    const first = await setup();
    first.inspector.open();
    first.inspector.destroy();
    expect(document.documentElement.style.marginInlineEnd).toBe("");
    const second = await setup();
    expect(second.inspector.isOpen).toBe(true);
  });

  it("removes itself, and stops following the game", async () => {
    const { inspector, player, follow } = await setup({ open: true });
    const update = vi.fn();
    panels.register("clock", { title: "Clock", mount: () => ({ update }) });
    inspector.close();
    inspector.open();
    (
      document
        .querySelector("[data-loominate-inspector]")
        ?.shadowRoot?.querySelector("#loominate-inspector-tab-clock") as HTMLElement
    ).click();
    inspector.destroy();
    follow("Climb");
    expect(player.story?.current).toBe("Tower");
    expect(update).not.toHaveBeenCalled();
    expect(document.querySelector("[data-loominate-inspector]")).toBeNull();
  });

  it("passes automated accessibility checks while open", async () => {
    const { inspector, expand } = await setup();
    inspector.open();
    expand("lamp");
    const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.description}`)).toEqual([]);
  });
});

describe("the state tree", () => {
  it("shows every object and property, the game's before the engine's", async () => {
    const { qa, tree, expand } = await setup({ open: true });
    expect(qa(".tree > details > summary").map((s) => s.textContent)).toEqual([
      "keeper",
      "lamp",
      // Presentation's own object, for display settings.
      "loominate:display",
      "shed",
      "Engine state",
    ]);
    expand("lamp");
    expand("keeper");
    expand("keeper/pockets");
    expect(tree()).toEqual([
      "keeper",
      "pockets: {2}",
      "coins: Array(2)",
      "matches: true",
      "lamp",
      "lit: false",
      "oil: 3",
      "where: → shed",
      "loominate:display",
      "shed",
      "Engine state",
    ]);
    // Values still at their defaults are dimmed; a changed one isn't.
    const values = qa("details[data-path=lamp] .value");
    expect(values.map((v) => v.dataset.default !== undefined)).toEqual([true, true, true]);
    expect(
      qa("details[data-path=keeper] > .children > details > summary .value")[0]?.dataset.default,
    ).toBeUndefined();
    expand("$");
    expect(qa("details[data-path='$'] > details > summary").map((s) => s.textContent)).toContain(
      "$story",
    );
    expect(qa(".value[data-type=ref]").map((v) => v.textContent)).toEqual(["→ shed"]);
  });

  it("follows the game, marking what the last move changed, and keeps open nodes open", async () => {
    const { tree, expand, follow, qa } = await setup({ open: true });
    expand("lamp");
    follow("Climb");
    expect(tree().slice(0, 6)).toEqual([
      "keeper",
      "*lamp",
      "*lit: true",
      "oil: 3",
      "where: → shed",
      "loominate:display",
    ]);
    expect(qa("[data-changed] .visually-hidden").map((n) => n.textContent)).toContain(" (changed)");
    follow("Down");
    // The lamp stays lit on the way down; only the engine's state changed.
    expect(tree().slice(0, 4)).toEqual(["keeper", "lamp", "lit: true", "oil: 3"]);
    expect(tree().filter((line) => line.startsWith("*") && !line.startsWith("*$"))).toEqual([]);
  });

  it("marks nothing in a new game", async () => {
    const { player, tree, follow, expand } = await setup({ open: true });
    follow("Climb");
    await player.newGame();
    expand("lamp");
    expect(tree().filter((line) => line.startsWith("*"))).toEqual([]);
    expect(tree()).toContain("lit: false");
  });

  it("filters objects by ID, keeping the last move's marks", async () => {
    const { q, qa, follow } = await setup({ open: true });
    follow("Climb");
    const filter = q<HTMLInputElement>(".filter");
    if (!filter) throw new Error("no filter");
    filter.value = "LAM";
    filter.dispatchEvent(new Event("input"));
    expect(qa(".tree > details > summary").map((s) => s.textContent)).toEqual(["lamp (changed)"]);
    filter.value = "attic";
    filter.dispatchEvent(new Event("input"));
    expect(q(".empty")?.textContent).toBe("No IDs match.");
  });
});

describe("panels", () => {
  it("adds a tab for each registered panel, drawn when first shown and updated while showing", async () => {
    const user = userEvent.setup();
    const update = vi.fn();
    const mount = vi.fn<InspectorPanel["mount"]>((element, { player }) => {
      element.textContent = `At ${player.story?.current ?? ""}`;
      return { update };
    });
    panels.register("clock", { title: "Clock", mount }, { source: "@my-scope/clock" });
    const { q, qa, follow, inspector } = await setup();
    inspector.open();
    expect(qa("[role=tab]").map((t) => t.textContent)).toEqual([
      "State",
      "Events",
      "Choices",
      "Rules",
      "History",
      "Clock",
    ]);
    expect(mount).not.toHaveBeenCalled();

    q<HTMLButtonElement>("[role=tab][aria-selected=true]")?.focus();
    await user.keyboard("{ArrowLeft}");
    expect(mount).toHaveBeenCalledTimes(1);
    expect(q("#loominate-inspector-panel-clock")?.textContent).toBe("At Cottage");
    expect(q("#loominate-inspector-panel-state")?.hidden).toBe(true);

    follow("Climb");
    expect(update).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>("#loominate-inspector-tab-clock")?.focus();
    await user.keyboard("{Home}");
    expect(q("[role=tab][aria-selected=true]")?.textContent).toBe("State");
    follow("Down");
    expect(update).toHaveBeenCalledTimes(1);
    // Shown again, it catches up.
    q<HTMLButtonElement>("#loominate-inspector-tab-state")?.focus();
    await user.keyboard("{End}");
    expect(update).toHaveBeenCalledTimes(2);
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it("shows the guide's example panel, following the game", async () => {
    // #region where-panel
    panels.register("where", {
      title: "Where",
      mount(element, { player }) {
        const update = () => {
          element.textContent = `At ${player.story?.current ?? "nowhere yet"}`;
        };
        update();
        return { update };
      },
    });
    // #endregion
    const { q, follow, inspector } = await setup();
    inspector.open();
    q<HTMLButtonElement>("#loominate-inspector-tab-where")?.click();
    expect(q("#loominate-inspector-panel-where")?.textContent).toBe("At Cottage");
    follow("Climb");
    expect(q("#loominate-inspector-panel-where")?.textContent).toBe("At Tower");
  });

  it("says when a panel can't be shown, and the others still work", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    panels.register("broken", {
      title: "Broken",
      mount: () => {
        throw new Error("no clock here");
      },
    });
    const { q, inspector } = await setup();
    inspector.open();
    q<HTMLButtonElement>("#loominate-inspector-tab-broken")?.click();
    expect(q("#loominate-inspector-panel-broken")?.textContent).toBe(
      "The Broken panel couldn't be shown: no clock here",
    );
    q<HTMLButtonElement>("#loominate-inspector-tab-state")?.click();
    expect(q(".tree")).not.toBeNull();
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });
});

describe("the event log", () => {
  /** The log's rows: seq, kind, summary, and tags, with `*` for new ones. */
  const rows = (qa: (s: string) => HTMLElement[]) =>
    qa(".events > li").map(
      (li) =>
        `${li.dataset.changed !== undefined ? "*" : ""}${[
          ...li.querySelectorAll("summary > span:not(.visually-hidden)"),
        ]
          .map((s) => s.textContent)
          .join(" ")}`,
    );
  const showEvents = async (open: Awaited<ReturnType<typeof setup>>) => {
    open.inspector.open();
    open.q<HTMLButtonElement>("#loominate-inspector-tab-events")?.click();
  };

  it("lists everything the game recorded, in order, marking what the last move added", async () => {
    const game = await setup();
    await showEvents(game);
    expect(rows(game.qa)).toEqual([
      "0 navigation → Cottage",
      "1 phase Cottage: firstVisit",
      "2 narrative A cold cottage.",
    ]);
    expect(game.q(".count")?.textContent).toBe("3 events");
    game.follow("Climb");
    expect(rows(game.qa).slice(3)).toEqual([
      "*3 navigation Cottage → Tower",
      "*4 phase Tower: enter",
      "*5 system The lamp is lit. #lamp #light",
      "*6 system The wind rises. #weather",
      "*7 narrative The lamp burns.",
    ]);
    expect(game.qa("[data-changed] .visually-hidden")[0]?.textContent).toBe(" (new)");
  });

  it("shows an event's fields when opened", async () => {
    const game = await setup();
    await showEvents(game);
    game.follow("Climb");
    const nav = game.qa(".events > li").findLast((li) => li.dataset.kind === "navigation");
    expect([...(nav?.querySelectorAll("dt, dd") ?? [])].map((n) => n.textContent)).toEqual([
      "from",
      '"Cottage"',
      "to",
      '"Tower"',
    ]);
  });

  it("filters by tag, keeping events with every chosen tag, and by kind", async () => {
    const game = await setup();
    await showEvents(game);
    game.follow("Climb");
    const chip = (value: string) => {
      const found = game.qa<HTMLButtonElement>(".chip").find((c) => c.dataset.value === value);
      if (!found) throw new Error(`no filter ${value}`);
      return found;
    };
    expect(game.qa(".chip").map((c) => c.textContent)).toEqual([
      "narrative",
      "navigation",
      "phase",
      "system",
      "#lamp",
      "#light",
      "#weather",
    ]);
    chip("lamp").click();
    expect(chip("lamp").getAttribute("aria-pressed")).toBe("true");
    expect(rows(game.qa)).toEqual(["*5 system The lamp is lit. #lamp #light"]);
    expect(game.q(".count")?.textContent).toBe("1 of 8 events");
    chip("weather").click();
    expect(rows(game.qa)).toEqual([]);
    chip("lamp").click();
    chip("weather").click();
    chip("phase").click();
    expect(rows(game.qa).map((r) => r.replace("*", ""))).toEqual([
      "1 phase Cottage: firstVisit",
      "4 phase Tower: enter",
    ]);
    // Choosing two kinds shows both; filters stay as the game goes on.
    chip("navigation").click();
    game.follow("Down");
    expect(rows(game.qa).slice(-2)).toEqual([
      "4 phase Tower: enter",
      "*8 navigation Tower → Cottage",
    ]);
  });

  it("drops what an undo took back, and marks nothing new", async () => {
    const game = await setup();
    await showEvents(game);
    game.follow("Climb");
    const undo = [...game.container.querySelectorAll("button")].find(
      (b) => b.textContent === "Undo",
    );
    undo?.click();
    expect(rows(game.qa)).toEqual([
      "0 navigation → Cottage",
      "1 phase Cottage: firstVisit",
      "2 narrative A cold cottage.",
    ]);
    expect(game.qa(".chip").map((c) => c.textContent)).toEqual([
      "narrative",
      "navigation",
      "phase",
    ]);
  });

  it("draws only the latest events in a long game, and says so", async () => {
    const game = await setup();
    await showEvents(game);
    game.follow("Climb");
    game.follow("Shout");
    const total = createEventRecord(game.player.store ?? createStore()).length;
    expect(total).toBeGreaterThan(SHOWN_EVENTS);
    expect(game.qa(".events > li")).toHaveLength(SHOWN_EVENTS);
    expect(game.q(".count")?.textContent).toBe(
      `${String(total)} events, the last ${String(SHOWN_EVENTS)} shown`,
    );
    expect(rows(game.qa).at(-1)).toMatch(new RegExp(`^\\*${String(total - 1)} `));
  });

  it("passes automated accessibility checks", async () => {
    const game = await setup();
    await showEvents(game);
    game.follow("Climb");
    game.qa<HTMLButtonElement>(".chip")[0]?.click();
    const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.description}`)).toEqual([]);
  });
});

describe("the choices panel", () => {
  const showChoices = async (open: Awaited<ReturnType<typeof setup>>) => {
    open.inspector.open();
    open.q<HTMLButtonElement>("#loominate-inspector-tab-choices")?.click();
  };
  /** Each choice as text: its state, label, target, and why, in order. */
  const listed = (qa: (s: string) => HTMLElement[]) =>
    qa(".choice").map((li) =>
      [...li.querySelectorAll(".choice-head > span, .why, dt, dd, .told")]
        .map(
          (n) =>
            `${n instanceof HTMLElement && n.dataset.falsy !== undefined ? "!" : ""}${n.textContent ?? ""}`,
        )
        .join(" | "),
    );

  it("lists every link, and says why each closed one can't be followed", async () => {
    const game = await setup();
    await showChoices(game);
    expect(game.q(".at")?.textContent).toBe("At Cottage");
    expect(game.qa("h3").map((h) => h.textContent)).toEqual(["Links"]);
    expect(listed(game.qa)).toEqual([
      "Available | Climb | → Tower",
      "Disabled | Light the stove | → Tower | Because lamp.lit && lamp.oil > 0 doesn't hold. | lamp.lit | !false | lamp.oil > 0 | true | lamp.oil | 3 | The player is told: “The lamp isn't lit.”",
      "Hidden | Sleep | → Tower | Because lamp.lit doesn't hold.",
    ]);
  });

  it("follows the game", async () => {
    const game = await setup();
    await showChoices(game);
    game.follow("Climb");
    expect(game.q(".at")?.textContent).toBe("At Tower");
    expect(listed(game.qa)).toEqual(["Available | Down | → Cottage", "Available | Shout | → Echo"]);
    game.follow("Down");
    // The lamp is lit now, so the stove can be lit and the bed is there.
    expect(listed(game.qa)).toEqual([
      "Available | Climb | → Tower",
      "Available | Light the stove | → Tower",
      "Available | Sleep | → Tower",
    ]);
  });

  it("shows registered explainers too, and one that fails says so", async () => {
    explainers.register("topics", {
      title: "Topics",
      explain: () => [
        { label: "the storm", available: false, shown: "hidden", condition: "keeper.metMira" },
      ],
    });
    explainers.register("broken", {
      title: "Broken",
      explain: () => {
        throw new Error("no topics here");
      },
    });
    try {
      const game = await setup();
      await showChoices(game);
      expect(game.qa("h3").map((h) => h.textContent)).toEqual(["Links", "Topics", "Broken"]);
      expect(listed(game.qa).at(-1)).toBe(
        "Hidden | the storm | Because keeper.metMira doesn't hold.",
      );
      expect(game.qa(".part-error").map((p) => p.textContent)).toEqual([
        "These choices couldn't be explained: no topics here",
      ]);
    } finally {
      explainers.remove("topics");
      explainers.remove("broken");
    }
  });

  it("passes automated accessibility checks", async () => {
    const game = await setup();
    await showChoices(game);
    const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.description}`)).toEqual([]);
  });
});

describe("the rules panel", () => {
  const showRules = async (open: Awaited<ReturnType<typeof setup>>) => {
    open.inspector.open();
    open.q<HTMLButtonElement>("#loominate-inspector-tab-rules")?.click();
  };
  /** A turn as text: its heading, then each rule run and its steps. */
  const turn = (section: HTMLElement | undefined) =>
    section
      ? [
          `${section.dataset.changed !== undefined ? "*" : ""}${section.querySelector("h3")?.firstChild?.textContent ?? ""}`,
          ...[...section.querySelectorAll(".run")].map(
            (run) =>
              `${run.querySelector(".book")?.textContent ?? ""} (${run.querySelector(".run-kind")?.textContent ?? ""}): ${[
                ...run.querySelectorAll("tbody tr"),
              ]
                .map((row) => [...row.children].map((c) => c.textContent).join(" / "))
                .join("; ")}`,
          ),
          ...[...section.querySelectorAll(".idle, .empty")].map((p) => p.textContent ?? ""),
        ]
      : [];
  const withRules = async (body: () => Promise<void>) => {
    hook("passageEnter").rule("note-arrival", () => undefined, { source: "@my/kit" });
    weather.rule("storm", () => "stormy");
    try {
      await body();
    } finally {
      hook("passageEnter").remove("note-arrival");
      weather.remove("storm");
    }
  };

  it("lists the rules that ran each turn, with their packages and what they did", () =>
    withRules(async () => {
      const game = await setup();
      await showRules(game);
      const turns = () => game.qa<HTMLElement>(".turn");
      // The autosave of the start joins the start's turn once it's written.
      await vi.waitFor(() => {
        expect(turn(turns().at(-1))).toEqual([
          "Start · Cottage",
          "passageEnter (hook): note-arrival / @my/kit / ran",
          "With no rules: gameStart, save",
        ]);
      });
      game.follow("Climb");
      expect(turn(turns().at(-1))).toEqual([
        "*Turn 1 · Tower",
        "weather (decide): storm / game / decided",
        "passageEnter (hook): note-arrival / @my/kit / ran",
        "With no rules: passageLeave, turnEnd",
      ]);
      await vi.waitFor(() => {
        expect(turn(turns().at(-1)).at(-1)).toBe("With no rules: passageLeave, turnEnd, save");
      });
      // A late arrival leaves the marks as they were.
      expect(turns().at(-1)?.dataset.changed).toBe("");
      expect(game.q("[data-decided] .outcome")?.textContent).toBe("decided");
      expect(game.q(".count")?.textContent).toBe("2 turns since the inspector loaded");
    }));

  it("puts what an autosave ran with the turn it saved", () =>
    withRules(async () => {
      hook("save").rule("back-up", () => undefined, { source: "@my/cloud" });
      try {
        const game = await setup();
        await showRules(game);
        game.follow("Climb");
        await vi.waitFor(() => {
          expect(game.q(".turn:last-of-type")?.textContent).toContain("back-up");
        });
        game.follow("Down");
        // The latest turn's own rules, then the autosave that saved it.
        await vi.waitFor(() => {
          expect(turn(game.qa<HTMLElement>(".turn").at(-1)).slice(0, 3)).toEqual([
            "*Turn 2 · Cottage",
            "passageEnter (hook): note-arrival / @my/kit / ran",
            "save (hook): back-up / @my/cloud / ran",
          ]);
        });
      } finally {
        hook("save").remove("back-up");
      }
    }));

  it("ends a turn at an undo too, and says when no rules ran", async () => {
    const game = await setup();
    await showRules(game);
    game.follow("Climb");
    const undo = [...game.container.querySelectorAll("button")].find(
      (b) => b.textContent === "Undo",
    );
    undo?.click();
    expect(turn(game.qa<HTMLElement>(".turn").at(-1))).toEqual([
      "*Turn 2 · Cottage",
      "No rules ran.",
    ]);
  });

  it(`keeps the last ${String(KEPT_TURNS)} turns`, async () => {
    const game = await setup();
    for (let i = 0; i < KEPT_TURNS + 3; i++) game.follow(i % 2 === 0 ? "Climb" : "Down");
    await showRules(game);
    expect(game.qa(".turn")).toHaveLength(KEPT_TURNS);
    expect(game.q(".count")?.textContent).toBe(
      `${String(KEPT_TURNS)} turns since the inspector loaded, the last ${String(KEPT_TURNS)} kept`,
    );
    expect(game.qa(".turn h3")[0]?.textContent).toBe("Turn 4 · Cottage");
  });

  it("passes automated accessibility checks", () =>
    withRules(async () => {
      const game = await setup();
      await showRules(game);
      game.follow("Climb");
      const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
      expect(results.violations.map((v) => `${v.id}: ${v.description}`)).toEqual([]);
    }));
});

describe("the history panel", () => {
  const showHistory = async (open: Awaited<ReturnType<typeof setup>>) => {
    open.inspector.open();
    open.q<HTMLButtonElement>("#loominate-inspector-tab-history")?.click();
  };
  /** Each move as text, marking where the game is now with `>` and moves ahead with `+`. */
  const moves = (qa: (s: string) => HTMLElement[]) =>
    qa(".move").map(
      (li) =>
        `${li.getAttribute("aria-current") === "step" ? ">" : li.dataset.ahead === undefined ? " " : "+"}${[
          ...li.querySelectorAll(".move-head > *"),
        ]
          .map((n) => n.textContent)
          .join(" ")}`,
    );
  const go = (qa: (s: string) => HTMLElement[], label: string) => {
    const button = qa("button.move-label").find((b) => b.textContent === label);
    if (!button) throw new Error(`no move "${label}" to go to`);
    button.focus();
    button.click();
  };

  it("lists the moves, with the passage after each, and where the game is now", async () => {
    const game = await setup();
    await showHistory(game);
    expect(game.q(".count")?.textContent).toBe(
      "No moves yet. Each move you make can be jumped back to here.",
    );
    expect(moves(game.qa)).toEqual([">Start now at Cottage"]);
    game.follow("Climb");
    game.follow("Down");
    expect(game.q(".count")?.textContent).toBe("After move 2 of 2.");
    expect(moves(game.qa)).toEqual([
      " Start at Cottage",
      " Climb at Tower",
      ">Down now at Cottage",
    ]);
  });

  it("jumps back to a move, and forward again to the same state", async () => {
    const game = await setup();
    await showHistory(game);
    game.follow("Climb");
    game.follow("Down");
    const later = JSON.stringify(game.player.store?.snapshot());

    go(game.qa, "Start");
    expect(game.player.story?.current).toBe("Cottage");
    expect(lamp.lit).toBe(false);
    expect(game.q(".count")?.textContent).toBe(
      "At the start of 2. A new move discards the 2 moves ahead.",
    );
    expect(moves(game.qa)).toEqual([
      ">Start now at Cottage",
      "+Climb at Tower",
      "+Down at Cottage",
    ]);
    expect(game.root.activeElement?.textContent).toBe("Start");

    go(game.qa, "Down");
    expect(JSON.stringify(game.player.store?.snapshot())).toBe(later);
    expect(game.q(".count")?.textContent).toBe("After move 2 of 2.");
  });

  it("drops the moves ahead when a new move is made after jumping back", async () => {
    const game = await setup();
    await showHistory(game);
    game.follow("Climb");
    game.follow("Down");
    go(game.qa, "Climb");
    game.follow("Shout");
    expect(moves(game.qa)).toEqual([" Start at Cottage", " Climb at Tower", ">Shout now at Echo"]);
  });

  it("shows what each move changed when it's opened", async () => {
    const game = await setup();
    await showHistory(game);
    game.follow("Climb");
    const changes = game.qa<HTMLDetailsElement>(".move details")[0];
    expect(changes?.querySelector("summary")?.textContent).toBe("1 change");
    if (!changes) throw new Error("no changes");
    changes.open = true;
    changes.dispatchEvent(new Event("toggle"));
    expect([...changes.querySelectorAll(".changed li")].map((li) => li.textContent)).toEqual([
      "lamp.lit default → true",
    ]);
    expect(changes.querySelector(".engine")?.textContent).toMatch(/^Engine state too: .*\$story/);
  });

  it("passes automated accessibility checks", async () => {
    const game = await setup();
    await showHistory(game);
    game.follow("Climb");
    go(game.qa, "Start");
    const results = await axe.run(document.body, { rules: { region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.description}`)).toEqual([]);
  });
});
