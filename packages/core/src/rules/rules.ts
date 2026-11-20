/**
 * Rulebooks (#26, ADR 0012): library behavior as named, ordered rules that
 * authors and extensions can insert before or after, replace, or remove.
 *
 * Rulebooks are module-level handles, like random streams and objects:
 * `export const damage = rulebook("damage", { kind: "fold" })`, and packages
 * add rules when their modules load. Rules without placement keep registration
 * order, which follows module import order, so the order is always the same.
 * Every rule records the package that added it, and `explain` shows what each
 * rule did, for the inspector (design principle 5).
 */
import { StateError } from "../state/value.js";

/** Who added a rule, hook handler, or registry entry when nothing says otherwise: the game itself. */
export const GAME_SOURCE = "game";

/** Where a rule goes, and who added it. */
export interface RuleOptions {
  /** Run before these rules. Rules that were removed are ignored. */
  readonly before?: string | readonly string[];
  /** Run after these rules. Rules that were removed are ignored. */
  readonly after?: string | readonly string[];
  /** The package that added the rule, for the inspector. Defaults to {@link GAME_SOURCE}. */
  readonly source?: string;
}

/** A rule in a rulebook's order, as the inspector shows it. */
export interface RuleInfo {
  /** The rule's name, unique in its rulebook. */
  readonly name: string;
  /** The package that added it. */
  readonly source: string;
  /** The package that replaced its behavior, if one did. */
  readonly replacedBy?: string;
}

/** What one rule did in a run. */
export interface RuleStep {
  /** The rule. */
  readonly rule: string;
  /** The package that added it, or that replaced it. */
  readonly source: string;
  /**
   * What happened:
   * - `continued`: a decide rule made no decision;
   * - `decided`: a decide rule settled the result;
   * - `changed` or `unchanged`: a fold rule passed on a new value, or the same one;
   * - `stopped`: a fold rule settled the result;
   * - `ran`: a hook handler ran.
   */
  readonly outcome: "continued" | "decided" | "changed" | "unchanged" | "stopped" | "ran";
}

/** A run of a rulebook, explained: its result and what each rule did, in order. */
export interface Explanation<R> {
  /** The result, as `run` would return it. */
  readonly result: R;
  /** Each rule that ran, in order. Rules after a decision or a stop don't run. */
  readonly steps: readonly RuleStep[];
  /** The rule that settled the result, if one did. */
  readonly decidedBy?: string;
}

/** What every rulebook and hook can do: add, replace, and remove rules, and list them. */
export interface RuleList<F> {
  /** The rulebook's name. */
  readonly name: string;
  /**
   * Adds a rule.
   * @throws {@link StateError} if the rulebook already has a rule with that name.
   */
  rule(name: string, fn: F, options?: RuleOptions): void;
  /**
   * Replaces a rule's behavior, keeping its place.
   * @throws {@link StateError} if there's no rule with that name.
   */
  replace(name: string, fn: F, options?: { readonly source?: string }): void;
  /**
   * Removes a rule. Rules placed before or after it keep their other placements.
   * @throws {@link StateError} if there's no rule with that name.
   */
  remove(name: string): void;
  /**
   * The rules in the order they run.
   * @throws {@link StateError} if a rule is placed relative to one that never existed, or placements form a cycle.
   */
  rules(): readonly RuleInfo[];
}

/**
 * A rulebook where the first rule to decide wins, after Inform 7. A rule
 * returns `undefined` to let the next rule run, or a value to settle the result.
 */
export interface DecideRulebook<In, Out> extends RuleList<(input: In) => Out | undefined> {
  /** Always `decide`. */
  readonly kind: "decide";
  /** Runs the rules in order until one decides. */
  run(input: In): Out;
  /** Runs the rules as {@link DecideRulebook.run} does, recording what each did. */
  explain(input: In): Explanation<Out>;
}

/**
 * A fold rule: returns the value to pass to the next rule, or `stop(value)` to
 * settle the result without running the rest.
 */
export type FoldRule<V, In> = (
  value: V,
  input: In,
  stop: (value: V) => Stopped<V>,
) => V | Stopped<V>;

/**
 * A fold rule's settled result, made with the `stop` it's given. Only `stop`
 * makes these, so a value that happens to look like one is never mistaken for it.
 */
export interface Stopped<V> {
  /** The settled value. */
  readonly stopped: V;
}

const stops = new WeakSet<object>();

/** A rulebook or hook run, as {@link traceRules} reports it. */
export interface RuleRun {
  /** The rulebook's or hook's name. */
  readonly rulebook: string;
  /** What kind it is. */
  readonly kind: "decide" | "fold" | "hook";
  /** Each rule that ran, in order, with the package that added it and what it did. */
  readonly steps: readonly RuleStep[];
  /** The rule that settled the result, if one did. */
  readonly decidedBy?: string;
}

const tracers = new Set<(run: RuleRun) => void>();

/**
 * Calls `listener` after every rulebook and hook run, with the rules that ran
 * and what each did, so tools such as the inspector can show which rules
 * fired. Tracing is observation only: nothing is stored, and a listener that
 * throws is ignored, so it never changes how a game plays. Runs started with
 * `explain` aren't reported, since they're already being looked at.
 * @returns A function that stops calling the listener.
 */
export function traceRules(listener: (run: RuleRun) => void): () => void {
  tracers.add(listener);
  return () => {
    tracers.delete(listener);
  };
}

/** @internal Reports a finished run to the tracers, if there are any. */
export function traced<R>(kind: RuleRun["kind"], rulebook: string, explanation: Explanation<R>): R {
  if (tracers.size > 0) {
    const run: RuleRun = Object.freeze({
      rulebook,
      kind,
      steps: explanation.steps,
      ...(explanation.decidedBy !== undefined && { decidedBy: explanation.decidedBy }),
    });
    for (const listener of [...tracers]) {
      try {
        listener(run);
      } catch {
        // Tracing must never change how the game plays.
      }
    }
  }
  return explanation.result;
}

/**
 * A rulebook where each rule transforms a value in turn: base damage, plus
 * strength, times a critical hit. A rule can stop the rest with `stop(value)`.
 */
export interface FoldRulebook<V, In> extends RuleList<FoldRule<V, In>> {
  /** Always `fold`. */
  readonly kind: "fold";
  /** Passes `value` through the rules in order, and returns what comes out. */
  run(value: V, input: In): V;
  /** Runs the rules as {@link FoldRulebook.run} does, recording what each did. */
  explain(value: V, input: In): Explanation<V>;
}

type Entry<F> = {
  readonly name: string;
  readonly index: number;
  readonly source: string;
  fn: F;
  replacedBy?: string;
  readonly before: readonly string[];
  readonly after: readonly string[];
};

const list = (v: string | readonly string[] | undefined): readonly string[] =>
  v === undefined ? [] : typeof v === "string" ? [v] : v;

/** The names in use, so two rulebooks or hooks can never be confused in the inspector. */
const names = new Set<string>();

/** @internal Rule storage and ordering shared by rulebooks and hooks. */
export function ruleList<F>(
  name: string,
  what: string,
): RuleList<F> & {
  ordered(): readonly Entry<F>[];
  where: string;
} {
  if (name.length === 0) throw new StateError(`${what}: the name must be non-empty.`);
  const where = `${what} ${JSON.stringify(name)}`;
  if (names.has(where)) throw new StateError(`${where}: there's already one with that name.`);
  names.add(where);

  const entries = new Map<string, Entry<F>>();
  const removed = new Set<string>();
  let added = 0;
  let cache: readonly Entry<F>[] | undefined;

  const find = (rule: string, verb: string): Entry<F> => {
    const entry = entries.get(rule);
    if (!entry) {
      throw new StateError(
        `${where}: can't ${verb} the rule ${JSON.stringify(rule)}; it has no rule by that name.${
          removed.has(rule) ? " It was removed." : ""
        }`,
      );
    }
    return entry;
  };

  /**
   * Kahn's algorithm, always taking the earliest-added rule that's ready, so
   * rules without placements keep the order they were added in.
   */
  const order = (): readonly Entry<F>[] => {
    const all = [...entries.values()];
    const after = new Map<string, Set<string>>(all.map((e) => [e.name, new Set<string>()]));
    const link = (first: string, then: string) => after.get(then)?.add(first);
    for (const e of all) {
      for (const [targets, side] of [
        [e.before, "before"],
        [e.after, "after"],
      ] as const) {
        for (const t of targets) {
          if (removed.has(t)) continue;
          if (!entries.has(t)) {
            throw new StateError(
              `${where}: the rule ${JSON.stringify(e.name)} is placed ${side} ${JSON.stringify(t)}, which isn't in it. Check the name, or that the package adding it loads first.`,
            );
          }
          if (side === "before") link(e.name, t);
          else link(t, e.name);
        }
      }
    }
    const out: Entry<F>[] = [];
    const waiting = new Set(all);
    while (waiting.size > 0) {
      let next: Entry<F> | undefined;
      for (const e of waiting) {
        const deps = after.get(e.name) ?? new Set();
        if ([...deps].every((d) => !waiting.has(entries.get(d) as Entry<F>))) {
          if (!next || e.index < next.index) next = e;
        }
      }
      if (!next) {
        const stuck = [...waiting].map((e) => JSON.stringify(e.name)).join(", ");
        throw new StateError(
          `${where}: the rules ${stuck} are placed before and after each other.`,
        );
      }
      waiting.delete(next);
      out.push(next);
    }
    return out;
  };

  const ordered = (): readonly Entry<F>[] => {
    cache ??= order();
    return cache;
  };

  return {
    name,
    where,
    ordered,
    rule(rule, fn, options = {}) {
      if (rule.length === 0) throw new StateError(`${where}: a rule name must be non-empty.`);
      if (entries.has(rule)) {
        throw new StateError(
          `${where}: there's already a rule named ${JSON.stringify(rule)}; use replace() to change it.`,
        );
      }
      removed.delete(rule);
      entries.set(rule, {
        name: rule,
        index: added++,
        source: options.source ?? GAME_SOURCE,
        fn,
        before: list(options.before),
        after: list(options.after),
      });
      cache = undefined;
    },
    replace(rule, fn, options = {}) {
      const entry = find(rule, "replace");
      entry.fn = fn;
      entry.replacedBy = options.source ?? GAME_SOURCE;
    },
    remove(rule) {
      find(rule, "remove");
      entries.delete(rule);
      removed.add(rule);
      cache = undefined;
    },
    rules: () =>
      ordered().map((e) => ({
        name: e.name,
        source: e.source,
        ...(e.replacedBy !== undefined && { replacedBy: e.replacedBy }),
      })),
  };
}

/** Runs one rule, naming it in any error so authors can find it. */
export function runRule<T>(where: string, entry: Entry<unknown>, run: () => T): T {
  try {
    return run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new StateError(
      `${where}, rule ${JSON.stringify(entry.name)} (from ${entry.replacedBy ?? entry.source}): ${message}`,
      { cause: error },
    );
  }
}

const sourceOf = (e: Entry<unknown>): string => e.replacedBy ?? e.source;

/**
 * Creates a rulebook where the first rule to decide wins. If no rule decides,
 * the result is `otherwise(input)`.
 * @throws {@link StateError} if a rulebook with that name already exists.
 */
export function rulebook<In, Out>(
  name: string,
  options: { readonly kind: "decide"; readonly otherwise: (input: In) => Out },
): DecideRulebook<In, Out>;
/**
 * Creates a rulebook where the first rule to decide wins. If no rule decides,
 * the result is `undefined`.
 * @throws {@link StateError} if a rulebook with that name already exists.
 */
export function rulebook<In, Out>(
  name: string,
  options: { readonly kind: "decide" },
): DecideRulebook<In, Out | undefined>;
/**
 * Creates a rulebook where each rule transforms a value in turn.
 * @throws {@link StateError} if a rulebook with that name already exists.
 */
export function rulebook<V, In = undefined>(
  name: string,
  options: { readonly kind: "fold" },
): FoldRulebook<V, In>;
export function rulebook(
  name: string,
  options: { readonly kind: "decide" | "fold"; readonly otherwise?: (input: unknown) => unknown },
): DecideRulebook<unknown, unknown> | FoldRulebook<unknown, unknown> {
  if (options.kind === "fold") return foldRulebook(name);
  return decideRulebook(name, options.otherwise);
}

function decideRulebook(
  name: string,
  otherwise: ((input: unknown) => unknown) | undefined,
): DecideRulebook<unknown, unknown> {
  const rules = ruleList<(input: unknown) => unknown>(name, "rulebook");
  const explain = (input: unknown): Explanation<unknown> => {
    const steps: RuleStep[] = [];
    for (const entry of rules.ordered()) {
      const result = runRule(rules.where, entry, () => entry.fn(input));
      const decided = result !== undefined;
      steps.push({
        rule: entry.name,
        source: sourceOf(entry),
        outcome: decided ? "decided" : "continued",
      });
      if (decided) return { result, steps, decidedBy: entry.name };
    }
    return { result: otherwise ? otherwise(input) : undefined, steps };
  };
  return Object.freeze({
    kind: "decide" as const,
    name,
    rule: rules.rule,
    replace: rules.replace,
    remove: rules.remove,
    rules: rules.rules,
    run: (input: unknown) => traced("decide", name, explain(input)),
    explain,
  });
}

function foldRulebook(name: string): FoldRulebook<unknown, unknown> {
  const rules = ruleList<FoldRule<unknown, unknown>>(name, "rulebook");
  const stop = (value: unknown): Stopped<unknown> => {
    const marker = Object.freeze({ stopped: value });
    stops.add(marker);
    return marker;
  };
  const isStop = (v: unknown): v is Stopped<unknown> =>
    typeof v === "object" && v !== null && stops.has(v);
  const explain = (value: unknown, input: unknown): Explanation<unknown> => {
    const steps: RuleStep[] = [];
    let current = value;
    for (const entry of rules.ordered()) {
      const next = runRule(rules.where, entry, () => entry.fn(current, input, stop));
      if (isStop(next)) {
        steps.push({ rule: entry.name, source: sourceOf(entry), outcome: "stopped" });
        return { result: next.stopped, steps, decidedBy: entry.name };
      }
      steps.push({
        rule: entry.name,
        source: sourceOf(entry),
        outcome: Object.is(next, current) ? "unchanged" : "changed",
      });
      current = next;
    }
    return { result: current, steps };
  };
  return Object.freeze({
    kind: "fold" as const,
    name,
    rule: rules.rule,
    replace: rules.replace,
    remove: rules.remove,
    rules: rules.rules,
    run: (value: unknown, input: unknown) => traced("fold", name, explain(value, input)),
    explain,
  });
}
