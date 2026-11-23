/**
 * The action pipeline (#76, ADR 0044): every action, whether from a link, a
 * menu, an NPC, or a parser to come, runs through four stages.
 *
 * 1. **Verify:** is it sensible here? If not, it isn't offered at all.
 * 2. **Check:** is it allowed now? If not, it's shown disabled, with why.
 * 3. **Action:** perform it, including its time cost.
 * 4. **Report:** say what happened, into the event record.
 *
 * Each stage is a rulebook, seeded with the action's own definition, so
 * authors and packages add, replace, and remove rules for one action, or
 * for every action through {@link everyAction}.
 */
import { emit, handleFor, type ObjectRef } from "../objects/objects.js";
import type { LinkGuard } from "../passages/story.js";
import { hook } from "../rules/hooks.js";
import {
  ruleList,
  rulebook,
  runRule,
  traced,
  type DecideRulebook,
  type Explanation,
  type FoldRulebook,
  type RuleList,
  type RuleStep,
} from "../rules/rules.js";
import { StateError } from "../state/value.js";

/** What an action's rules see: its things, by name, and who's acting. */
export type ActionContext<A> = A & {
  /** The action's name. */
  readonly action: string;
  /** The acting mind, if a world model says who it is. */
  readonly actor?: ObjectRef;
  /** The acting body, if a world model says what it is. */
  readonly body?: ObjectRef;
};

/** A stage whose rules all run, in order: the action stage. */
export interface ActionStage<P> extends RuleList<(context: P) => void> {
  /** Runs every rule in order. */
  run(context: P): void;
  /** Runs every rule, recording each. */
  explain(context: P): Explanation<undefined>;
}

/** How an action is defined: what each stage does, for this action. */
export type ActionDefinition<A> = {
  /** What the player sees, such as "Open the cellar door": text, or a function of the action's things. */
  readonly label?: string | ((context: ActionContext<A>) => string);
  /** Why it makes no sense here, or `undefined` if it does. If it doesn't, it isn't offered. */
  readonly verify?: (context: ActionContext<A>) => string | undefined;
  /** Why it isn't allowed now, or `undefined` if it is. If not, it's shown disabled, with this reason. */
  readonly check?: (context: ActionContext<A>) => string | undefined;
  /** What it does. */
  readonly run?: (context: ActionContext<A>) => void;
  /** What happened, recorded as an `action-result` event the page shows. */
  readonly report?: string | ((context: ActionContext<A>) => string);
  /** How many minutes it takes, for a game clock. Defaults to 0. */
  readonly minutes?: number | ((context: ActionContext<A>) => number);
  /**
   * The thing, or things, whose menu offers it, with the thing as its
   * `thing`, as in `on: radio`.
   */
  readonly on?: ObjectRef | readonly ObjectRef[];
  /**
   * Which things' menus offer it, with the thing as its `thing`: every
   * thing this says yes to, as in `for: (thing) => "isOpen" in thing`.
   */
  readonly for?: (thing: ObjectRef) => boolean;
  /**
   * Its other things, by role, for menus to fill in: a fixed thing, as in
   * `with: { tool: crowbar }`, or a test for things that suit, as in
   * `with: { tool: (t) => isLever(t) }`, which menus try on the things
   * {@link useCandidates} gives. A menu offers one entry per way to fill
   * them, on each participant's menu.
   */
  readonly with?: { readonly [K in Exclude<keyof A, "thing">]?: Participant };
};

/** How a menu fills one of an action's other roles: a fixed thing, or a test for things that suit. */
export type Participant = ObjectRef | ((thing: ObjectRef) => boolean);

/** One action taken, with its things: what a link or menu offers, and what's performed. */
export type ActionCall<A = Readonly<Record<string, unknown>>> = {
  /** The action. */
  readonly action: Action<A>;
  /** Its things, by name. */
  readonly args: A;
};

/**
 * An action. Call it with its things to make an {@link ActionCall}, which a
 * link offers with `{act …}` or code performs with {@link perform}.
 */
export type Action<A> = ((args: A) => ActionCall<A>) & {
  /** The action's name, unique in the game. */
  readonly actionName: string;
  /** Is it sensible here? The first rule to give a reason hides it. */
  readonly verify: DecideRulebook<ActionContext<A>, string | undefined>;
  /** Is it allowed now? The first rule to give a reason disables it. */
  readonly check: DecideRulebook<ActionContext<A>, string | undefined>;
  /** What it does: every rule runs. */
  readonly perform: ActionStage<ActionContext<A>>;
  /** What happened: the first rule to give text is recorded. */
  readonly report: DecideRulebook<ActionContext<A>, string | undefined>;
  /** How many minutes it takes: each rule passes on the count. */
  readonly minutes: FoldRulebook<number, ActionContext<A>>;
  /** What the player sees for it. */
  label(args: A): string;
  /** Whether a menu for `thing` offers it: it's `on` the thing, or `for` it. */
  offeredFor(thing: ObjectRef): boolean;
};

/**
 * Rules for every action, run before each action's own: whether things must
 * be in reach, say, or that nothing can be done while asleep.
 */
export const everyAction: {
  readonly verify: DecideRulebook<
    ActionContext<Readonly<Record<string, unknown>>>,
    string | undefined
  >;
  readonly check: DecideRulebook<
    ActionContext<Readonly<Record<string, unknown>>>,
    string | undefined
  >;
} = Object.freeze({
  verify: rulebook<ActionContext<Readonly<Record<string, unknown>>>, string>(
    "every action: verify",
    {
      kind: "decide",
    },
  ),
  check: rulebook<ActionContext<Readonly<Record<string, unknown>>>, string>("every action: check", {
    kind: "decide",
  }),
});

/** Every action, by name, so a logged move can be replayed. */
const actions = new Map<string, Action<never>>();
/** Each action's other roles, by action name, for menus to fill. */
const roles = new Map<string, readonly (readonly [string, Participant])[]>();
/** The things each action is `on`, by action name. */
const ons = new Map<string, readonly ObjectRef[]>();
/** Names an action's things can't have, since its rules see these too. */
const RESERVED = new Set(["action", "actor", "body"]);

/** Who's acting, as a world model says: the player's mind and body. */
let acting:
  (() => { readonly actor?: ObjectRef; readonly body?: ObjectRef } | undefined) | undefined;

/**
 * Sets who acts when an action doesn't say: the world model calls it, so
 * actions record the player's mind and body.
 */
export function useActor(
  who: (() => { readonly actor?: ObjectRef; readonly body?: ObjectRef } | undefined) | undefined,
): void {
  acting = who;
}

/** The things a menu tries in an action's other roles, as a world model says. */
let candidates: (() => readonly ObjectRef[]) | undefined;

/**
 * Sets the things menus try in actions' other roles, where `with` gives a
 * test: the world model gives the things in the player's reach. Without
 * it, menus fill only roles `with` gives a fixed thing.
 */
export function useCandidates(things: (() => readonly ObjectRef[]) | undefined): void {
  candidates = things;
}

/** A stage whose rules all run, named for the inspector. */
function stage<P>(name: string): ActionStage<P> {
  const rules = ruleList<(context: P) => void>(name, "action stage");
  const explain = (context: P): Explanation<undefined> => {
    const steps: RuleStep[] = [];
    for (const entry of rules.ordered()) {
      runRule(rules.where, entry, () => {
        entry.fn(context);
      });
      steps.push({ rule: entry.name, source: entry.replacedBy ?? entry.source, outcome: "ran" });
    }
    return { result: undefined, steps };
  };
  return Object.freeze({
    name,
    rule: rules.rule,
    replace: rules.replace,
    remove: rules.remove,
    rules: rules.rules,
    run: (context: P) => {
      traced("hook", name, explain(context));
    },
    explain,
  });
}

/**
 * Defines an action. Its definition's functions become the first rule of
 * each stage, named for the action, so rules can go before or after them.
 *
 * @example
 * ```ts
 * export const open = action<{ thing: Thing & Openable }>("open", {
 *   label: ({ thing }) => t`Open {the thing}`({ thing }),
 *   verify: ({ thing }) => ("isOpen" in thing ? undefined : "That doesn't open."),
 *   check: ({ thing }) => (thing.isLocked ? "It's locked." : undefined),
 *   run: ({ thing }) => thing.open(),
 *   report: "Opened.",
 * });
 * // a passage: [[Open the door]]{act open({ thing: cellarDoor })}
 * ```
 *
 * @throws StateError if another action has the name.
 */
export function action<A extends Readonly<Record<string, unknown>>>(
  name: string,
  definition: ActionDefinition<A> = {},
): Action<A> {
  if (actions.has(name)) {
    throw new StateError(
      `action ${JSON.stringify(name)}: another action has this name, perhaps one a package such as the world model defines. Give yours another name, or change that one with its rules, as in ${name}.check.rule(…).`,
    );
  }
  type C = ActionContext<A>;
  const own = `${name}: own`;
  const verify = rulebook<C, string>(`${name}: verify`, { kind: "decide" });
  const check = rulebook<C, string>(`${name}: check`, { kind: "decide" });
  const perform = stage<C>(`${name}: action`);
  const report = rulebook<C, string>(`${name}: report`, { kind: "decide" });
  const minutes = rulebook<number, C>(`${name}: minutes`, { kind: "fold" });
  const d = definition;
  const others = Object.entries(
    (d.with ?? {}) as Readonly<Record<string, Participant | undefined>>,
  ).filter((e): e is [string, Participant] => e[1] !== undefined);
  for (const [role] of others) {
    if (role === "thing" || RESERVED.has(role)) {
      throw new StateError(
        `action ${JSON.stringify(name)}: \`with\` can't fill "${role}". It names the action's other things; "thing" is the one whose menu offers it, and "actor" and "body" are who's acting.`,
      );
    }
  }
  if (d.verify) verify.rule(own, d.verify);
  if (d.check) check.rule(own, d.check);
  if (d.run) perform.rule(own, d.run);
  if (d.report !== undefined) {
    const r = d.report;
    report.rule(own, (c) => (typeof r === "string" ? r : r(c)));
  }
  if (d.minutes !== undefined) {
    const m = d.minutes;
    minutes.rule(own, (value, c) => value + (typeof m === "number" ? m : m(c)));
  }
  const call = (args: A): ActionCall<A> => {
    for (const key of Object.keys(args)) {
      if (RESERVED.has(key)) {
        throw new StateError(
          `action ${JSON.stringify(name)}: a thing can't be called "${key}", which every action's rules use.`,
        );
      }
    }
    return Object.freeze({ action: made, args });
  };
  const made = Object.assign(call, {
    actionName: name,
    verify,
    check,
    perform,
    report,
    minutes,
    offeredFor: (thing: ObjectRef): boolean =>
      (ons.get(name) ?? []).some((t) => t.id === thing.id) || (d.for?.(thing) ?? false),
    label: (args: A): string => {
      const l = d.label;
      return l === undefined
        ? name
        : typeof l === "string"
          ? l
          : l(contextFor({ action: made, args }));
    },
  }) as Action<A>;
  actions.set(name, made as unknown as Action<never>);
  roles.set(name, others);
  const on = d.on;
  ons.set(name, on === undefined ? [] : Array.isArray(on) ? on : [on as ObjectRef]);
  return made;
}

/** The context an action's rules see, with who's acting. */
function contextFor<A>(call: ActionCall<A>): ActionContext<A> {
  const who = acting?.();
  return Object.freeze({
    ...call.args,
    action: call.action.actionName,
    ...(who?.actor !== undefined && { actor: who.actor }),
    ...(who?.body !== undefined && { body: who.body }),
  }) as ActionContext<A>;
}

/** Whether `thing` can fill a role. */
const fits = (p: Participant, thing: ObjectRef): boolean =>
  typeof p === "function" ? p(thing) : p.id === thing.id;

/**
 * The actions a menu for `thing` offers, in the order they were defined:
 * those `on` it or `for` things like it, with it as their `thing`, and
 * those whose `with` it fits, in that role. Their other roles are filled
 * every way they can be, from fixed things and {@link useCandidates}'s,
 * never with a thing twice. Whether each is shown, and allowed, is up to
 * {@link statusOf}.
 */
export function actionsFor(thing: ObjectRef): ActionCall[] {
  // The object itself, so a `for` rule can read its properties, given only its ID.
  thing = handleFor(thing.id, "actionsFor") as ObjectRef;
  let pool: readonly ObjectRef[] | undefined;
  const things = (): readonly ObjectRef[] =>
    (pool ??= (candidates?.() ?? []).map((t) => handleFor(t.id, "actionsFor") as ObjectRef));
  const out: ActionCall[] = [];
  for (const a of actions.values()) {
    const offered = a as unknown as Action<Readonly<Record<string, ObjectRef>>>;
    const others = roles.get(a.actionName) ?? [];
    const seen = new Set<string>();
    /** Fills the roles left, every way they can be, and offers each. */
    const fill = (args: Readonly<Record<string, ObjectRef>>, left: typeof others): void => {
      const [next, ...rest] = left;
      if (!next) {
        const key = Object.keys(args)
          .sort()
          .map((k) => `${k}=${args[k]?.id ?? ""}`)
          .join(",");
        if (!seen.has(key)) {
          seen.add(key);
          out.push(offered(args) as unknown as ActionCall);
        }
        return;
      }
      const [role, p] = next;
      const used = new Set(Object.values(args).map((t) => t.id));
      const options =
        typeof p === "function"
          ? things().filter((t) => p(t))
          : [handleFor(p.id, `action ${JSON.stringify(a.actionName)}`) as ObjectRef];
      for (const t of options) if (!used.has(t.id)) fill({ ...args, [role]: t }, rest);
    };
    // As its main thing.
    if (offered.offeredFor(thing)) fill({ thing }, others);
    // As one of its other things, with every thing it's offered on as the main one.
    for (const [role, p] of others) {
      if (!fits(p, thing)) continue;
      const on = (ons.get(a.actionName) ?? []).map(
        (t) => handleFor(t.id, `action ${JSON.stringify(a.actionName)}`) as ObjectRef,
      );
      const mains = [...on, ...things()].filter(
        (t, i, all) =>
          t.id !== thing.id && all.findIndex((u) => u.id === t.id) === i && offered.offeredFor(t),
      );
      for (const main of mains) {
        fill(
          { thing: main, [role]: thing },
          others.filter(([r]) => r !== role),
        );
      }
    }
  }
  return out;
}

/**
 * What `{menu …}` after a link calls, with the thing as `thing`: an open
 * guard marking the link as the thing's menu, so the page opens the menu
 * instead of following it.
 */
export function menuLink(args: { readonly thing: ObjectRef }): LinkGuard {
  return { open: true, condition: `menu for ${args.thing.id}`, menu: args.thing.id };
}

/** Whether an action is offered, and allowed, and why not. */
export type ActionStatus = {
  /** Its label. */
  readonly label: string;
  /** Why verify hid it, if it did: it isn't offered. */
  readonly hidden?: string;
  /** Why check disabled it, if it did: it's offered, but can't be taken. */
  readonly disabled?: string;
};

/** Runs verify and check, without changing anything, for a link or menu. */
export function statusOf<A>(call: ActionCall<A>): ActionStatus {
  const c = contextFor(call) as ActionContext<Readonly<Record<string, unknown>>>;
  const a = call.action as unknown as Action<Readonly<Record<string, unknown>>>;
  const label = a.label(call.args as Readonly<Record<string, unknown>>);
  const hidden = everyAction.verify.run(c) ?? a.verify.run(c);
  if (hidden !== undefined) return { label, hidden };
  const disabled = everyAction.check.run(c) ?? a.check.run(c);
  return disabled === undefined ? { label } : { label, disabled };
}

/** What {@link perform} did. */
export type ActionOutcome = {
  /** Whether the action was carried out. */
  readonly done: boolean;
  /** Why not, from verify or check, if it wasn't. */
  readonly reason?: string;
};

/**
 * Performs an action, through every stage: verify and check, and if both
 * pass, its action stage, its time, and its report, recorded as an
 * `action-result` event. A failed verify or check records its reason
 * instead. Call it in an effect; a link with `{act …}` calls it for you.
 *
 * @example
 * ```ts
 * {on enter: perform(open({ thing: cellarDoor }))}
 * ```
 */
export function perform<A>(call: ActionCall<A>): ActionOutcome {
  const c = contextFor(call) as ActionContext<Readonly<Record<string, unknown>>>;
  const a = call.action as unknown as Action<Readonly<Record<string, unknown>>>;
  const refused =
    everyAction.verify.run(c) ?? a.verify.run(c) ?? everyAction.check.run(c) ?? a.check.run(c);
  if (refused !== undefined) {
    emit("action-result", { text: refused });
    return { done: false, reason: refused };
  }
  a.perform.run(c);
  const spent = a.minutes.run(0, c);
  if (spent !== 0) hook("actionTime").run({ action: a.actionName, minutes: spent });
  const said = a.report.run(c);
  if (said !== undefined && said !== "") emit("action-result", { text: said });
  return { done: true };
}

/** An action call as the action log records it: its name, and its things as plain data, objects as `{ $ref: id }`. */
export type LoggedCall = {
  readonly action: string;
  readonly args: Readonly<Record<string, string | number | boolean | { readonly $ref: string }>>;
};

/** An action call as plain data, for the action log. @internal */
export function logCall<A>(call: ActionCall<A>): LoggedCall {
  const args: Record<string, string | number | boolean | { readonly $ref: string }> = {};
  for (const [key, value] of Object.entries(call.args as Readonly<Record<string, unknown>>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      args[key] = value;
    } else if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as ObjectRef).id === "string"
    ) {
      args[key] = { $ref: (value as ObjectRef).id };
    } else {
      throw new StateError(
        `action ${JSON.stringify(call.action.actionName)}: its thing "${key}" is ${typeof value}, which a replay can't record. Give it objects, strings, numbers, or booleans.`,
      );
    }
  }
  return { action: call.action.actionName, args };
}

/** The action call a logged one stands for, with its objects' handles. @internal */
export function callOf(logged: LoggedCall): ActionCall {
  const a = actions.get(logged.action);
  if (!a) {
    throw new StateError(
      `there's no action ${JSON.stringify(logged.action)}; the game must have changed since this was logged.`,
    );
  }
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(logged.args)) {
    args[key] =
      typeof value === "object"
        ? handleFor(value.$ref, `action ${JSON.stringify(logged.action)}`)
        : value;
  }
  return { action: a as unknown as Action<Readonly<Record<string, unknown>>>, args };
}

/**
 * What `{act …}` after a link calls, with the action call as `call`: the
 * link's guard, from verify and check, carrying the action, so following the link performs it and stays
 * on the passage.
 */
export function actLink<A>(args: { readonly call: ActionCall<A> }): LinkGuard {
  const { call } = args;
  const status = statusOf(call);
  const name = call.action.actionName;
  const act = logCall(call);
  if (status.hidden !== undefined) {
    return { open: false, condition: `${name}: ${status.hidden}`, mode: "hidden", act };
  }
  if (status.disabled !== undefined) {
    return {
      open: false,
      condition: `${name}: ${status.disabled}`,
      mode: "disabled-with-reason",
      reason: status.disabled,
      act,
    };
  }
  return { open: true, condition: name, act };
}
