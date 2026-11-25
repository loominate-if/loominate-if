/**
 * The NPCs panel (#108, ADR 0086): where every NPC is, what they're doing
 * and why, and a timeline of what they did, offstage by default.
 */
import { createEventRecord, type RecordedEvent } from "@loominate-if/core";
import type { InspectorPanel } from "@loominate-if/inspector";
import { _npcRows, timeOfDay, type _NpcRow } from "@loominate-if/world";

const STYLES = `
.npcs { width: 100%; border-collapse: collapse; }
.npcs th, .npcs td { text-align: start; padding: 0.15rem 0.5rem 0.15rem 0; vertical-align: top; }
.npcs thead th { font-weight: 600; border-bottom: 1px solid var(--rule, currentColor); }
.npcs code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.npcs ul { margin: 0; padding-inline-start: 1rem; }
.npcs .idle { color: var(--muted, inherit); }
.npcs .next { font-weight: 600; }
h3 { font-size: 1em; margin: 1rem 0 0.25rem; }
`;

/** How many timeline entries the panel shows, newest first. */
const TIMELINE_LENGTH = 100;

/** Whether an NPC gets a turn now, and why: "yes, seen by the player". */
export function describeTurn(row: _NpcRow): string {
  return `${row.turn ? "yes" : "no"}, ${row.why}`;
}

/** An agenda item, as the panel shows it: `"warn the player" (priority 10, active, ready, next)`. */
export function describeItem(item: _NpcRow["agenda"][number]): string {
  const flags = [
    `priority ${String(item.priority)}`,
    item.active ? "active" : "inactive",
    item.ready ? "ready" : "not ready",
    ...(item.next ? ["acts next"] : []),
  ];
  return `"${item.name}" (${flags.join(", ")})`;
}

/** A timetable, as the panel shows it: "13:00 market (weekday: tuesday) → next 20:00 home, 8:00 pm". */
export function describeTimetable(t: NonNullable<_NpcRow["timetable"]>): string {
  const entry = (e: { at: string; in: string; on?: string }) =>
    `${e.at} ${e.in}${e.on === undefined ? "" : ` (${e.on})`}`;
  const now = t.now ? entry(t.now) : "no entry yet";
  return t.next ? `${now} → next ${entry(t.next)}, ${timeOfDay(t.next.minutes)}` : now;
}

/** A timeline entry's description: "take gold: done", "go: refused, The cellar door is locked." */
export function describeEvent(e: RecordedEvent<"npc">): string {
  if (e.what === "moved") return `timetable: to ${e.to ?? "?"}`;
  if (e.what === "caughtUp") {
    return `caught up (${String(e.minutes ?? 0)} min, ${String(e.moves ?? 0)} moves)`;
  }
  return `${e.action ?? "?"}: ${e.done === true ? "done" : `refused${e.reason ? `, ${e.reason}` : ""}`}`;
}

/** The panel: a row per NPC, then the timeline. */
export const npcPanel: InspectorPanel = {
  title: "NPCs",
  mount(element, context) {
    const doc = element.ownerDocument;
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
    element.append(el("style", undefined, STYLES));
    const body = el("div");
    const label = el("label");
    const all = el("input");
    all.type = "checkbox";
    label.append(all, " Include what the player saw");
    const timeline = el("div");
    element.append(body, el("h3", undefined, "Timeline"), label, timeline);

    const table = (head: readonly string[], rows: readonly HTMLTableRowElement[]) => {
      const t = el("table", "npcs");
      const tr = el("tr");
      for (const h of head) {
        const th = el("th", undefined, h);
        th.scope = "col";
        tr.append(th);
      }
      t.append(el("thead"), el("tbody"));
      t.tHead?.append(tr);
      t.tBodies[0]?.append(...rows);
      return t;
    };

    const showNpcs = () => {
      body.replaceChildren();
      const rows = _npcRows();
      if (rows.length === 0) {
        body.append(el("p", "empty", "The game has no NPCs."));
        return;
      }
      body.append(
        table(
          ["NPC", "Where", "Level", "Turn now", "Agenda", "Timetable"],
          rows.map((r) => {
            const row = el("tr", r.turn ? undefined : "idle");
            const who = el("th");
            who.scope = "row";
            who.append(el("code", undefined, r.mind));
            const agenda = el("td");
            if (r.agenda.length === 0) agenda.textContent = "—";
            else {
              const list = el("ul");
              for (const item of r.agenda)
                list.append(el("li", item.next ? "next" : undefined, describeItem(item)));
              agenda.append(list);
            }
            row.append(
              who,
              el("td", undefined, r.place ?? "nowhere"),
              el("td", undefined, r.pace === undefined ? r.level : `${r.level}, ${r.pace}`),
              el("td", undefined, describeTurn(r)),
              agenda,
              el("td", undefined, r.timetable ? describeTimetable(r.timetable) : "—"),
            );
            return row;
          }),
        ),
      );
    };

    const showTimeline = () => {
      timeline.replaceChildren();
      const store = context.player.store;
      const events = store
        ? createEventRecord(store)
            .events({ kinds: ["npc"] })
            .filter((e) => all.checked || !e.perceived)
        : [];
      if (events.length === 0) {
        timeline.append(
          el(
            "p",
            "empty",
            all.checked ? "NPCs haven't done anything yet." : "Nothing has happened offstage yet.",
          ),
        );
        return;
      }
      timeline.append(
        table(
          ["When", "NPC", "What", "Seen"],
          events
            .slice(-TIMELINE_LENGTH)
            .reverse()
            .map((e) => {
              const row = el("tr");
              const who = el("td");
              who.append(el("code", undefined, e.npc));
              row.append(
                el("td", undefined, timeOfDay(e.at)),
                who,
                el("td", undefined, describeEvent(e)),
                el("td", undefined, e.perceived ? "yes" : "no"),
              );
              return row;
            }),
        ),
      );
    };

    const update = () => {
      showNpcs();
      showTimeline();
    };
    all.addEventListener("change", showTimeline);
    update();
    return { update };
  },
};
