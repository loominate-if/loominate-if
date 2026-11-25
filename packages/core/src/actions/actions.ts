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
import { parseVerbPhrase, type VerbPhrase } from "./verbs.js";
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
import { NameTaken, StateError } from "../state/value.js";
import { message, messages } from "../text/messages.js";

declare module "../text/messages.js" {
  interface Messages {
    /** Why an action offered only during a period isn't, for the inspector: "Only during the storm." */
    "action.notDuring": { readonly during: string };
    /** The button that takes an action once the numbers it asks for are given: "OK". */
    "menu.ask.confirm": Record<never, never>;
  }
}

messages.register("action.notDuring", ({ during }) => `Only during ${during}.`, {
  source: "@loominate-if/core",
});
messages.register("menu.ask.confirm", "OK", { source: "@loominate-if/core" });

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
  /**
   * The package that defines it, for its own rules and the inspector, as
   * in `source: "@my-scope/doors"`. Defaults to the game.
   */
  readonly source?: string;
  /**
   * While its `minutes` pass, what may stop them partway, given the ID of
   * what asks to, such as a fuse: `(by) => by === "bomb"` for a ride only
   * an emergency stops, or `() => false` for one nothing does. Defaults to
   * anything. A clock, such as the world model's, honours it.
   */
  readonly stopsFor?: (by: string) => boolean;
  /**
   * A period of the story it's offered only during, such as the world
   * model's scenes: `during: storm`. While it isn't happening, the action
   * isn't offered.
   */
  readonly during?: Period;
  /**
   * The numbers it asks the player for before it's taken, by argument
   * name, such as how many to take. A menu shows a field for each; its
   * other rules see the number given.
   *
   * @example
   * ```ts
   * asks: { count: { label: "How many?", min: 1, max: ({ thing }) => countOf(thing) } }
   * ```
   */
  readonly asks?: { readonly [K in keyof A]?: Ask<A> };
  /**
   * What a player might type for it, for a parser to come: words, a slot
   * for each of its things by role, and optional words in parentheses, as
   * `["unlock {thing} with {tool}", "pick (up) {thing}"]`. The compiler
   * checks each slot names one of its roles, and the phrase is read as the
   * game loads.
   */
  readonly verbs?: readonly string[];
  /**
   * What onlookers see when someone other than the player takes it, as
   * "The butler takes the iron key.": text, or a function of its things and
   * who's acting. A world model tells whoever can see them (#106).
   */
  readonly seen?: string | ((context: ActionContext<A>) => string);
  /** The button that takes it once its numbers are given, as "Take". Defaults to the `menu.ask.confirm` message. */
  readonly confirm?: string | ((context: ActionContext<A>) => string);
};

/** A number an action asks for: what to call it, and its limits, as text or worked out from the action's things. */
export type Ask<A> = {
  /** What the field is called, as "How many?". */
  readonly label: string | ((context: ActionContext<A>) => string);
  /** The least it can be. Defaults to 1. */
  readonly min?: number | ((context: ActionContext<A>) => number);
  /** The most it can be. Defaults to no limit. */
  readonly max?: number | ((context: ActionContext<A>) => number);
  /** What the field starts at. Defaults to `min`. */
  readonly start?: number | ((context: ActionContext<A>) => number);
};

/** A number an action asks for, as it stands for one call: what {@link statusOf} gives a menu. */
export type AskedNumber = {
  /** The argument it fills. */
  readonly name: string;
  readonly label: string;
  readonly min: number;
  readonly max?: number;
  readonly start: number;
};

/** A period of the story, such as a world model's scene, that an action can be offered only during. */
export type Period = {
  /** Its ID, or a name to say it by. */
  readonly id: string;
  /** Its name, for the inspector: "the storm". Defaults to its ID. */
  readonly name?: string;
  /** Whether it's happening now. */
  readonly isHappening: boolean;
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
  /** What a player might type for it, read into parts. */
  readonly verbs: readonly VerbPhrase[];
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
/** Each action's definition, by name, for what it asks for. */
const definitions = new Map<string, ActionDefinition<never>>();
/** Each action's other roles, by action name, for menus to fill. */
const roles = new Map<string, readonly (readonly [string, Participant])[]>();
/** The things each action is `on`, by action name. */
const ons = new Map<string, readonly ObjectRef[]>();
/** What may stop each action's time partway, by action name, if it says. */
const stops = new Map<string, (by: string) => boolean>();
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

/**
 * The things menus try in actions' other roles, as {@link useCandidates}
 * set them: with the world model, what the player can reach. The inspector
 * lists their actions.
 */
export function actionCandidates(): readonly ObjectRef[] {
  return candidates?.() ?? [];
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
    throw new NameTaken(
      `action ${JSON.stringify(name)}: another action has this name, perhaps one a package such as the world model defines. Give yours another name, or change that one with its rules, as in ${name}.check.rule(…).`,
    );
  }
  // Which roles its slots name is checked by the compiler, which knows them all (#79).
  const verbs = (definition.verbs ?? []).map((text) =>
    parseVerbPhrase(text, `action ${JSON.stringify(name)}: verb phrase`),
  );
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
  const from = d.source === undefined ? {} : { source: d.source };
  const during = d.during;
  if (during) {
    verify.rule(
      `${name}: during`,
      () =>
        during.isHappening
          ? undefined
          : message("action.notDuring", { during: during.name ?? during.id }),
      from,
    );
  }
  if (d.verify) verify.rule(own, d.verify, from);
  if (d.check) check.rule(own, d.check, from);
  if (d.run) perform.rule(own, d.run, from);
  if (d.report !== undefined) {
    const r = d.report;
    report.rule(own, (c) => (typeof r === "string" ? r : r(c)), from);
  }
  if (d.minutes !== undefined) {
    const m = d.minutes;
    minutes.rule(own, (value, c) => value + (typeof m === "number" ? m : m(c)), from);
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
    verbs: Object.freeze(verbs),
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
  definitions.set(name, d as unknown as ActionDefinition<never>);
  roles.set(name, others);
  const on = d.on;
  ons.set(name, on === undefined ? [] : Array.isArray(on) ? on : [on as ObjectRef]);
  if (d.stopsFor) stops.set(name, d.stopsFor);
  return made;
}

/**
 * Every action that's `on` things, with its label as written and its things,
 * in the order defined: what a player can find in things' menus, for
 * coverage reports (#133). @internal
 */
export function _actionsOnThings(): readonly {
  readonly name: string;
  readonly label: string;
  readonly on: readonly ObjectRef[];
}[] {
  return [...ons]
    .filter(([, on]) => on.length > 0)
    .map(([name, on]) => {
      const label = definitions.get(name)?.label;
      return { name, label: typeof label === "string" ? label : name, on };
    });
}

/** The context an action's rules see, with who's acting. */
function contextFor<A>(
  call: ActionCall<A>,
  as?: { readonly actor?: ObjectRef; readonly body?: ObjectRef },
): ActionContext<A> {
  const who = as ?? acting?.();
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

/** The rule that hid or disabled an action, for the inspector. */
export type ActionRule = {
  /** The stage it's in: `verify` hides, `check` disables. */
  readonly stage: "verify" | "check";
  /** Its rulebook, such as "every action: verify" or "open: check". */
  readonly rulebook: string;
  /** Its name, such as "things in reach" or "open: own". */
  readonly rule: string;
  /** The package that added it, or replaced it. */
  readonly source: string;
};

/** Whether an action is offered, and allowed, and why not. */
export type ActionStatus = {
  /** Its label. */
  readonly label: string;
  /** Why verify hid it, if it did: it isn't offered. */
  readonly hidden?: string;
  /** Why check disabled it, if it did: it's offered, but can't be taken. */
  readonly disabled?: string;
  /** The rule that hid or disabled it, if one did. */
  readonly by?: ActionRule;
  /** The numbers it asks for before it's taken, while it can be. */
  readonly asks?: readonly AskedNumber[];
  /** The button that takes it once they're given, when it asks for any. */
  readonly confirm?: string;
};

type Book = DecideRulebook<ActionContext<Readonly<Record<string, unknown>>>, string | undefined>;

/** Runs `books` in turn until one gives a reason: the reason, and the rule that gave it. */
function decide(
  stage: ActionRule["stage"],
  books: readonly Book[],
  c: ActionContext<Readonly<Record<string, unknown>>>,
): { readonly reason: string; readonly by: ActionRule } | undefined {
  for (const book of books) {
    const e = book.explain(c);
    traced("decide", book.name, e);
    if (e.result === undefined) continue;
    const step = e.steps.find((s) => s.rule === e.decidedBy);
    return {
      reason: e.result,
      by: { stage, rulebook: book.name, rule: e.decidedBy ?? "", source: step?.source ?? "" },
    };
  }
  return undefined;
}

/** Runs verify and check, without changing anything, for a link or menu. */
export function statusOf<A>(call: ActionCall<A>): ActionStatus {
  return _statusAs(call);
}

/**
 * Runs verify and check as `as` would take the action, as for an order to an
 * NPC, without changing anything. @internal
 */
export function _statusAs<A>(call: ActionCall<A>, as?: PerformOptions["as"]): ActionStatus {
  const c = contextFor(call, as) as ActionContext<Readonly<Record<string, unknown>>>;
  const a = call.action as unknown as Action<Readonly<Record<string, unknown>>>;
  const label = a.label(call.args as Readonly<Record<string, unknown>>);
  const hidden = decide("verify", [everyAction.verify, a.verify], c);
  if (hidden) return { label, hidden: hidden.reason, by: hidden.by };
  const disabled = decide("check", [everyAction.check, a.check], c);
  if (disabled) return { label, disabled: disabled.reason, by: disabled.by };
  const asks = asked(call);
  if (asks.length === 0) return { label };
  const confirm = definitions.get(call.action.actionName)?.confirm;
  return {
    label,
    asks,
    confirm:
      confirm === undefined
        ? message("menu.ask.confirm", {})
        : typeof confirm === "string"
          ? confirm
          : confirm(c as never),
  };
}

/** The numbers a call's action asks for, worked out for its things. */
function asked<A>(call: ActionCall<A>): readonly AskedNumber[] {
  const asks = definitions.get(call.action.actionName)?.asks;
  if (!asks) return [];
  const c = contextFor(call) as never;
  const value = (v: number | ((context: never) => number) | undefined) =>
    typeof v === "function" ? v(c) : v;
  return Object.entries(asks as Record<string, Ask<never> | undefined>).flatMap(([name, ask]) => {
    if (!ask) return [];
    const min = value(ask.min) ?? 1;
    const max = value(ask.max);
    return [
      Object.freeze({
        name,
        label: typeof ask.label === "function" ? ask.label(c) : ask.label,
        min,
        ...(max !== undefined && { max }),
        start: value(ask.start) ?? min,
      }),
    ];
  });
}

/**
 * Why a call's asked numbers aren't right, or `undefined` if they are:
 * each must be given, a whole number, within its limits. @internal
 */
export function _askedProblem<A>(call: ActionCall<A>): string | undefined {
  for (const ask of asked(call)) {
    const given = (call.args as Readonly<Record<string, unknown>>)[ask.name];
    const range = `from ${String(ask.min)}${ask.max === undefined ? " up" : ` to ${String(ask.max)}`}`;
    if (
      typeof given !== "number" ||
      !Number.isInteger(given) ||
      given < ask.min ||
      (ask.max !== undefined && given > ask.max)
    ) {
      return `action ${JSON.stringify(call.action.actionName)}: ${ask.name} must be a whole number ${range}${given === undefined ? ", and none was given" : `, not ${JSON.stringify(given)}`}.`;
    }
  }
  return undefined;
}

/** What {@link perform} did. */
export type ActionOutcome = {
  /** Whether the action was carried out. */
  readonly done: boolean;
  /** Why not, from verify or check, if it wasn't. */
  readonly reason?: string;
  /** For an action taken by someone other than the player, what onlookers see, if its definition says. */
  readonly seen?: string;
};

/** Options for {@link perform}. */
export type PerformOptions = {
  /**
   * Who takes it, when it isn't the player: a mind and the body it acts
   * through, as a world model's NPCs do. Every rule applies to them as to
   * the player. What they do isn't reported to the player, and their time
   * isn't the game's: the outcome says what onlookers see, for a world
   * model to tell whoever can see it.
   */
  readonly as?: { readonly actor?: ObjectRef; readonly body?: ObjectRef };
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
export function perform<A>(call: ActionCall<A>, options: PerformOptions = {}): ActionOutcome {
  const problem = _askedProblem(call);
  if (problem !== undefined) throw new StateError(problem);
  const c = contextFor(call, options.as) as ActionContext<Readonly<Record<string, unknown>>>;
  const a = call.action as unknown as Action<Readonly<Record<string, unknown>>>;
  const refused =
    everyAction.verify.run(c) ?? a.verify.run(c) ?? everyAction.check.run(c) ?? a.check.run(c);
  if (refused !== undefined) {
    // Someone else's refusal is theirs: the caller hears of it, not the player.
    if (!options.as) emit("action-result", { text: refused });
    return { done: false, reason: refused };
  }
  a.perform.run(c);
  if (options.as) {
    const seen = definitions.get(a.actionName)?.seen;
    const text =
      seen === undefined ? undefined : typeof seen === "string" ? seen : seen(c as never);
    return { done: true, ...(text !== undefined && text !== "" && { seen: text }) };
  }
  const spent = a.minutes.run(0, c);
  if (spent !== 0) {
    const stopsFor = stops.get(a.actionName);
    hook("actionTime").run({ action: a.actionName, minutes: spent, ...(stopsFor && { stopsFor }) });
  }
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
    return {
      open: false,
      condition: `${name}: ${status.hidden}`,
      mode: "hidden",
      act,
      ...(status.by && { by: status.by }),
    };
  }
  if (status.disabled !== undefined) {
    return {
      open: false,
      condition: `${name}: ${status.disabled}`,
      mode: "disabled-with-reason",
      reason: status.disabled,
      act,
      ...(status.by && { by: status.by }),
    };
  }
  return { open: true, condition: name, act };
}
