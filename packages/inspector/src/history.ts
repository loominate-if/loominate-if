/**
 * The History panel (#49): every move that can be undone or made again, and
 * a way to jump to any of them. It moves the game through the player's undo
 * history, so jumping back and forward again lands on exactly the same state,
 * and a new move after jumping back drops the moves ahead, as undo does.
 */
import type { HistoryStep, StateChange, StateValue } from "@loominate-if/core";
import type { InspectorPanel } from "./panels.js";

/** Where core keeps the passage the game is at. */
const STORY_ID = "$story";
const CURRENT_FIELD = "current";
/** Values longer than this are cut short; the state tree has them in full. */
const LONGEST_VALUE = 48;

/** One place in the history: the start, or just after a move. */
type Position = {
  /** How many moves from the start. */
  readonly index: number;
  /** The move that led here, missing for the start. */
  readonly step?: HistoryStep;
  /** The passage the game was at here. */
  readonly at: string | undefined;
};

/** The passage a step moved to or from, if it moved. */
const passageChange = (step: HistoryStep): StateChange | undefined =>
  step.diff.find((c) => c.id === STORY_ID && c.key === CURRENT_FIELD);

/** Every place in the history, from the start to the last move that can be made again. */
function positions(
  past: readonly HistoryStep[],
  future: readonly HistoryStep[],
  current: string | undefined,
): Position[] {
  /** The passage on the other side of a move: where it moved from or to, or where it stayed. */
  const across = (
    moved: StateChange | undefined,
    otherwise: string | undefined,
    key: "from" | "to",
  ) => (moved ? (typeof moved[key] === "string" ? moved[key] : undefined) : otherwise);
  const before: Position[] = [];
  let at = current;
  for (let i = past.length - 1; i >= 0; i--) {
    const step = past[i] as HistoryStep;
    before.unshift({ index: i + 1, step, at });
    at = across(passageChange(step), at, "from");
  }
  const start: Position = { index: 0, at };
  const after: Position[] = [];
  at = current;
  for (const [i, step] of future.entries()) {
    at = across(passageChange(step), at, "to");
    after.push({ index: past.length + i + 1, step, at });
  }
  return [start, ...before, ...after];
}

/** A stored value as the panel shows it: references as arrows, the rest as JSON, cut short. */
function show(value: StateValue | undefined): string {
  if (value === undefined) return "default";
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const ref = (value as { readonly [key: string]: StateValue }).$ref;
    if (typeof ref === "string" && Object.keys(value).length === 1) return `→ ${ref}`;
  }
  const text = JSON.stringify(value);
  return text.length > LONGEST_VALUE ? `${text.slice(0, LONGEST_VALUE - 1)}…` : text;
}

/** Whether a change is to core's own state, under an ID such as `$events`, rather than an object. */
const isEngine = (change: StateChange): boolean => change.id.startsWith("$");

/** The panel listing the moves, to jump back through and forward again. */
export const history: InspectorPanel = {
  title: "History",
  mount(element, { player }) {
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
    const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`;

    /** What a move changed, drawn when it's first opened, since a long game has many. */
    const changes = (step: HistoryStep) => {
      const objects = step.diff.filter((c) => !isEngine(c));
      const engine = [...new Set(step.diff.filter(isEngine).map((c) => c.id))];
      const details = el("details", "changes");
      details.append(
        el(
          "summary",
          undefined,
          objects.length === 0 ? "No object changed" : plural(objects.length, "change", "changes"),
        ),
      );
      details.addEventListener(
        "toggle",
        () => {
          const list = el("ul", "changed");
          for (const c of objects) {
            const li = el("li");
            li.append(
              el("code", undefined, `${c.id}.${c.key}`),
              ` ${show(c.from)} → ${show(c.to)}`,
            );
            list.append(li);
          }
          details.append(list);
          if (engine.length > 0) {
            details.append(el("p", "engine", `Engine state too: ${engine.join(", ")}`));
          }
        },
        { once: true },
      );
      return details;
    };

    /** The element focused inside the inspector's shadow root, which the document sees as its host. */
    const focused = () => (element.getRootNode() as Document | ShadowRoot).activeElement;

    const update = () => {
      const story = player.story;
      const steps = player.history;
      if (!story || !steps) {
        element.replaceChildren(el("p", "empty", "No game has started yet."));
        return;
      }
      const here = steps.past.length;
      const ahead = steps.future.length;
      const hadFocus = element.contains(focused());
      const summary =
        here + ahead === 0
          ? "No moves yet. Each move you make can be jumped back to here."
          : `${here === 0 ? "At the start" : `After move ${String(here)}`} of ${String(here + ahead)}.${
              ahead === 0 ? "" : ` A new move discards the ${plural(ahead, "move", "moves")} ahead.`
            }`;
      const list = el("ol", "moves");
      list.setAttribute("aria-label", "Moves");
      let now: HTMLElement | undefined;
      for (const position of positions(steps.past, steps.future, story.current)) {
        const li = el("li", "move");
        const label = position.step ? (position.step.label ?? "A move") : "Start";
        const head = el("p", "move-head");
        if (position.index === here) {
          li.setAttribute("aria-current", "step");
          now = el("span", "move-label", label);
          now.tabIndex = -1;
          head.append(now, el("span", "move-now", "now"));
        } else {
          if (position.index > here) li.dataset.ahead = "";
          const go = el("button", "move-label", label);
          go.type = "button";
          go.setAttribute(
            "aria-label",
            `${label}: go ${position.index < here ? "back" : "forward"} to ${
              position.index === 0 ? "the start" : `move ${String(position.index)}`
            }`,
          );
          go.addEventListener("click", () => {
            player.travel(position.index - here);
          });
          head.append(go);
        }
        if (position.at !== undefined) head.append(el("span", "move-at", `at ${position.at}`));
        li.append(head);
        if (position.step) li.append(changes(position.step));
        list.append(li);
      }
      element.replaceChildren(el("p", "count", summary), list);
      // A jump redraws the list; focus goes to where the game is now, not to the top of the page.
      if (hadFocus) now?.focus();
    };
    update();
    return { update };
  },
};
