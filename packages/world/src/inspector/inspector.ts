/**
 * The world model's inspector module (#91, ADR 0055): a "Fuses and daemons"
 * panel listing every fuse and daemon, whether each is running, cancelled,
 * stopped, or has fired, when it fires next, and where it comes from.
 *
 * It's named in package.json as `loominate.inspector`, so the CLI loads it
 * only where the inspector is; nothing else in the world model imports the
 * inspector, so it never reaches a game's build. It's its own TypeScript
 * project, with DOM types the rest of the world model doesn't have, and
 * reaches the world model through its entry point, like any package.
 */
import { panels, type InspectorPanel } from "@loominate-if/inspector";
import { _scheduled, clock, timeOfDay, type _ScheduledInfo } from "@loominate-if/world";

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

panels.register("schedule", schedulePanel, { source: SOURCE });
