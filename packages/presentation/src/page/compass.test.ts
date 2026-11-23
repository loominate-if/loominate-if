// @vitest-environment jsdom
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { compassWidget, type CompassWay } from "./compass.js";
import type { WidgetHost } from "./layout.js";

const ways: CompassWay[] = [
  { direction: "north", label: "N", title: "North, to the library", available: true },
  {
    direction: "east",
    label: "E",
    title: "East",
    available: false,
    reason: "The cellar door is locked.",
  },
  { direction: "up", label: "Up", title: "Up", available: true },
  { direction: "fore", label: "Fore", title: "Fore", available: true },
];

let unmount: (() => void) | undefined;
afterEach(() => {
  unmount?.();
  unmount = undefined;
  document.body.replaceChildren();
});

function mount(keys?: "numpad" | "vi" | "both" | "none") {
  const taken: string[] = [];
  const definition = compassWidget({
    ways: () => ways,
    take: (_host, direction) => taken.push(direction),
    ...(keys !== undefined && { keys }),
  });
  const element = document.createElement("div");
  document.body.append(element);
  const shown = definition.view.mount(element, definition.data({} as never), {} as WidgetHost);
  unmount = shown.unmount;
  const button = (d: string) => element.querySelector<HTMLButtonElement>(`[data-direction="${d}"]`);
  const press = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
    );
  };
  return { element, taken, button, press };
}

describe("a compass", () => {
  it("lays out the ways, disabling those that can't be taken with why", async () => {
    const { element, button } = mount();
    expect(element.querySelector("nav")?.getAttribute("aria-label")).toBe("Compass");
    expect([button("north")?.style.gridColumn, button("north")?.style.gridRow]).toEqual(["2", "1"]);
    expect(button("north")?.getAttribute("aria-label")).toBe("North, to the library");
    expect(button("east")?.getAttribute("aria-disabled")).toBe("true");
    const why = document.getElementById(button("east")?.getAttribute("aria-describedby") ?? "");
    expect(why?.textContent).toBe("The cellar door is locked.");
    // Ways that aren't compass points go beside the grid.
    expect(
      [...element.querySelectorAll(".loominate-compass-others button")].map((b) => b.textContent),
    ).toEqual(["Up", "Fore"]);
    // Points with no way out are faint marks, not buttons, hidden from screen readers.
    const none = [...element.querySelectorAll<HTMLElement>(".loominate-compass-none")];
    expect(none.map((n) => n.dataset.direction)).toEqual([
      "northwest",
      "northeast",
      "west",
      "southwest",
      "south",
      "southeast",
    ]);
    expect(none.every((n) => n.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(element.querySelectorAll(".loominate-compass-points button")).toHaveLength(2);
    expect((await axe.run(element)).violations).toEqual([]);
  });

  it("takes a way when its button is clicked, but not a disabled one", () => {
    const { taken, button } = mount();
    button("north")?.click();
    button("east")?.click();
    expect(taken).toEqual(["north"]);
  });

  it("takes ways with the numpad, and vi keys only when asked", () => {
    const numpad = mount();
    numpad.press({ code: "Numpad8", key: "8" });
    numpad.press({ code: "NumpadAdd", key: "+" });
    numpad.press({ code: "Numpad6", key: "6" }); // east: locked
    numpad.press({ code: "KeyK", key: "k" }); // vi isn't on
    expect(numpad.taken).toEqual(["north", "up"]);
    unmount?.();
    const vi = mount("vi");
    vi.press({ code: "KeyK", key: "k" });
    vi.press({ code: "Numpad8", key: "8" });
    expect(vi.taken).toEqual(["north"]);
  });

  it("leaves keys alone while someone types, and when it's gone", () => {
    const { taken, press, element } = mount("both");
    const input = document.createElement("input");
    element.append(input);
    press({ code: "KeyK", key: "k" }, input);
    press({ code: "Numpad8", key: "8", ctrlKey: true });
    expect(taken).toEqual([]);
    unmount?.();
    unmount = undefined;
    press({ code: "Numpad8", key: "8" });
    expect(taken).toEqual([]);
  });
});
