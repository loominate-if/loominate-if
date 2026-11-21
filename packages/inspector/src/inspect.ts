/**
 * The inspector shell (#45): a panel docked to the side of the game, with a
 * tab for each registered panel. `loominate dev` adds it to every game; a
 * build carries it only with `loominate build --inspector`.
 */
import type { Player } from "@loominate-if/presentation";
import { choices } from "./choices.js";
import { eventLog } from "./event-log.js";
import { explainers, linkExplainer } from "./explainers.js";
import { history } from "./history.js";
import { panels, type PanelView } from "./panels.js";
import { ruleLog, rules } from "./rules.js";
import { stateTree } from "./state-tree.js";
import { STYLES } from "./styles.js";

const SOURCE = "@loominate-if/inspector";
panels.register("state", stateTree, { source: SOURCE });
panels.register("events", eventLog, { source: SOURCE });
panels.register("choices", choices, { source: SOURCE });
panels.register("rules", rules, { source: SOURCE });
panels.register("history", history, { source: SOURCE });
explainers.register("links", linkExplainer, { source: SOURCE });

/** The key that opens and closes the inspector, with Control. */
const SHORTCUT_KEY = "`";
/** Below this width the inspector covers the game instead of narrowing it. */
const DOCK_QUERY = "(min-width: 48rem)";
const WIDTH = "24rem";
const OPEN_KEY = "loominate:inspector:open";
const TAB_KEY = "loominate:inspector:tab";

/** Options for {@link inspect}. */
export interface InspectOptions {
  /** Whether the inspector starts open. Defaults to how it was left in this tab, else closed. */
  readonly open?: boolean;
}

/** An inspector added to a page by {@link inspect}. */
export interface Inspector {
  /** Whether the panel is showing. */
  readonly isOpen: boolean;
  /** Shows the panel, narrowing the game beside it. */
  open(): void;
  /** Hides the panel, giving the game its width back. */
  close(): void;
  /** Opens the panel if it's closed, or closes it. */
  toggle(): void;
  /** Removes the inspector from the page. */
  destroy(): void;
}

/**
 * Adds the inspector to the page a game is playing in: a button in the
 * corner, and Control with the backquote key from anywhere, open a panel docked beside the game
 * with a tab for each registered panel. It follows the game as it's played.
 *
 * @example
 * ```ts
 * const player = await playGame(container, options);
 * inspect(player);
 * ```
 */
export function inspect(player: Player, options: InspectOptions = {}): Inspector {
  const doc = document;
  const win = doc.defaultView;
  const session = {
    get(key: string): string | null {
      try {
        return win?.sessionStorage.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key: string, value: string): void {
      try {
        win?.sessionStorage.setItem(key, value);
      } catch {
        // The inspector works without it; it just forgets between reloads.
      }
    },
  };

  const host = doc.createElement("div");
  host.dataset.loominateInspector = "";
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = STYLES;

  const toggleButton = doc.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "toggle";
  toggleButton.textContent = "Inspector";
  toggleButton.setAttribute("aria-keyshortcuts", "Control+`");
  toggleButton.setAttribute("aria-expanded", "false");
  toggleButton.title = "Inspector (Ctrl+`)";

  const panel = doc.createElement("aside");
  panel.className = "panel";
  panel.setAttribute("aria-labelledby", "loominate-inspector-title");
  panel.hidden = true;
  const header = doc.createElement("header");
  const title = doc.createElement("h2");
  title.id = "loominate-inspector-title";
  title.textContent = "Inspector";
  title.tabIndex = -1;
  const closeButton = doc.createElement("button");
  closeButton.type = "button";
  closeButton.className = "close";
  closeButton.textContent = "Close";
  header.append(title, closeButton);
  const tabs = doc.createElement("div");
  tabs.className = "tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Inspector panels");
  const body = doc.createElement("div");
  body.className = "body";
  panel.append(header, tabs, body);
  shadow.append(style, toggleButton, panel);
  doc.body.append(host);

  /** Panels drawn so far, by key. Each is drawn the first time its tab is shown. */
  const mounted = new Map<string, { element: HTMLElement; view: PanelView }>();
  let active = session.get(TAB_KEY) ?? "state";
  let isOpen = false;
  let returnFocus: Element | null = null;
  const docked = () => win?.matchMedia?.(DOCK_QUERY).matches ?? true;
  const html = doc.documentElement;
  const marginBefore = html.style.marginInlineEnd;

  const report = (error: unknown) => {
    console.error(error);
  };

  const show = (key: string) => {
    const entry = panels.get(key);
    if (!entry) return;
    active = key;
    session.set(TAB_KEY, key);
    for (const tab of tabs.querySelectorAll<HTMLButtonElement>("[role=tab]")) {
      const selected = tab.dataset.key === key;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    let drawn = mounted.get(key);
    if (drawn) {
      try {
        drawn.view.update();
      } catch (error) {
        report(error);
      }
    } else {
      const element = doc.createElement("div");
      element.className = "tabpanel";
      element.id = `loominate-inspector-panel-${key}`;
      element.setAttribute("role", "tabpanel");
      element.setAttribute("aria-labelledby", `loominate-inspector-tab-${key}`);
      body.append(element);
      try {
        drawn = { element, view: entry.mount(element, { player }) };
        mounted.set(key, drawn);
      } catch (error) {
        element.textContent = `The ${entry.title} panel couldn't be shown: ${error instanceof Error ? error.message : String(error)}`;
        report(error);
      }
    }
    for (const el of body.querySelectorAll<HTMLElement>("[role=tabpanel]")) {
      el.hidden = el.id !== `loominate-inspector-panel-${key}`;
    }
  };

  /** The tabs, from the registry as it is now: packages can register panels after the inspector is added. */
  const drawTabs = () => {
    const entries = panels.entries();
    if (!entries.some((e) => e.key === active)) active = entries[0]?.key ?? "";
    tabs.replaceChildren(
      ...entries.map(({ key, value }) => {
        const tab = doc.createElement("button");
        tab.type = "button";
        tab.id = `loominate-inspector-tab-${key}`;
        tab.dataset.key = key;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", `loominate-inspector-panel-${key}`);
        tab.textContent = value.title;
        tab.addEventListener("click", () => {
          show(key);
        });
        return tab;
      }),
    );
    show(active);
  };

  tabs.addEventListener("keydown", (event) => {
    const all = [...tabs.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const at = all.findIndex((t) => t.dataset.key === active);
    const step =
      event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : event.key === "Home"
            ? -at
            : event.key === "End"
              ? all.length - 1 - at
              : 0;
    if (step === 0 || all.length === 0) return;
    event.preventDefault();
    const next = all[(at + step + all.length) % all.length];
    if (next?.dataset.key === undefined) return;
    show(next.dataset.key);
    next.focus();
  });

  const layout = () => {
    html.style.marginInlineEnd = isOpen && docked() ? WIDTH : marginBefore;
  };

  const open = () => {
    if (isOpen) return;
    isOpen = true;
    returnFocus = doc.activeElement;
    panel.hidden = false;
    toggleButton.hidden = true;
    toggleButton.setAttribute("aria-expanded", "true");
    session.set(OPEN_KEY, "1");
    layout();
    drawTabs();
  };

  const close = () => {
    if (!isOpen) return;
    // Focus inside a shadow root shows on the document as the host.
    const hadFocus = doc.activeElement === host;
    isOpen = false;
    panel.hidden = true;
    toggleButton.hidden = false;
    toggleButton.setAttribute("aria-expanded", "false");
    session.set(OPEN_KEY, "0");
    layout();
    if (hadFocus) {
      // Back where it was, or to the inspector's button if it was nowhere in particular.
      const back =
        returnFocus instanceof HTMLElement && returnFocus.isConnected && returnFocus !== doc.body
          ? returnFocus
          : toggleButton;
      back.focus();
    }
  };

  const toggle = () => {
    if (isOpen) close();
    else open();
  };

  toggleButton.addEventListener("click", () => {
    open();
    title.focus();
  });
  closeButton.addEventListener("click", close);
  panel.addEventListener("keydown", (event) => {
    // Escape in a filled search box clears it first, as browsers do.
    const clearing = event.target instanceof HTMLInputElement && event.target.value !== "";
    if (event.key === "Escape" && !clearing) {
      event.preventDefault();
      close();
    }
  });
  const onKey = (event: KeyboardEvent) => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== SHORTCUT_KEY) return;
    event.preventDefault();
    const opening = !isOpen;
    toggle();
    if (opening) title.focus();
  };
  doc.addEventListener("keydown", onKey);
  const media = win?.matchMedia?.(DOCK_QUERY);
  media?.addEventListener("change", layout);

  // Started now, so it ends each turn before the panels below update for it.
  ruleLog(player);
  const stop = player.onChange(() => {
    if (!isOpen) return;
    const drawn = mounted.get(active);
    if (!drawn) return;
    try {
      drawn.view.update();
    } catch (error) {
      report(error);
    }
  });

  if (options.open ?? session.get(OPEN_KEY) === "1") open();

  return {
    get isOpen() {
      return isOpen;
    },
    open,
    close,
    toggle,
    destroy() {
      stop();
      doc.removeEventListener("keydown", onKey);
      media?.removeEventListener("change", layout);
      for (const { view } of mounted.values()) {
        try {
          view.destroy?.();
        } catch (error) {
          report(error);
        }
      }
      html.style.marginInlineEnd = marginBefore;
      host.remove();
    },
  };
}
