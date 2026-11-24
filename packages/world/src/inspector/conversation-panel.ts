/**
 * The Conversation panel (#119, ADR 0096): the conversation now, with who's
 * in it, their open nodes, the exit, and each lock with what holds it; and
 * every topic entry of a character, with its conditions as written, and
 * whether it would answer now and whether it's suggested, and why not.
 */
import type { InspectorPanel } from "@loominate-if/inspector";
import {
  _conversationNow,
  _topicCharacters,
  _topicRows,
  conversation,
  type _TopicRow,
} from "@loominate-if/world";

const STYLES = `
.talk { width: 100%; border-collapse: collapse; }
.talk th, .talk td { text-align: start; padding: 0.15rem 0.5rem 0.15rem 0; vertical-align: top; }
.talk thead th { font-weight: 600; border-bottom: 1px solid var(--rule, currentColor); }
.talk code, .talk-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.talk-id, .talk-note { display: block; font-size: 0.85em; color: var(--muted, inherit); }
.talk ul { margin: 0; padding-inline-start: 1rem; }
.talk .no { color: var(--muted, inherit); }
h3 { font-size: 1em; margin: 1rem 0 0.25rem; }
`;

/** Whether something is so now, and why not: "Yes", or "No: …". */
export function describeNow(state: { readonly now: boolean; readonly why?: string }): string {
  return state.now ? "Yes" : `No${state.why === undefined ? "" : `: ${state.why}`}`;
}

/** A condition as the panel shows it: "player.knows(facts.x): false". */
export function describeCondition(c: NonNullable<_TopicRow["condition"]>): string {
  return `${c.text}: ${typeof c.value === "boolean" ? String(c.value) : `threw ${c.value}`}`;
}

/** The panel: the conversation now, then a character's topics. */
export const conversationPanel: InspectorPanel = {
  title: "Conversation",
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
    const table = (head: readonly string[], rows: readonly HTMLTableRowElement[]) => {
      const t = el("table", "talk");
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
    element.append(el("style", undefined, STYLES));
    const now = el("div");
    const label = el("label", undefined, "Topics of ");
    const picker = el("select");
    label.append(picker);
    const topics = el("div");
    element.append(el("h3", undefined, "Now"), now, el("h3", undefined, "Topics"), label, topics);
    /** The character chosen, kept across updates; the addressee until the player chooses. */
    let chosen: string | undefined;

    const showNow = () => {
      now.replaceChildren();
      const c = _conversationNow();
      if (!c.active) {
        now.append(el("p", "empty", "The player isn't talking to anyone."));
        return;
      }
      const who = el("ul");
      for (const p of c.participants) {
        const node = p.node
          ? `, node ${p.node.name}${p.node.restricts ? " (restrictive)" : ""}${p.node.exit ? `, ${p.node.exit} exit` : ""}`
          : "";
        who.append(el("li", undefined, `${p.name}${p.addressed ? " (addressed)" : ""}${node}`));
      }
      now.append(who, el("p", undefined, `Exit: ${c.exit}`));
      if (c.locks.length === 0) {
        now.append(el("p", "empty", "No locks."));
        return;
      }
      now.append(
        table(
          ["Lock", "Held by", "Reason"],
          c.locks.map((lock) => {
            const row = el("tr");
            const level = el("th", undefined, lock.level);
            level.scope = "row";
            row.append(
              level,
              el("td", undefined, lock.owner),
              el("td", undefined, lock.reason ?? "—"),
            );
            return row;
          }),
        ),
      );
    };

    const showTopics = () => {
      const characters = _topicCharacters();
      const ids = characters.map((c) => c.id);
      if (chosen === undefined || !ids.includes(chosen)) {
        const addressee = conversation.addressee?.id;
        chosen = addressee !== undefined && ids.includes(addressee) ? addressee : ids[0];
      }
      picker.replaceChildren(
        ...characters.map((c) => {
          const name = (c as unknown as { readonly name?: unknown }).name;
          const option = el("option", undefined, typeof name === "string" ? name : c.id);
          option.value = c.id;
          option.selected = c.id === chosen;
          return option;
        }),
      );
      topics.replaceChildren();
      const who = characters.find((c) => c.id === chosen);
      if (!who) {
        topics.append(el("p", "empty", "No one has topics."));
        return;
      }
      topics.append(
        table(
          ["Entry", "When", "Answers now", "Suggested now"],
          _topicRows(who).map((r) => {
            const row = el("tr");
            const entry = el("th");
            entry.scope = "row";
            entry.append(el("span", undefined, r.label), el("span", "talk-id", r.id));
            const notes = [
              ...(r.scope !== undefined ? [r.scope] : []),
              ...(r.priority !== 0 ? [`priority ${String(r.priority)}`] : []),
              ...r.flags,
            ];
            if (notes.length > 0) entry.append(el("span", "talk-note", notes.join("; ")));
            const when = el("td");
            if (r.condition) {
              when.append(el("code", undefined, describeCondition(r.condition)));
              if (r.condition.parts && r.condition.parts.length > 0) {
                const parts = el("ul");
                for (const part of r.condition.parts) {
                  parts.append(
                    el(
                      "li",
                      undefined,
                      `${part.text}: ${part.error !== undefined ? `threw ${part.error}` : JSON.stringify(part.value)}`,
                    ),
                  );
                }
                when.append(parts);
              }
            } else when.textContent = "—";
            row.append(
              entry,
              when,
              el("td", r.answers.now ? undefined : "no", describeNow(r.answers)),
              el("td", r.suggested.now ? undefined : "no", describeNow(r.suggested)),
            );
            return row;
          }),
        ),
      );
    };

    picker.addEventListener("change", () => {
      chosen = picker.value;
      showTopics();
    });
    const update = () => {
      showNow();
      showTopics();
    };
    update();
    return { update };
  },
};
