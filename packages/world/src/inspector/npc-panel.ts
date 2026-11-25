/**
 * The NPCs panel (#108, ADR 0086): where every NPC is, what they're doing
 * and why, and a timeline of what they did, offstage by default.
 */
import {
  createEventRecord,
  type HistoryStep,
  type RecordedEvent,
  type StateValue,
} from "@loominate-if/core";
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
.npcs .ahead { color: var(--muted, inherit); font-style: italic; }
.npcs button { font: inherit; }
h3 { font-size: 1em; margin: 1rem 0 0.25rem; }
`;

/** How many timeline entries the panel shows, newest first. */
const TIMELINE_LENGTH = 100;

/** Where core keeps the event record, each event under its sequence number. */
const EVENTS_ID = "$events";

/** An NPC event in the timeline, with the move it happened in, and whether that move is ahead, undone. */
export type TimelineEntry = {
  readonly event: RecordedEvent<"npc">;
  /** How many moves from the start: 0 for what happened as the game began. */
  readonly move: number;
  readonly ahead: boolean;
};

/** Whether a stored value is an NPC event, as a history step's change records one. */
const isNpcEvent = (value: StateValue | undefined): value is StateValue =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (value as { readonly kind?: unknown }).kind === "npc";

/**
 * The timeline, linked to the undo history (#138): each NPC event with the
 * move whose changes added it, then those of moves undone and still ahead.
 * Events from before the history begins, as the game's start, are move 0.
 */
export function timelineEntries(
  events: readonly RecordedEvent<"npc">[],
  history:
    { readonly past: readonly HistoryStep[]; readonly future: readonly HistoryStep[] } | undefined,
): TimelineEntry[] {
  const past = history?.past ?? [];
  const moveOf = new Map<string, number>();
  past.forEach((step, i) => {
    for (const c of step.diff) if (c.id === EVENTS_ID) moveOf.set(c.key, i + 1);
  });
  // One recorded since the last move, not yet part of any, belongs to where the game is now.
  const last = Math.max(-1, ...[...moveOf.keys()].map(Number));
  const now = events.map((event) => ({
    event,
    move: moveOf.get(String(event.seq)) ?? (past.length > 0 && event.seq > last ? past.length : 0),
    ahead: false,
  }));
  const later = (history?.future ?? []).flatMap((step, i) =>
    step.diff
      .filter((c) => c.id === EVENTS_ID && isNpcEvent(c.to))
      .map((c) => ({
        event: c.to as unknown as RecordedEvent<"npc">,
        move: past.length + i + 1,
        ahead: true,
      })),
  );
  return [...now, ...later];
}

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
  if (e.what === "told") return `told ${e.to ?? "?"}: ${e.fact ?? "?"}`;
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
      const { player } = context;
      const store = player.store;
      const history = player.history;
      const entries = (
        store ? timelineEntries(createEventRecord(store).events({ kinds: ["npc"] }), history) : []
      ).filter((e) => all.checked || !e.event.perceived);
      if (entries.length === 0) {
        timeline.append(
          el(
            "p",
            "empty",
            all.checked ? "NPCs haven't done anything yet." : "Nothing has happened offstage yet.",
          ),
        );
        return;
      }
      const here = history?.past.length ?? 0;
      timeline.append(
        table(
          ["Move", "When", "NPC", "What", "Seen"],
          entries
            .slice(-TIMELINE_LENGTH)
            .reverse()
            .map(({ event: e, move, ahead }) => {
              const row = el("tr", ahead ? "ahead" : undefined);
              // The move it happened in, to go to through the history, as the History tab does.
              // Where the game is now says so, for everyone, not only screen readers.
              const shown = move === 0 ? "start" : String(move);
              const go = el("button", undefined, move === here ? `${shown} (now)` : shown);
              go.type = "button";
              const name = move === 0 ? "the start" : `move ${String(move)}`;
              go.setAttribute(
                "aria-label",
                move === here ? `${name}, now` : `Go to ${name}${ahead ? ", ahead" : ""}`,
              );
              if (move === here) {
                go.setAttribute("aria-current", "step");
                go.disabled = true;
              }
              go.addEventListener("click", () => {
                player.travel(move - here);
              });
              const when = el("td");
              when.append(go);
              const who = el("td");
              who.append(el("code", undefined, e.npc));
              row.append(
                when,
                el("td", undefined, timeOfDay(e.at)),
                who,
                el("td", undefined, `${describeEvent(e)}${ahead ? " (ahead, undone)" : ""}`),
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
