/**
 * The event log panel (#46): the game's event record, everything it has
 * output, in order. Filters narrow it by kind and by tag; an event must have
 * every chosen tag, as in core's `EventQuery`. Events new since the panel
 * last updated are marked.
 */
import {
  createEventRecord,
  type EventKind,
  type RecordedEvent,
  type StateValue,
} from "@loominate-if/core";
import type { InspectorPanel } from "./panels.js";

/** The most events drawn at once; older ones are counted, not drawn. */
export const SHOWN_EVENTS = 500;

/** One line saying what an event was. */
function summarize(event: RecordedEvent): string {
  switch (event.kind) {
    case "navigation":
      return event.from === undefined ? `→ ${event.to}` : `${event.from} → ${event.to}`;
    case "phase":
      return `${event.passage}: ${event.phase}${event.beat === undefined ? "" : ` after beat ${String(event.beat)}`}`;
    case "beat":
      return `${event.passage}: beat ${String(event.step)}${event.page === true ? ", page" : ""}`;
    default: {
      const text = (event as { readonly text?: unknown }).text;
      return typeof text === "string" ? text : "";
    }
  }
}

/** The fields an event carries beyond its seq, kind, and tags. */
function fields(event: RecordedEvent): [string, StateValue][] {
  return Object.entries(event as unknown as Record<string, StateValue>).filter(
    ([key]) => key !== "seq" && key !== "kind" && key !== "tags",
  );
}

/** The panel showing the event record. */
export const eventLog: InspectorPanel = {
  title: "Events",
  mount(element, { player }) {
    const doc = element.ownerDocument;
    const kinds = new Set<string>();
    const tags = new Set<string>();
    let seen: unknown;
    /** The first `seq` that's new since the last update. */
    let firstNew = Infinity;
    let lastLength = 0;

    const el = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className?: string,
      text?: string,
    ) => {
      const node = doc.createElement(tag);
      if (className !== undefined) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    const filters = el("div", "filters");
    const kindGroup = el("div", "chips");
    kindGroup.setAttribute("role", "group");
    kindGroup.setAttribute("aria-label", "Show kinds");
    const tagGroup = el("div", "chips");
    tagGroup.setAttribute("role", "group");
    tagGroup.setAttribute("aria-label", "Only with tags");
    filters.append(kindGroup, tagGroup);
    const count = el("p", "count");
    count.setAttribute("aria-live", "polite");
    const list = el("ol", "events");
    list.setAttribute("aria-label", "Events");
    element.append(filters, count, list);

    /** Toggle buttons for each value, pressed when chosen. */
    const chips = (
      group: HTMLElement,
      label: string,
      values: readonly string[],
      chosen: Set<string>,
      prefix = "",
    ) => {
      group.replaceChildren(el("span", "chips-label", label));
      for (const value of values) {
        const chip = el("button", "chip", `${prefix}${value}`);
        chip.type = "button";
        chip.dataset.value = value;
        chip.setAttribute("aria-pressed", String(chosen.has(value)));
        chip.addEventListener("click", () => {
          if (chosen.has(value)) chosen.delete(value);
          else chosen.add(value);
          chip.setAttribute("aria-pressed", String(chosen.has(value)));
          draw();
        });
        group.append(chip);
      }
      group.hidden = values.length === 0;
    };

    const draw = () => {
      const store = player.store;
      list.replaceChildren();
      if (!store) {
        count.textContent = "No game has started yet.";
        kindGroup.hidden = true;
        tagGroup.hidden = true;
        return;
      }
      const record = createEventRecord(store);
      const all = record.events();
      const allKinds: string[] = [...new Set(all.map((e) => e.kind))].sort();
      const allTags = [...new Set(all.flatMap((e) => e.tags))].sort();
      // A choice for something no longer in the record, after undo, drops away.
      for (const k of kinds) if (!allKinds.includes(k)) kinds.delete(k);
      for (const t of tags) if (!allTags.includes(t)) tags.delete(t);
      chips(kindGroup, "Kinds", allKinds, kinds);
      chips(tagGroup, "Tags", allTags, tags, "#");

      const matching = record.events({
        ...(kinds.size > 0 && { kinds: [...kinds] as EventKind[] }),
        ...(tags.size > 0 && { tags: [...tags] }),
      });
      const shown = matching.slice(-SHOWN_EVENTS);
      const filtered = kinds.size > 0 || tags.size > 0;
      count.textContent =
        `${filtered ? `${String(matching.length)} of ${String(all.length)}` : String(all.length)} ${all.length === 1 ? "event" : "events"}` +
        (shown.length < matching.length ? `, the last ${String(shown.length)} shown` : "");

      for (const event of shown) {
        const item = el("li", "event");
        item.dataset.kind = event.kind;
        const details = el("details");
        const summary = el("summary");
        summary.append(
          el("span", "seq", String(event.seq)),
          el("span", "kind", event.kind),
          el("span", "summary", summarize(event)),
          ...event.tags.map((t) => el("span", "tag", `#${t}`)),
        );
        if (event.seq >= firstNew) {
          item.dataset.changed = "";
          summary.append(el("span", "visually-hidden", " (new)"));
        }
        details.append(summary);
        const dl = el("dl");
        for (const [key, value] of fields(event)) {
          dl.append(el("dt", undefined, key), el("dd", undefined, JSON.stringify(value)));
        }
        details.append(dl);
        item.append(details);
        list.append(item);
      }
    };

    const update = () => {
      const store = player.store;
      const length = store ? createEventRecord(store).length : 0;
      // A new or loaded game is a fresh start; after an undo, nothing is new.
      firstNew = store === seen && length > lastLength ? lastLength : Infinity;
      if (store !== seen) {
        kinds.clear();
        tags.clear();
      }
      seen = store;
      lastLength = length;
      // Keep following the end of the log, unless the reader has scrolled back.
      const scroller = element.closest(".body") ?? element;
      const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
      draw();
      if (atEnd) scroller.scrollTop = scroller.scrollHeight;
    };

    update();
    return { update };
  },
};
