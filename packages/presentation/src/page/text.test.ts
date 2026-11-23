// @vitest-environment jsdom
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import type { WidgetHost } from "./layout.js";
import { textWidget } from "./text.js";

describe("a text widget", () => {
  it("shows its text, labelled for screen readers, and follows changes", async () => {
    let time = "9:30 pm";
    const clock = textWidget({ text: () => time, label: () => "Time", className: "my-clock" });
    const element = document.createElement("div");
    document.body.append(element);
    const shown = clock.view.mount(element, clock.data({} as never), {} as WidgetHost);
    const box = element.querySelector(".loominate-text-widget");
    expect(box?.className).toBe("loominate-text-widget my-clock");
    expect(box?.getAttribute("aria-label")).toBe("Time");
    expect(box?.textContent).toBe("9:30 pm");
    time = "9:45 pm";
    shown.update(clock.data({} as never));
    expect(box?.textContent).toBe("9:45 pm");
    expect((await axe.run(element)).violations).toEqual([]);
    shown.unmount();
    expect(element.children).toHaveLength(0);
  });
});
