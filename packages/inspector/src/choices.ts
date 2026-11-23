/**
 * The Choices panel (#47): every choice on offer now, from every registered
 * explainer, and for each one that can't be made, why: the condition that
 * doesn't hold, the value of each of its parts, and what the player is told.
 */
import { explainers, type Explanation } from "./explainers.js";
import type { InspectorPanel } from "./panels.js";

/** Values that make a part false, so it's the likely culprit. */
const FALSY = new Set(["false", "null", "undefined", "0", '""', "NaN"]);

/** The panel showing why choices are and aren't available. */
export const choices: InspectorPanel = {
  title: "Choices",
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
    const code = (text: string) => el("code", undefined, text);

    /** One choice: its label and target, and if it's closed, why. */
    const item = (e: Explanation) => {
      const li = el("li", e.available ? "choice open" : "choice closed");
      const head = el("p", "choice-head");
      head.append(
        el(
          "span",
          "choice-state",
          e.available ? "Available" : e.shown === "hidden" ? "Hidden" : "Disabled",
        ),
        el("span", "choice-label", e.label),
      );
      if (e.target !== undefined) head.append(el("span", "choice-target", `→ ${e.target}`));
      if (e.action) head.append(el("span", "choice-target", `takes the action ${e.action.name}`));
      li.append(head);
      if (e.available) return li;
      if (e.action?.reason !== undefined) {
        const why = el("p", "why");
        why.append(
          e.shown === "hidden"
            ? `Because ${e.action.name} doesn't make sense here: ${e.action.reason}`
            : `Because ${e.action.name} isn't allowed now: ${e.action.reason}`,
        );
        li.append(why);
        const by = e.action.by;
        if (by !== undefined) {
          const rule = el("p", "rule");
          rule.append(
            `Decided by the ${by.stage} rule `,
            code(by.rule),
            ` in `,
            code(by.rulebook),
            `, from ${by.source}.`,
          );
          li.append(rule);
        }
      }
      if (e.condition !== undefined) {
        const why = el("p", "why");
        why.append("Because ", code(e.condition), " doesn't hold.");
        li.append(why);
      }
      if (e.parts && e.parts.length > 0) {
        const parts = el("dl", "parts");
        parts.setAttribute("aria-label", "Its parts");
        for (const part of e.parts) {
          const value = el("dd");
          if (part.error !== undefined) {
            value.className = "part-error";
            value.textContent = `couldn't be read: ${part.error}`;
          } else {
            value.textContent = part.value ?? "";
            if (FALSY.has(part.value ?? "")) value.dataset.falsy = "";
          }
          const term = el("dt");
          term.append(code(part.text));
          parts.append(term, value);
        }
        li.append(parts);
      }
      if (e.reason !== undefined) li.append(el("p", "told", `The player is told: “${e.reason}”`));
      return li;
    };

    const update = () => {
      element.replaceChildren();
      const story = context.player.story;
      if (!story?.current) {
        element.append(el("p", "empty", "No game has started yet."));
        return;
      }
      element.append(el("p", "at", `At ${story.current}`));
      for (const { key, value: explainer } of explainers.entries()) {
        const section = el("section", "explainer");
        const heading = el("h3", undefined, explainer.title);
        heading.id = `loominate-inspector-explainer-${key}`;
        section.setAttribute("aria-labelledby", heading.id);
        section.append(heading);
        let found: readonly Explanation[];
        try {
          found = explainer.explain(context);
        } catch (error) {
          section.append(
            el(
              "p",
              "part-error",
              `These choices couldn't be explained: ${error instanceof Error ? error.message : String(error)}`,
            ),
          );
          element.append(section);
          continue;
        }
        if (found.length === 0) {
          section.append(el("p", "empty", "None here."));
        } else {
          const list = el("ul", "choices");
          list.append(...found.map(item));
          section.append(list);
        }
        element.append(section);
      }
    };

    update();
    return { update };
  },
};
