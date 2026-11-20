// @vitest-environment jsdom
/** The inspector shell and its state tree (#45). */
import { createMemoryStorage, object, type Passage } from "@loominate-if/core";
import { layouts, playGame, widgets, type Player } from "@loominate-if/presentation";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspect, type Inspector } from "./inspect.js";
import { panels, type InspectorPanel } from "./panels.js";

const shed = object("shed", { name: "shed" });
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
    ],
  },
  {
    id: "Tower",
    tags: [],
    effects: {
      enter: () => {
        lamp.lit = true;
      },
    },
    body: () => [
      { type: "text", text: "The lamp burns." },
      { type: "link", label: "Down", target: "Cottage" },
    ],
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
    expect(qa("[role=tab]").map((t) => t.textContent)).toEqual(["State", "Clock"]);
    expect(mount).not.toHaveBeenCalled();

    q<HTMLButtonElement>("[role=tab][aria-selected=true]")?.focus();
    await user.keyboard("{ArrowRight}");
    expect(mount).toHaveBeenCalledTimes(1);
    expect(q("#loominate-inspector-panel-clock")?.textContent).toBe("At Cottage");
    expect(q("#loominate-inspector-panel-state")?.hidden).toBe(true);

    follow("Climb");
    expect(update).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>("#loominate-inspector-tab-clock")?.focus();
    await user.keyboard("{ArrowLeft}");
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
