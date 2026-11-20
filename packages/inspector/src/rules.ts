/**
 * The Rules panel (#48): which rules ran in each turn, from which package, and
 * what each did. Core reports every rulebook and hook run through
 * `traceRules`; the trace is kept here, in memory, not in the game's state,
 * so saves and replays don't change and a reload starts it afresh.
 */
import { traceRules, type RuleRun, type RuleStep } from "@loominate-if/core";
import type { Player } from "@loominate-if/presentation";
import type { InspectorPanel } from "./panels.js";

/** How many turns the log keeps; older ones are dropped. */
export const KEPT_TURNS = 50;

/** The rules that ran in one turn. */
type Turn = {
  readonly number: number;
  /** The passage the turn ended at. */
  readonly at: string | undefined;
  readonly runs: RuleRun[];
};

/** Runs since the last turn ended. Collected from when the inspector loads, before the game starts. */
let pending: RuleRun[] = [];
/** The turn that ended last, in whichever game. */
let latest: Turn | undefined;
/** Called when a run joins a turn that's already ended, so panels showing it redraw. */
const late = new Set<() => void>();
traceRules((run) => {
  // Autosave writes after the turn it saves has ended, so its rules belong to that turn.
  if (run.kind === "hook" && run.rulebook === "save" && latest) {
    latest.runs.push(run);
    for (const listener of [...late]) listener();
  } else {
    pending.push(run);
  }
});

type RuleLog = { readonly turns: readonly Turn[] };
const logs = new WeakMap<Player, RuleLog>();

/**
 * The log of turns for a player, started the first time it's asked for. A
 * turn ends whenever the game changes: a move, an undo, or a new or loaded game.
 */
export function ruleLog(player: Player): RuleLog {
  const known = logs.get(player);
  if (known) return known;
  const turns: Turn[] = [];
  let next = 0;
  const close = () => {
    latest = { number: next++, at: player.story?.current, runs: pending };
    turns.push(latest);
    pending = [];
    if (turns.length > KEPT_TURNS) turns.splice(0, turns.length - KEPT_TURNS);
  };
  // What ran as the game started, before the inspector was added to it.
  if (pending.length > 0) close();
  player.onChange(close);
  const log = { turns };
  logs.set(player, log);
  return log;
}

const OUTCOMES: Record<RuleStep["outcome"], string> = {
  continued: "passed",
  decided: "decided",
  changed: "changed the value",
  unchanged: "left the value as it was",
  stopped: "settled the value",
  ran: "ran",
};

/** The panel showing which rules ran in each turn. */
export const rules: InspectorPanel = {
  title: "Rules",
  mount(element, { player }) {
    const doc = element.ownerDocument;
    const log = ruleLog(player);
    /** Turns after this one are marked new: those since the panel last followed the game. */
    let newAfter = -1;
    let lastShown = -1;
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

    const turnView = (turn: Turn, isNew: boolean) => {
      const section = el("section", "turn");
      const heading = el(
        "h3",
        undefined,
        `${turn.number === 0 ? "Start" : `Turn ${String(turn.number)}`}${turn.at === undefined ? "" : ` · ${turn.at}`}`,
      );
      heading.id = `loominate-inspector-turn-${String(turn.number)}`;
      section.setAttribute("aria-labelledby", heading.id);
      if (isNew) {
        section.dataset.changed = "";
        heading.append(el("span", "visually-hidden", " (new)"));
      }
      section.append(heading);
      const ran = turn.runs.filter((r) => r.steps.length > 0);
      const idle = [
        ...new Set(turn.runs.filter((r) => r.steps.length === 0).map((r) => r.rulebook)),
      ];
      if (ran.length === 0) section.append(el("p", "empty", "No rules ran."));
      for (const run of ran) {
        const block = el("div", "run");
        const title = el("p", "run-title");
        title.append(el("span", "book", run.rulebook), el("span", "run-kind", run.kind));
        block.append(title);
        const table = el("table", "steps");
        const head = el("tr");
        head.append(
          el("th", undefined, "Rule"),
          el("th", undefined, "From"),
          el("th", undefined, "Did"),
        );
        const thead = el("thead");
        thead.append(head);
        const tbody = el("tbody");
        for (const step of run.steps) {
          const row = el("tr");
          if (step.rule === run.decidedBy) row.dataset.decided = "";
          row.append(
            el("td", "rule", step.rule),
            el("td", "source", step.source),
            el("td", "outcome", OUTCOMES[step.outcome]),
          );
          tbody.append(row);
        }
        table.append(thead, tbody);
        block.append(table);
        section.append(block);
      }
      if (idle.length > 0) {
        section.append(el("p", "idle", `With no rules: ${idle.join(", ")}`));
      }
      return section;
    };

    const draw = () => {
      const scroller = element.closest(".body") ?? element;
      const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 24;
      element.replaceChildren(
        el(
          "p",
          "count",
          `${log.turns.length === 1 ? "1 turn" : `${String(log.turns.length)} turns`} since the inspector loaded${log.turns.length === KEPT_TURNS ? `, the last ${String(KEPT_TURNS)} kept` : ""}`,
        ),
        ...log.turns.map((t) => turnView(t, newAfter >= 0 && t.number > newAfter)),
      );
      if (atEnd) scroller.scrollTop = scroller.scrollHeight;
    };

    const update = () => {
      newAfter = lastShown;
      lastShown = log.turns.at(-1)?.number ?? -1;
      draw();
    };
    late.add(draw);

    update();
    return {
      update,
      destroy() {
        late.delete(draw);
      },
    };
  },
};
