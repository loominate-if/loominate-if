// @vitest-environment jsdom
/**
 * The accessibility baseline (#43): automated axe checks over the page in
 * each of its states, and a walkthrough played with the keyboard alone.
 */
import {
  createEventRecord,
  createStore,
  createStory,
  prose,
  type Passage,
} from "@loominate-if/core";
import { userEvent } from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { display, layouts, widgets } from "./layout.js";
import { mountPage } from "./page.js";

const passages: Passage[] = [
  {
    id: "Porch",
    tags: [],
    body: () => [
      { type: "text", text: "A porch. The door is shut." },
      { type: "link", label: "Knock", target: "Hallway" },
      {
        type: "link",
        label: "Climb the trellis",
        target: "Roof",
        guard: {
          open: false,
          condition: "rope",
          mode: "disabled-with-reason",
          reason: "It's rotten.",
        },
      },
    ],
  },
  {
    id: "Hallway",
    tags: [],
    body: () => [
      prose([
        "Nobody answers, but the door swings open. You could ",
        { type: "link", label: "go in", target: "Study" },
        " or ",
        {
          type: "link",
          label: "call out",
          target: "Study",
          guard: {
            open: false,
            condition: "voice",
            mode: "disabled-with-reason",
            reason: "Your throat is dry.",
          },
        },
        ".",
      ]),
    ],
  },
  {
    id: "Study",
    tags: [],
    body: () => [
      { type: "text", text: "Books everywhere." },
      { type: "continue", target: "Porch" },
    ],
  },
  { id: "Roof", tags: [], body: () => [{ type: "text", text: "Up high." }] },
];

const cleanup: (() => void)[] = [];
afterEach(() => {
  display.layout = "page";
  for (const undo of cleanup.splice(0).reverse()) undo();
});

function play() {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Porch" });
  document.documentElement.lang = "en";
  document.title = "Porch";
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  const page = mountPage(container, { story, record });
  const passage = () => container.querySelector(".loominate-passage") as HTMLElement;
  const user = userEvent.setup({ document });
  return { story, page, passage, user };
}

/** The axe violations on the whole document, as `rule: element` lines. */
async function violations(): Promise<string[]> {
  // jsdom can't compute colors, so contrast is left to themes (#40) and manual checks.
  const results = await axe.run(document, { rules: { "color-contrast": { enabled: false } } });
  return results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
}

/** The focused element, as the text a player would hear first. */
const focused = (): string => {
  const e = document.activeElement as HTMLElement | null;
  if (!e || e === document.body) return "(nothing)";
  if (e.classList.contains("loominate-passage")) return "(passage)";
  if (e.classList.contains("loominate-passage-heading")) return "(heading)";
  return e.textContent;
};

describe("automated accessibility checks", () => {
  it("find nothing on the page as it's played", async () => {
    const { page, user } = play();
    expect(await violations()).toEqual([]);
    await user.click(document.querySelector<HTMLElement>("a, button") as HTMLElement);
    expect(await violations()).toEqual([]); // inline links, one disabled
    await user.click(document.querySelector<HTMLElement>("a, button") as HTMLElement);
    (document.querySelector("details") as HTMLDetailsElement).open = true;
    expect(await violations()).toEqual([]); // a continue point and an open drawer
    page.destroy();
  });

  it("find nothing in a layout with widgets in every kind of region", async () => {
    layouts.register("busy", {
      regions: ["header", "nav", "portraits", "main", "aside", "footer"],
      widgets: {
        header: ["status-line"],
        nav: ["status-line"],
        portraits: ["status-line"],
        aside: ["status-line"],
        footer: ["status-line"],
      },
    });
    cleanup.push(() => {
      layouts.remove("busy");
    });
    const { page } = play();
    display.layout = "busy";
    page.refresh();
    expect(await violations()).toEqual([]);
    const regions = [...document.querySelectorAll<HTMLElement>(".loominate-region")];
    expect(regions.map((r) => [r.tagName.toLowerCase(), r.getAttribute("aria-label")])).toEqual([
      ["header", null],
      ["nav", null],
      ["section", "Portraits"],
      ["div", null],
      ["aside", null],
      ["footer", null],
    ]);
  });
});

describe("a keyboard-only walkthrough", () => {
  it("plays the story with Tab and Enter alone, and Space for buttons", async () => {
    const { story, passage, user } = play();

    // A choice first: the shut door, and the trellis that's out of reach.
    await user.tab();
    expect(focused()).toBe("Knock");
    await user.tab();
    expect(focused()).toBe("Climb the trellis");
    const trellis = document.activeElement as HTMLElement;
    expect(
      document.getElementById(trellis.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("It's rotten.");
    await user.keyboard("{Enter}");
    expect(story.current).toBe("Porch"); // disabled links stay focusable but do nothing
    await user.tab({ shift: true });
    await user.keyboard("{Enter}");

    // After a move, focus is on a heading before the new passage, only for
    // screen readers (#352), so the next Tab is its first choice.
    expect(story.current).toBe("Hallway");
    expect(focused()).toBe("(heading)");
    expect(passage().contains(document.activeElement)).toBe(true);
    await user.tab();
    expect(focused()).toBe("go in");
    await user.tab();
    expect(focused()).toBe("call out");
    await user.tab({ shift: true });
    // Links to passages are links, which Enter follows, as on any page; Space is for buttons.
    await user.keyboard(" ");
    expect(story.current).toBe("Hallway");
    await user.keyboard("{Enter}");

    expect(story.current).toBe("Study");
    expect(focused()).toBe("(heading)");
    await user.tab();
    expect(focused()).toBe("Continue");

    // Past the passage's choices is the story so far, which opens from the keyboard.
    await user.tab();
    expect(focused()).toBe("Story so far");
    // Browsers open a focused <summary> on Enter or Space; user-event doesn't
    // model that for summary, so activate it as the browser would.
    (document.activeElement as HTMLElement).click();
    expect(document.querySelector("details")?.open).toBe(true);
    expect(document.querySelector(".loominate-drawer-content")?.textContent).toContain(
      "Nobody answers",
    );
    await user.tab({ shift: true });
    await user.keyboard("{Enter}");
    expect(story.current).toBe("Porch");
    expect(story.actions).toHaveLength(3);
  });

  it("reaches widgets in the layout, in document order", async () => {
    widgets.register("knocker", {
      data: () => null,
      view: {
        mount: (element, _data, host) => {
          const b = element.ownerDocument.createElement("button");
          b.type = "button";
          b.textContent = "Ring";
          b.addEventListener("click", () => {
            host.follow({ type: "link", label: "Knock", target: "Hallway" });
          });
          element.append(b);
          return { update: () => undefined, unmount: () => undefined };
        },
      },
    });
    layouts.register("knocking", { regions: ["header", "main"], widgets: { header: ["knocker"] } });
    cleanup.push(() => {
      layouts.remove("knocking");
      widgets.remove("knocker");
    });
    const { story, page, user } = play();
    display.layout = "knocking";
    page.refresh();
    // Focus starts at the story (#352); from the top of the page, Tab reaches the header first.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.tab();
    expect(focused()).toBe("Ring");
    await user.keyboard("{Enter}");
    expect(story.current).toBe("Hallway");
  });
});
