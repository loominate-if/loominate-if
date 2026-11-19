// @vitest-environment jsdom
import {
  createEventRecord,
  createHistory,
  createStore,
  createStory,
  type Passage,
} from "@loominate-if/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  display,
  layouts,
  statusLine,
  statusLineView,
  widgets,
  type WidgetDefinition,
  type WidgetView,
} from "./layout.js";
import { mountPage } from "./page.js";

/** Registrations a test made, undone after it, since registries are global. */
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const undo of cleanup.splice(0).reverse()) undo();
});
const addLayout = (name: string, def: Parameters<typeof layouts.register>[1]) => {
  layouts.register(name, def);
  cleanup.push(() => {
    layouts.remove(name);
  });
};
const addWidget = <D>(name: string, def: WidgetDefinition<D>) => {
  widgets.register(name, def);
  cleanup.push(() => {
    widgets.remove(name);
  });
};

const passages: Passage[] = [
  {
    id: "Hall",
    tags: [],
    body: () => [
      { type: "text", text: "A hall." },
      { type: "link", label: "Ring the bell", target: "Butler" },
      { type: "link", label: "Garden", target: "Garden" },
    ],
  },
  {
    id: "Garden",
    tags: [],
    body: () => [
      { type: "text", text: "Roses." },
      { type: "link", label: "Back inside", target: "Hall" },
    ],
  },
  {
    id: "Butler",
    tags: [],
    effects: {
      enter: () => {
        display.layout = "conversation";
      },
      leave: () => {
        display.layout = "page";
      },
    },
    body: () => [
      { type: "text", text: '"Sir?"' },
      { type: "link", label: "Never mind", target: "Hall" },
    ],
  },
];

function play() {
  const store = createStore();
  const record = createEventRecord(store);
  const story = createStory(store, record, passages, { start: "Hall" });
  const history = createHistory(store);
  document.body.replaceChildren();
  const container = document.createElement("div");
  document.body.append(container);
  const page = mountPage(container, { story, record }, { onMove: () => history.checkpoint() });
  history.checkpoint();
  const root = page.element;
  const regions = () =>
    [...root.querySelectorAll<HTMLElement>(".loominate-region")].map(
      (r) => `${r.dataset.region ?? ""}${r.hidden ? " (hidden)" : ""}`,
    );
  const click = (label: string) => {
    const b = [...root.querySelectorAll("button")].find((x) => x.textContent === label);
    if (!b) throw new Error(`no button "${label}"`);
    b.click();
  };
  return { story, history, page, root, regions, click };
}

describe("layouts", () => {
  it("show the page layout by default, with empty regions hidden", () => {
    const { root, regions } = play();
    expect(root.dataset.layout).toBe("page");
    expect(regions()).toEqual(["header (hidden)", "main", "footer (hidden)"]);
    const main = root.querySelector('[data-region="main"]');
    expect(main?.querySelector("main")?.textContent).toContain("A hall.");
    expect(main?.querySelector("details.loominate-drawer")).not.toBeNull();
  });

  it("switch when an effect sets display.layout, keeping the main view", () => {
    addLayout("conversation", {
      regions: ["portraits", "main"],
      widgets: { portraits: ["status-line"] },
    });
    const { root, regions, click } = play();
    const main = root.querySelector("main");
    const passage = root.querySelector(".loominate-passage");
    click("Ring the bell");
    expect(root.dataset.layout).toBe("conversation");
    expect(regions()).toEqual(["portraits", "main"]);
    expect(root.querySelector("main")).toBe(main);
    expect(document.activeElement).toBe(passage);
    expect(root.querySelector(".loominate-status")?.textContent).toBe("ButlerMoves: 1");
    click("Never mind");
    expect(root.dataset.layout).toBe("page");
    expect(root.querySelector(".loominate-status")).toBeNull();
  });

  it("follow undo, since the layout is game state", () => {
    addLayout("conversation", { regions: ["main"] });
    const { root, history, page, click } = play();
    click("Ring the bell");
    expect(root.dataset.layout).toBe("conversation");
    history.undo();
    page.refresh();
    expect(display.layout).toBe("page");
    expect(root.dataset.layout).toBe("page");
  });

  it("explain layouts that can't be shown", () => {
    const { page } = play();
    display.layout = "nowhere";
    expect(() => {
      page.refresh();
    }).toThrow(
      'The layout "nowhere" isn\'t registered. Register it with layouts.register("nowhere", { regions: […] }), or set display.layout to one that is.',
    );
    addLayout("headless", { regions: ["header"] });
    display.layout = "headless";
    expect(() => {
      page.refresh();
    }).toThrow('The layout "headless" has no "main" region');
    addLayout("stray", { regions: ["main"], widgets: { sidebar: ["status-line"] } });
    display.layout = "stray";
    expect(() => {
      page.refresh();
    }).toThrow('The layout "stray" puts widgets in "sidebar", which isn\'t one of its regions.');
    addLayout("missing", { regions: ["main"], widgets: { main: ["compass"] } });
    display.layout = "missing";
    expect(() => {
      page.refresh();
    }).toThrow('The widget "compass" isn\'t registered.');
    display.layout = "page";
  });
});

describe("widgets", () => {
  it("update their view only when their data changes", () => {
    const update = vi.fn();
    const counter: WidgetView<{ visits: number }> = {
      mount: (element, data) => {
        element.textContent = String(data.visits);
        return { update, unmount: () => undefined };
      },
    };
    addWidget("hall-visits", {
      data: ({ story }) => ({ visits: story.visits("Hall") }),
      view: counter,
    });
    addLayout("counted", { regions: ["header", "main"], widgets: { header: ["hall-visits"] } });
    const { page, click } = play();
    display.layout = "counted";
    page.refresh();
    expect(document.querySelector('[data-widget="hall-visits"]')?.textContent).toBe("1");
    page.refresh();
    expect(update).not.toHaveBeenCalled();
    click("Garden");
    expect(update).not.toHaveBeenCalled();
    click("Back inside");
    expect(update).toHaveBeenCalledWith({ visits: 2 });
    display.layout = "page";
  });

  it("can make moves through their host", () => {
    addWidget("bell", {
      data: () => null,
      view: {
        mount: (element, _data, host) => {
          const b = element.ownerDocument.createElement("button");
          b.textContent = "Bell";
          b.addEventListener("click", () => {
            host.follow({ type: "link", label: "Ring the bell", target: "Butler" });
          });
          element.append(b);
          return { update: () => undefined, unmount: () => undefined };
        },
      },
    });
    addLayout("with-bell", { regions: ["main", "footer"], widgets: { footer: ["bell"] } });
    addLayout("conversation", { regions: ["main"] });
    const { story, page, click } = play();
    display.layout = "with-bell";
    page.refresh();
    click("Bell");
    expect(story.current).toBe("Butler");
  });

  it("can be restyled by replacing their view, keeping their data", () => {
    const original = widgets.get("status-line");
    const plain: WidgetView<{ left: string; right: string }> = {
      mount: (element, data) => {
        element.textContent = `${data.left} / ${data.right}`;
        return {
          update: (d) => {
            element.textContent = `${d.left} / ${d.right}`;
          },
          unmount: () => {
            element.textContent = "";
          },
        };
      },
    };
    addLayout("status", { regions: ["header", "main"], widgets: { header: ["status-line"] } });
    const { page } = play();
    display.layout = "status";
    page.refresh();
    expect(document.querySelector(".loominate-status")).not.toBeNull();
    widgets.replace("status-line", { ...statusLine({ right: () => "Score: 0" }), view: plain });
    cleanup.push(() => {
      if (original)
        widgets.replace("status-line", original, { source: "@loominate-if/presentation" });
    });
    page.refresh();
    expect(document.querySelector('[data-widget="status-line"]')?.textContent).toBe(
      "Hall / Score: 0",
    );
    expect(document.querySelectorAll('[data-widget="status-line"]')).toHaveLength(1);
    display.layout = "page";
  });

  it("are registered by the presentation package, with its built-in status line", () => {
    expect(widgets.entries().find((e) => e.key === "status-line")?.source).toBe(
      "@loominate-if/presentation",
    );
    expect(widgets.get("status-line")?.view).toBe(statusLineView);
    expect(layouts.get("page")).toEqual({ regions: ["header", "main", "footer"] });
  });
});
