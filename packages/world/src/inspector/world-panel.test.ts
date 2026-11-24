// @vitest-environment jsdom
import { createEventRecord, createStore, createStory, type StateStore } from "@loominate-if/core";
import { panels, type PanelContext } from "@loominate-if/inspector";
import axe from "axe-core";
import { beforeEach, describe, expect, it } from "vitest";
import { actor, container, defineFacts, mind, place, startAs, thing } from "@loominate-if/world";
import "./inspector.js";

const barn = place("barn", { name: "barn" });
place("yard", { name: "yard" });
const crate = thing("crate", { ...container, name: "crate", location: barn });
thing("turnip", { name: "turnip", location: crate });
const you = actor("you", { body: { name: "you", location: barn } });
const lamp = thing("lamp", { name: "lamp", location: you });
mind("ghost", { name: "ghost" });
const facts = defineFacts({ buried: "The gold is under the turnips." });
startAs(you);

let store: StateStore;
beforeEach(() => {
  store = createStore();
  createStory(store, createEventRecord(store), [{ id: "Start", tags: [], body: () => [] }], {
    start: "Start",
  }).begin();
});

function mount() {
  const element = document.createElement("div");
  document.body.replaceChildren(element);
  const view = panels
    .get("world")
    ?.mount(element, { player: { store } } as unknown as PanelContext);
  const visible = () =>
    [...element.querySelectorAll<HTMLElement>("[role=treeitem]")]
      .filter((i) => !i.parentElement?.closest("[role=treeitem][aria-expanded=false]"))
      .map(
        (i) =>
          `${"  ".repeat(Number(i.getAttribute("aria-level")) - 1)}${i.dataset.id ?? ""}${i.getAttribute("aria-expanded") === "false" ? " +" : ""}`,
      );
  const item = (id: string) =>
    [...element.querySelectorAll<HTMLElement>("[role=treeitem]")].find((i) => i.dataset.id === id);
  const key = (k: string) => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  };
  /** The details, each heading, line, term, and value apart. */
  const details = () =>
    [...element.querySelectorAll(".world-details :is(h3, h4, p, dt, dd, li)")]
      .map((n) => n.textContent)
      .join(" | ");
  return { element, view, visible, item, key, details };
}

describe("the World panel (#82)", () => {
  it("is a tree of places and what's in them, open on the player, then what's nowhere and minds with no body", async () => {
    const { element, visible } = mount();
    expect(panels.get("world")?.title).toBe("World");
    expect(visible()).toEqual(["barn", "  crate +", "  you +", "yard", "$bodiless +"]);
    expect(element.querySelector("[role=tree]")?.getAttribute("aria-label")).toBe("World");
    expect((await axe.run(element)).violations).toEqual([]);
  });

  it("moves and opens with the keyboard, and shows a node's details when it's chosen", () => {
    const { visible, item, key, details } = mount();
    item("barn")?.focus();
    key("ArrowDown"); // crate
    key("ArrowRight"); // opens it
    expect(visible()).toContain("    turnip");
    key("ArrowRight"); // into it
    expect(document.activeElement).toBe(item("turnip"));
    key("ArrowLeft"); // back to the crate
    key("ArrowLeft"); // closes it
    expect(visible()).toContain("  crate +");
    key("ArrowDown"); // you
    key("Enter");
    expect(item("you")?.getAttribute("aria-selected")).toBe("true");
    expect(details()).toContain(
      "you you | a body | In | barn | Mind | you:mind | Seen by | no one",
    );
    expect(details()).toContain(
      "What you:mind knows | No facts. | Has seen | none | Knows of | none",
    );
    expect(details()).toContain('Properties | holds | "in" | location | → barn');
  });

  it("shows what a mind knows, and who knows of a thing, and keeps up with the game", () => {
    const { view, item, details, element } = mount();
    item("you")?.click();
    you.learn(facts.buried, { from: crate });
    you.see(lamp);
    view?.update();
    expect(details()).toContain("The gold is under the turnips. buried, from crate");
    expect(details()).toContain("Has seen | lamp");
    // A jump goes to what it names, opening the way.
    [...element.querySelectorAll<HTMLButtonElement>(".world-details .jump")]
      .find((b) => b.textContent === "lamp")
      ?.click();
    expect(item("lamp")?.getAttribute("aria-selected")).toBe("true");
    expect(details()).toContain("In | you, barn");
    expect(details()).toContain("Seen by | you:mind");
    expect(document.activeElement).toBe(item("lamp"));
  });
});
