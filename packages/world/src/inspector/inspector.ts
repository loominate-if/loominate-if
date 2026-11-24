/**
 * The world model's inspector module (#91, ADR 0055): a "Fuses and daemons"
 * panel listing every fuse and daemon, whether each is running, cancelled,
 * stopped, or has fired, when it fires next, and where it comes from; a
 * Stats panel (#95); the World tree (#82); the NPCs panel (#108); and the
 * Conversation panel (#119).
 *
 * It's named in package.json as `loominate.inspector`, so the CLI loads it
 * only where the inspector is; nothing else in the world model imports the
 * inspector, so it never reaches a game's build. It's its own TypeScript
 * project, with DOM types the rest of the world model doesn't have, and
 * reaches the world model through its entry point, like any package.
 */
import { explainers, panels, type InspectorPanel } from "@loominate-if/inspector";
import { conversationPanel } from "./conversation-panel.js";
import { npcPanel } from "./npc-panel.js";
import { worldPanel } from "./world-panel.js";
import {
  _scheduled,
  _statsTable,
  _topicExplanations,
  clock,
  timeOfDay,
  type _ScheduledInfo,
  type _StatRow,
} from "@loominate-if/world";

type ScheduledInfo = _ScheduledInfo;

const SOURCE = "@loominate-if/world";

const STYLES = `
.schedule { width: 100%; border-collapse: collapse; }
.schedule th, .schedule td { text-align: start; padding: 0.15rem 0.5rem 0.15rem 0; vertical-align: top; }
.schedule th { font-weight: 600; border-bottom: 1px solid var(--rule, currentColor); }
.schedule code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.schedule .running { font-weight: 600; }
.schedule .idle { color: var(--muted, inherit); }
`;

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;
const amount = (s: ScheduledInfo, n: number): string =>
  s.unit === "minutes" ? plural(n, "minute", "minutes") : plural(n, "move", "moves");

/** Whether it's running, or how it last stopped. */
export function stateOf(s: ScheduledInfo): string {
  if (s.isRunning) return "Running";
  if (s.ended === "fired") return "Fired";
  if (s.ended === "cancelled") return "Cancelled";
  if (s.ended === "stopped") return "Stopped";
  return "Not started";
}

/** When it fires next, and how long until then, if it's running. */
export function nextOf(s: ScheduledInfo): string {
  if (s.firesAt === undefined) return "—";
  if (s.unit === "minutes") {
    return `${timeOfDay(s.firesAt)}, in ${amount(s, s.firesAt - clock.minutes)}`;
  }
  return `move ${String(s.firesAt)}, in ${amount(s, s.firesAt - clock.moves)}`;
}

/** Its delay, and what's special about it. */
export function detailsOf(s: ScheduledInfo): string {
  const parts =
    s.at === undefined
      ? [`${s.kind === "fuse" ? "after" : "every"} ${amount(s, s.delay)}`]
      : [`at ${s.at}${s.on === undefined ? " every day" : ` on ${s.on}`}`];
  if (s.interrupts) parts.push("interrupts");
  if (s.standsOut) parts.push("stands out");
  if (s.priority !== 0) parts.push(`priority ${String(s.priority)}`);
  if (s.joins !== undefined) parts.push(`joins “${s.joins}”`);
  return parts.join(", ");
}

/** The panel listing every fuse and daemon. */
export const schedulePanel: InspectorPanel = {
  title: "Fuses and daemons",
  mount(element) {
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
    const style = el("style", undefined, STYLES);
    const body = el("div");
    element.append(style, body);

    const update = () => {
      body.replaceChildren();
      const all = _scheduled();
      if (all.length === 0) {
        body.append(el("p", "empty", "The game has no fuses or daemons."));
        return;
      }
      const table = el("table", "schedule");
      const head = el("tr");
      for (const h of ["Name", "Kind", "State", "Next", "Timing", "From"]) {
        const th = el("th", undefined, h);
        th.scope = "col";
        head.append(th);
      }
      table.append(el("thead"), el("tbody"));
      table.tHead?.append(head);
      for (const s of all) {
        const row = el("tr", s.isRunning ? "running" : "idle");
        const name = el("th");
        name.scope = "row";
        name.append(el("code", undefined, s.id));
        row.append(
          name,
          el("td", undefined, s.kind),
          el("td", undefined, stateOf(s)),
          el("td", undefined, nextOf(s)),
          el("td", undefined, detailsOf(s)),
          el("td", undefined, s.source),
        );
        table.tBodies[0]?.append(row);
      }
      body.append(table);
    };

    update();
    return { update };
  },
};

/** When a modifier wears off, or that it lasts until removed. */
const wearsOff = (m: _StatRow["modifiers"][number]): string =>
  m.until !== undefined
    ? `until ${timeOfDay(m.until)}`
    : m.untilMove !== undefined
      ? `until move ${String(m.untilMove)}`
      : "until removed";

/** A modifier, as the panel shows it: "potion +2, until 9:30 pm". */
export function describeModifier(m: _StatRow["modifiers"][number]): string {
  const amount =
    m.by !== undefined ? `${m.by >= 0 ? "+" : ""}${String(m.by)}` : `×${String(m.times)}`;
  return `${m.from} ${amount}, ${wearsOff(m)}`;
}

/** The panel listing every body's stats, base and modified, with their modifiers (#95). */
export const statsPanel: InspectorPanel = {
  title: "Stats",
  mount(element) {
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
    element.append(body);
    const update = () => {
      body.replaceChildren();
      const rows = _statsTable();
      if (rows.length === 0) {
        body.append(el("p", "empty", "The game has no stats, or no bodies."));
        return;
      }
      const table = el("table", "schedule");
      const head = el("tr");
      for (const h of ["Who", "Stat", "Base", "Now", "Modifiers"]) {
        const th = el("th", undefined, h);
        th.scope = "col";
        head.append(th);
      }
      table.append(el("thead"), el("tbody"));
      table.tHead?.append(head);
      for (const r of rows) {
        const row = el("tr", r.now === r.base ? "idle" : "running");
        const who = el("th");
        who.scope = "row";
        who.append(el("code", undefined, r.mind === undefined ? r.body : `${r.body} (${r.mind})`));
        row.append(
          who,
          el("td", undefined, r.stat),
          el("td", undefined, String(r.base)),
          el("td", undefined, String(r.now)),
          el("td", undefined, r.modifiers.map(describeModifier).join("; ") || "—"),
        );
        table.tBodies[0]?.append(row);
      }
      body.append(table);
    };
    update();
    return { update };
  },
};

panels.register("schedule", schedulePanel, { source: SOURCE });
panels.register("stats", statsPanel, { source: SOURCE });
panels.register("world", worldPanel, { source: SOURCE });
panels.register("npcs", npcPanel, { source: SOURCE });
panels.register("conversation", conversationPanel, { source: SOURCE });
// Topic entries (#111): which answers each exchange now, and why the others don't.
explainers.register(
  "topics",
  { title: "Topics", hideWhenEmpty: true, explain: () => _topicExplanations() },
  { source: SOURCE },
);

export { conversationPanel, npcPanel, worldPanel };
