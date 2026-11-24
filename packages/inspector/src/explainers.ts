/**
 * "Why?" explainers (#47, #188): each lists the choices on offer now, of one
 * kind, and says why any can't be chosen. Links are core's kind; the world
 * model and kits register explainers for theirs, such as actions and topics,
 * and the inspector's Choices panel shows them all.
 */
import {
  actionCandidates,
  actionsFor,
  registry,
  statusOf,
  storyletStatus,
  type ActionRule,
  type ConditionPart,
  type Registry,
} from "@loominate-if/core";
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
  /** Why it can't be made, in the inspector's words, when no condition or rule says: "It's once only, and it's been seen." */
  readonly why?: string;
  /** The condition's parts and their values, to show which part doesn't hold. */
  readonly parts?: readonly ConditionPart[];
  /**
   * For an action, its name, and while it can't be taken, the reason its
   * verify or check gave and the rule that gave it.
   */
  readonly action?: {
    readonly name: string;
    readonly reason?: string;
    readonly by?: ActionRule;
  };
}

/** Explains the choices of one kind. */
export interface Explainer {
  /** The heading over its choices, such as "Links". */
  readonly title: string;
  /** The choices of this kind on offer now, available or not. */
  explain(context: PanelContext): readonly Explanation[];
  /** Leave the section out, rather than say "None here.", when there's nothing to explain: for a feature a game may not use. */
  readonly hideWhenEmpty?: boolean;
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
            action: { name: act.action, reason, ...(link.guard?.by && { by: link.guard.by }) },
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

/**
 * Every action on the menus of the things the player could act on: the
 * things with menus in the passage, then everything else in reach, as
 * core's action candidates give them (#80).
 */
export const actionExplainer: Explainer = {
  title: "Actions",
  explain({ player }) {
    const story = player.story;
    if (!story?.current) return [];
    const rendered = story.render();
    const ids = new Set<string>();
    for (const choice of rendered.choices) {
      if (choice.type === "link" && choice.guard?.menu !== undefined) ids.add(choice.guard.menu);
    }
    for (const { link } of rendered.unavailable) {
      if (link.guard?.menu !== undefined) ids.add(link.guard.menu);
    }
    for (const t of actionCandidates()) ids.add(t.id);
    const seen = new Set<string>();
    const out: Explanation[] = [];
    for (const id of ids) {
      for (const call of actionsFor({ id })) {
        // A multi-object action is on each participant's menu; list it once.
        const args = call.args as Readonly<Record<string, unknown>>;
        const key = [
          call.action.actionName,
          ...Object.keys(args)
            .sort()
            .map((k) => `${k}=${(args[k] as { id?: string } | undefined)?.id ?? String(args[k])}`),
        ].join(" ");
        if (seen.has(key)) continue;
        seen.add(key);
        const status = statusOf(call);
        const name = call.action.actionName;
        const reason = status.hidden ?? status.disabled;
        if (reason === undefined) {
          out.push({ label: status.label, available: true, action: { name } });
          continue;
        }
        out.push({
          label: status.label,
          available: false,
          shown: status.hidden !== undefined ? "hidden" : "disabled",
          action: { name, reason, ...(status.by && { by: status.by }) },
          ...(status.disabled !== undefined && { reason: status.disabled }),
        });
      }
    }
    return out;
  },
};

const ordinal = (n: number): string => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${String(n)}${n % 10 > 3 ? "th" : suffix}`;
};

/**
 * Core's storylets (#97): every one in the game, with its deck, priority,
 * and place in the order while it's eligible, and while it isn't, why: its
 * conditions, once only, or resting.
 */
export const storyletExplainer: Explainer = {
  title: "Storylets",
  hideWhenEmpty: true,
  explain() {
    return storyletStatus().map((s): Explanation => {
      const about = [
        s.deck === undefined ? "no deck" : `deck ${s.deck}`,
        `priority ${String(s.priority)}`,
        ...(s.rank === undefined ? [] : [`${ordinal(s.rank)} in order`]),
        ...(s.seen === 0 ? [] : [`seen ${String(s.seen)}×`]),
      ].join(", ");
      const label = `${s.passage} (${about})`;
      if (s.reason === undefined) return { label, available: true };
      if (s.failing !== undefined) {
        return {
          label,
          available: false,
          shown: "hidden",
          why: "Not while these don't hold:",
          parts: s.failing.map((text) => ({ text, value: "false" })),
        };
      }
      return { label, available: false, shown: "hidden", why: s.reason };
    });
  },
};
