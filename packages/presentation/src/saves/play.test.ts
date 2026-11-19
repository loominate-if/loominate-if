// @vitest-environment jsdom
/** The player shell (#230): saves, autosave, Continue, and the save menu. */
import "fake-indexeddb/auto";
import {
  createMemoryStorage,
  createSaves,
  createStore,
  type Passage,
  type SaveStorage,
} from "@loominate-if/core";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { layouts, widgets } from "../page/layout.js";
import { playGame, type PlayOptions } from "./play.js";
import { createBrowserStorage } from "./storage.js";

const passages: Passage[] = [
  {
    id: "Road",
    tags: [],
    body: () => [
      { type: "text", text: "A long road." },
      { type: "link", label: "Walk on", target: "Bridge" },
    ],
  },
  {
    id: "Bridge",
    tags: [],
    body: () => [
      { type: "text", text: "A stone bridge." },
      { type: "link", label: "Cross", target: "Inn" },
    ],
  },
  { id: "Inn", tags: [], body: () => [{ type: "text", text: "A warm inn." }] },
];

const game = { id: "lantern-road", version: "1.0.0" };
const players: { destroy(): void }[] = [];
afterEach(() => {
  for (const p of players.splice(0)) p.destroy();
  document.body.replaceChildren();
  widgets.remove("game-menu");
  const page = layouts.get("page");
  if (page) {
    layouts.replace("page", { regions: page.regions }, { source: "@loominate-if/presentation" });
  }
});

async function start(options: Partial<PlayOptions> = {}) {
  document.documentElement.lang = "en";
  document.title = "Lantern Road";
  const container = document.createElement("div");
  document.body.append(container);
  const player = await playGame(container, {
    passages,
    start: "Road",
    game,
    title: "Lantern Road",
    seed: () => "fixed",
    ...options,
  });
  players.push(player);
  const button = (label: string) => {
    // The game menu's buttons first, since the save menu has its own Save and Load.
    const menu = [...container.querySelectorAll<HTMLButtonElement>(".loominate-game-menu button")];
    const b = [...menu, ...container.querySelectorAll("button")].find(
      (x) => x.textContent === label || x.getAttribute("aria-label") === label,
    );
    if (!b) throw new Error(`no button "${label}"`);
    return b;
  };
  const click = (label: string) => {
    button(label).click();
  };
  const text = () => container.querySelector(".loominate-passage")?.textContent ?? "";
  const dialog = () => container.querySelector("dialog") as HTMLDialogElement;
  const rows = () =>
    [...dialog().querySelectorAll(".loominate-saves-slot .loominate-saves-name")].map(
      (n) => n.textContent,
    );
  return { container, player, button, click, text, dialog, rows };
}

const autosaved = async (storage: SaveStorage, id = game.id) =>
  (await createSaves({ storage, game: { ...game, id } }).load("autosave"))?.summary.passage;

describe("playing a game", () => {
  it("starts a new game, autosaving after each move, with the game menu in the header", async () => {
    const storage = createMemoryStorage();
    const { container, click, text } = await start({ storage });
    expect(text()).toContain("A long road.");
    const header = container.querySelector('[data-region="header"]');
    expect([...(header?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "Undo",
      "Save",
      "Load",
    ]);
    await vi.waitFor(async () => {
      expect(await autosaved(storage)).toBe("Road");
    });
    click("Walk on");
    await vi.waitFor(async () => {
      expect(await autosaved(storage)).toBe("Bridge");
    });
  });

  it("undoes from the menu, and autosaves what's left", async () => {
    const storage = createMemoryStorage();
    const { click, button, text } = await start({ storage });
    expect(button("Undo").getAttribute("aria-disabled")).toBe("true");
    click("Walk on");
    expect(button("Undo").getAttribute("aria-disabled")).toBe("false");
    click("Undo");
    expect(text()).toContain("A long road.");
    expect(button("Undo").getAttribute("aria-disabled")).toBe("true");
    await vi.waitFor(async () => {
      expect(await autosaved(storage)).toBe("Road");
    });
  });

  it("offers Continue to a returning player, or a new game", async () => {
    const storage = createMemoryStorage();
    const first = await start({ storage });
    first.click("Walk on");
    await vi.waitFor(async () => {
      expect(await autosaved(storage)).toBe("Bridge");
    });
    first.player.destroy();

    const back = await start({ storage });
    const screen = back.container.querySelector(".loominate-start");
    expect(screen?.querySelector("h1")?.textContent).toBe("Lantern Road");
    expect(screen?.textContent).toContain("You have a game in progress, at Bridge.");
    expect(document.activeElement).toBe(back.button("Continue"));
    back.click("Continue");
    expect(back.text()).toContain("A stone bridge.");
    expect(back.container.querySelector(".loominate-start")).toBeNull();

    back.player.destroy();
    const fresh = await start({ storage });
    fresh.click("New game");
    expect(fresh.text()).toContain("A long road.");
  });

  it("keeps saves in the browser between page loads", async () => {
    const first = await start({ game: { id: "reload-test", version: "1.0.0" } });
    first.click("Walk on");
    await vi.waitFor(() => {
      expect(first.player.story?.current).toBe("Bridge");
    });
    // Let the autosave reach IndexedDB, then load the page again.
    await vi.waitFor(async () => {
      expect(await autosaved(createBrowserStorage("reload-test"), "reload-test")).toBe("Bridge");
    });
    first.player.destroy();
    const again = await start({ game: { id: "reload-test", version: "1.0.0" } });
    expect(again.container.querySelector(".loominate-start")).not.toBeNull();
    again.click("Continue");
    expect(again.text()).toContain("A stone bridge.");
  });

  it("notes a game saved by another version", async () => {
    const storage = createMemoryStorage();
    const store = createStore();
    await createSaves({ storage, game: { ...game, version: "0.9.0" } }).autosave(store);
    const { container } = await start({ storage });
    expect(container.querySelector(".loominate-start")?.textContent).toContain(
      "It was saved by version 0.9.0 of the game.",
    );
  });
});

describe("the save menu", () => {
  it("saves to a named slot, lists it, and loads it", async () => {
    const { click, dialog, rows, text } = await start({
      storage: createMemoryStorage(),
    });
    click("Walk on");
    click("Save");
    await vi.waitFor(() => {
      expect(dialog().open).toBe(true);
    });
    const name = dialog().querySelector("input[type=text]") as HTMLInputElement;
    expect(document.activeElement).toBe(name);
    name.value = "At the bridge";
    dialog().querySelector("form")?.requestSubmit();
    await vi.waitFor(() => {
      expect(rows()).toEqual(["At the bridge", "Autosave"]);
    });
    expect(dialog().querySelector("[role=status]")?.textContent).toBe("Saved “At the bridge”.");
    click("Close the save menu");
    click("Cross");
    expect(text()).toContain("A warm inn.");

    click("Load");
    await vi.waitFor(() => {
      expect(dialog().open).toBe(true);
    });
    click("Load “At the bridge”");
    await vi.waitFor(() => {
      expect(text()).toContain("A stone bridge.");
    });
    expect(dialog().open).toBe(false);
  });

  it("saves over a slot, and deletes one after asking again", async () => {
    const storage = createMemoryStorage();
    const { click, dialog, rows } = await start({ storage });
    click("Save");
    await vi.waitFor(() => {
      expect(dialog().open).toBe(true);
    });
    dialog().querySelector("form")?.requestSubmit();
    await vi.waitFor(() => {
      expect(rows()).toEqual(["Road", "Autosave"]);
    });
    click("Save over “Road”");
    await vi.waitFor(() => {
      expect(dialog().querySelector("[role=status]")?.textContent).toBe("Saved over “Road”.");
    });
    click("Delete “Road”");
    expect(rows()).toEqual(["Road", "Autosave"]);
    click("Confirm deleting “Road”");
    await vi.waitFor(() => {
      expect(rows()).toEqual(["Autosave"]);
    });
  });

  it("exports a save as a file, and imports one", async () => {
    const storage = createMemoryStorage();
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:save";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    const { click, dialog, rows } = await start({ storage });
    click("Load");
    await vi.waitFor(() => {
      expect(rows()).toEqual(["Autosave"]);
    });
    click("Export “Autosave” as a file");
    await vi.waitFor(() => {
      expect(downloads).toEqual(["lantern-road-Autosave.json"]);
    });
    const exported = await created[0]?.text();
    expect(exported).toContain('"format":"loominate-save"');

    const input = dialog().querySelector("input[type=file]") as HTMLInputElement;
    const file = new File([exported ?? ""], "bridge.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(rows()).toEqual(["Autosave", "Road"]);
    });
    expect(dialog().querySelector("[role=status]")?.textContent).toBe(
      "Imported “Road”. Load it from the list.",
    );
    vi.restoreAllMocks();
  });

  it("says why an import failed, and changes nothing", async () => {
    const { click, dialog, rows } = await start({ storage: createMemoryStorage() });
    click("Load");
    await vi.waitFor(() => {
      expect(rows()).toEqual(["Autosave"]);
    });
    const input = dialog().querySelector("input[type=file]") as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["not a save"], "x.json")],
      configurable: true,
    });
    input.dispatchEvent(new Event("change"));
    await vi.waitFor(() => {
      expect(dialog().querySelector("[role=status]")?.textContent).toMatch(
        /^Importing failed: save: the file isn't valid JSON/,
      );
    });
    expect(rows()).toEqual(["Autosave"]);
  });

  it("works from the keyboard and passes automated accessibility checks", async () => {
    const { dialog, text, rows } = await start({ storage: createMemoryStorage() });
    const user = userEvent.setup({ document });
    const check = async () =>
      (
        await axe.run(document, { rules: { "color-contrast": { enabled: false } } })
      ).violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(await check()).toEqual([]);
    // Undo, Save, Load, then the passage's link.
    await user.tab();
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Save");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(dialog().open).toBe(true);
    });
    await user.keyboard("Start");
    await user.keyboard("{Enter}");
    await vi.waitFor(() => {
      expect(rows()).toEqual(["Start", "Autosave"]);
    });
    expect(await check()).toEqual([]);
    expect(text()).toContain("A long road.");
  });
});
