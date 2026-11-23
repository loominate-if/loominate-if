/**
 * Typed lifecycle hooks (#26, ADR 0012): cross-cutting behavior at fixed points
 * in the story's life. A hook is a rulebook where every handler runs, so
 * handlers can be placed, replaced, and removed like rules.
 */
import type { EffectContext, MoveKind } from "../passages/story.js";
import type { SaveSummary } from "../save/save.js";
import {
  ruleList,
  runRule,
  traced,
  type Explanation,
  type RuleList,
  type RuleStep,
} from "./rules.js";

/** What hooks that run outside any one passage can see and do. */
export type HookContext = Pick<EffectContext, "state" | "persistent" | "emit">;

/**
 * Each hook's payload, by hook name.
 *
 * @remarks
 * Hooks that run during a move (`gameStart`, `passageEnter`, `passageLeave`,
 * `turnEnd`) can change state, which undo, save, and replay all see, and a
 * handler that throws rolls the move back. `save` and `load` only observe:
 * changing state outside a move would break replays.
 *
 * Extend this interface to add hooks, using declaration merging, and run them
 * with `hook(name).run(payload)`:
 *
 * ```ts
 * declare module "@loominate-if/core" {
 *   interface HookKinds {
 *     clockAdvance: HookContext & { readonly minutes: number };
 *   }
 * }
 * ```
 */
export interface HookKinds {
  /** When a new story begins, before the start passage is entered. */
  gameStart: HookContext;
  /** After a passage's own `firstVisit` and `enter` effects, before its prose is recorded. */
  passageEnter: EffectContext;
  /** After a passage's own `leave` effect. */
  passageLeave: EffectContext;
  /**
   * After each move (following a choice, a continue, an action, or `goTo`)
   * and its prose, with what kind of move it was. Not after beginning.
   */
  turnEnd: EffectContext & { readonly move: MoveKind };
  /**
   * When an action takes time, with how many minutes, after its action
   * stage. Core has no clock: the world model's clock (#84) handles it.
   */
  actionTime: {
    readonly action: string;
    readonly minutes: number;
    /** What may stop its time partway, by ID, as the action's `stopsFor` says, if it does. */
    readonly stopsFor?: (by: string) => boolean;
  };
  /** After a save is written to a slot. */
  save: { readonly slot: string; readonly summary: SaveSummary };
  /** After a save is read from a slot, before the host loads it. */
  load: { readonly slot: string; readonly summary: SaveSummary };
}

/** A hook: named handlers that all run, in order. */
export interface Hook<P> extends RuleList<(payload: P) => void> {
  /** Always `hook`. */
  readonly kind: "hook";
  /** Runs every handler in order. */
  run(payload: P): void;
  /** Runs every handler, recording each. */
  explain(payload: P): Explanation<undefined>;
}

const hooks = new Map<string, Hook<never>>();

/**
 * A lifecycle hook, by name. The same name always gives the same hook.
 *
 * @example
 * ```ts
 * hook("turnEnd").rule("lamp-burns-down", ({ state }) => {
 *   state.set("lamp", "fuel", (state.get("lamp", "fuel") as number) - 1);
 * });
 * ```
 */
export function hook<K extends keyof HookKinds & string>(name: K): Hook<HookKinds[K]> {
  const known = hooks.get(name);
  if (known) return known as unknown as Hook<HookKinds[K]>;
  const rules = ruleList<(payload: HookKinds[K]) => void>(name, "hook");
  const explain = (payload: HookKinds[K]): Explanation<undefined> => {
    const steps: RuleStep[] = [];
    for (const entry of rules.ordered()) {
      runRule(rules.where, entry, () => {
        entry.fn(payload);
      });
      steps.push({ rule: entry.name, source: entry.replacedBy ?? entry.source, outcome: "ran" });
    }
    return { result: undefined, steps };
  };
  const made: Hook<HookKinds[K]> = Object.freeze({
    kind: "hook" as const,
    name,
    rule: rules.rule,
    replace: rules.replace,
    remove: rules.remove,
    rules: rules.rules,
    run: (payload: HookKinds[K]) => {
      traced("hook", name, explain(payload));
    },
    explain,
  });
  hooks.set(name, made as unknown as Hook<never>);
  return made;
}
