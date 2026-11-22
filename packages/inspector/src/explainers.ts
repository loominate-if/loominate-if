/**
 * "Why?" explainers (#47, #188): each lists the choices on offer now, of one
 * kind, and says why any can't be chosen. Links are core's kind; the world
 * model and kits register explainers for theirs, such as actions and topics,
 * and the inspector's Choices panel shows them all.
 */
import { registry, type ConditionPart, type Registry } from "@loominate-if/core";
import type { PanelContext } from "./panels.js";

/** A choice, and whether and why it can be made. */
export interface Explanation {
  /** The choice as the player knows it, such as a link's label. */
  readonly label: string;
  /** Where it leads, such as a passage, if it leads somewhere. */
  readonly target?: string;
  /** Whether the player can make it now. */
  readonly available: boolean;
  /** While it can't be made: whether the player sees it disabled, or not at all. */
  readonly shown?: "hidden" | "disabled";
  /** The condition that doesn't hold, as written. */
  readonly condition?: string;
  /** What the player is told, if anything. */
  readonly reason?: string;
  /** The condition's parts and their values, to show which part doesn't hold. */
  readonly parts?: readonly ConditionPart[];
  /** For an action link, the action it takes, and while it can't, the reason its verify or check gave. */
  readonly action?: { readonly name: string; readonly reason?: string };
}

/** Explains the choices of one kind. */
export interface Explainer {
  /** The heading over its choices, such as "Links". */
  readonly title: string;
  /** The choices of this kind on offer now, available or not. */
  explain(context: PanelContext): readonly Explanation[];
}

/** The inspector's explainers, shown in its Choices panel in registration order. */
export const explainers: Registry<Explainer> = registry<Explainer>("inspector explainers");

/** Core's links and continue points, in the passage the player is at. */
export const linkExplainer: Explainer = {
  title: "Links",
  explain({ player }) {
    const story = player.story;
    if (!story?.current) return [];
    const rendered = story.render();
    return [
      ...rendered.choices.map((c): Explanation =>
        c.type === "link" && c.guard?.act
          ? { label: c.label, available: true, action: { name: c.guard.act.action } }
          : {
              label: c.type === "continue" ? (c.label ?? "Continue") : c.label,
              target: c.target,
              available: true,
            },
      ),
      ...rendered.unavailable.map(({ link, mode, condition }): Explanation => {
        const parts = link.guard?.parts;
        const act = link.guard?.act;
        if (act) {
          // An action link stays on the passage; its condition is the action's own reason.
          const prefix = `${act.action}: `;
          const reason = condition.startsWith(prefix) ? condition.slice(prefix.length) : condition;
          return {
            label: link.label,
            available: false,
            shown: mode === "hidden" ? "hidden" : "disabled",
            action: { name: act.action, reason },
            ...(mode === "disabled-with-reason" &&
              link.guard?.reason !== undefined && { reason: link.guard.reason }),
          };
        }
        return {
          label: link.label,
          target: link.target,
          available: false,
          shown: mode === "hidden" ? "hidden" : "disabled",
          condition,
          ...(mode === "disabled-with-reason" &&
            link.guard?.reason !== undefined && { reason: link.guard.reason }),
          ...(parts !== undefined && { parts }),
        };
      }),
    ];
  },
};
