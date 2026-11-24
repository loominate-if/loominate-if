// @vitest-environment jsdom
import {
  action,
  createEventRecord,
  createStore,
  createStory,
  menuLink,
  object,
} from "@loominate-if/core";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { mountPage } from "./page.js";

const jar = object("ask-jar", { name: "jar of buttons", buttons: 40, taken: 0 });
const takeSome = action<{ thing: typeof jar; count: number }>("ask-take-some", {
  on: jar,
  label: "Take some buttons…",
  asks: { count: { label: "How many?", max: () => jar.buttons } },
  confirm: "Take",
  run: ({ count }) => {
    jar.buttons -= count;
    jar.taken += count;
  },
  report: ({ count }) => `You take ${String(count)} buttons.`,
});
const shake = action<{ thing: typeof jar }>("ask-shake", { on: jar, label: "Shake the jar" });
void takeSome;
void shake;

function play() {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(
    store,
    record,
    [
      {
        id: "Shop",
        tags: [],
        body: () => [
          {
            type: "text",
            text: "A jar of buttons.",
            links: [
              {
                type: "link",
                label: "jar of buttons",
                target: "jar",
                guard: menuLink({ thing: jar }),
                start: 2,
                end: 16,
              },
            ],
          },
        ],
      },
    ],
    { start: "Shop" },
  );
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  mountPage(container, { story, record }, {});
  const name = () => container.querySelector<HTMLButtonElement>(".loominate-menu-link");
  const items = () => [...container.querySelectorAll<HTMLElement>("[role=menuitem]")];
  const form = () => container.querySelector<HTMLFormElement>(".loominate-menu-ask");
  const field = () => form()?.querySelector<HTMLInputElement>("input");
  const key = (k: string) => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  };
  const submit = () => {
    form()?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  };
  return { container, record, name, items, form, field, key, submit };
}

describe("an action that asks for a number, from a menu (#335)", () => {
  it("shows a labelled number field in place of the menu, with its limit", async () => {
    const { container, name, items, form, field } = play();
    name()?.click();
    expect(items().map((i) => i.textContent)).toEqual(["Take some buttons…", "Shake the jar"]);
    items()[0]?.click();
    expect(items()).toEqual([]);
    expect(form()?.tagName).toBe("FORM");
    expect(
      document.getElementById(form()?.getAttribute("aria-labelledby") ?? "")?.textContent,
    ).toBe("Take some buttons");
    const input = field();
    expect(input && [input.type, input.min, input.max, input.value]).toEqual([
      "number",
      "1",
      "40",
      "1",
    ]);
    expect(container.querySelector(`label[for="${input?.id ?? ""}"]`)?.textContent).toBe(
      "How many?",
    );
    expect(
      document.getElementById(input?.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("of 40");
    expect(document.activeElement).toBe(input);
    expect([...(form()?.querySelectorAll("button") ?? [])].map((b) => b.textContent)).toEqual([
      "Take",
      "Back",
    ]);
    const results = await axe.run(container, { rules: { region: { enabled: false } } });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });

  it("takes the action with the number given, and says why a number won't do", () => {
    const { container, name, items, field, form, submit } = play();
    name()?.click();
    items()[0]?.click();
    const input = field();
    if (!input) throw new Error("no field");
    input.value = "41";
    submit();
    expect(form()?.querySelector("[role=alert]")?.textContent).toBe(
      "Choose a whole number from 1 to 40.",
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(jar.taken).toBe(0);
    input.value = "12";
    submit();
    expect(form()).toBeNull();
    expect([jar.buttons, jar.taken]).toEqual([28, 12]);
    expect(container.textContent).toContain("You take 12 buttons.");
  });

  it("goes back to the menu, on the choice that asked, with Back or Escape", () => {
    const { name, items, form, key } = play();
    name()?.click();
    items()[0]?.click();
    key("Escape");
    expect(form()).toBeNull();
    expect(items().map((i) => i.textContent)).toEqual(["Take some buttons…", "Shake the jar"]);
    expect(document.activeElement).toBe(items()[0]);
    items()[0]?.click();
    [...(form()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Back")?.click();
    expect(document.activeElement).toBe(items()[0]);
  });
});
