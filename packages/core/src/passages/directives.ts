/**
 * What core's passage directives compile to (ADR 0015). Generated passage
 * modules call these; the compiler's core extension names them, so core's
 * directives work exactly as a package's would.
 */
import { describeValue } from "../objects/objects.js";
import { StateError } from "../state/value.js";
import type {
  BeatNode,
  ConditionPart,
  ContinueNode,
  EffectContext,
  LinkGuard,
  NamedEffectNode,
  PassageId,
} from "./story.js";

/** The kinds of event `{emit …}` records: those that are only text. */
export type TextEventKind = "system" | "narrative" | "scene" | "dialogue" | "action-result";

/**
 * Records an event when the player reaches it, from `{emit "The lamp is lit.", tags: lamp}`
 * or `{emit "…", kind: scene, tags: ship storm}`. The kind is `system` unless
 * one is given. The event also carries the passage's own tags, before `tags`.
 */
export function emitEvent(
  args: {
    readonly text: string;
    readonly kind?: TextEventKind;
    readonly tags?: readonly string[];
  },
  context: EffectContext,
): void {
  context.emit(args.kind ?? "system", { text: args.text }, args.tags ?? []);
}

/**
 * A continue point, from `{continue -> Target}` or `{continue -> Target, label: "…"}`.
 */
export function continueTo(args: {
  readonly target: PassageId;
  readonly label?: string;
}): ContinueNode {
  return {
    type: "continue",
    target: args.target,
    ...(args.label !== undefined && { label: args.label }),
  };
}

/** A timed pause, from `{beat 1.5s}`: what follows appears after `duration` milliseconds. */
export function beat(args: { readonly duration: number }): BeatNode {
  return { type: "beat", duration: args.duration };
}

/**
 * A pause until the player moves on, from `{wait}`. It takes no arguments;
 * the parameter is the empty object every directive call passes.
 */
export function wait(args: Readonly<Record<string, never>> = {}): BeatNode {
  return { ...args, type: "beat" };
}

/**
 * A page break, from `{page}`: a pause until the player moves on, after which
 * what follows replaces what came before on screen.
 */
export function pageBreak(args: Readonly<Record<string, never>> = {}): BeatNode {
  return { ...args, type: "beat", page: true };
}

/**
 * A named presentation effect, from `{effect fade}`,
 * `{effect typewriter, duration: 2s}`, or `{effect glow, options: { color: "gold" }}`.
 *
 * @throws {@link StateError} unless the name is one word.
 */
export function namedEffect(args: {
  readonly name: readonly string[];
  readonly duration?: number;
  readonly options?: Readonly<Record<string, unknown>>;
}): NamedEffectNode {
  const [name, ...rest] = args.name;
  if (name === undefined || rest.length > 0) {
    throw new StateError(
      `{effect ${args.name.join(" ")}}: an effect's name is one word, such as {effect fade}.`,
    );
  }
  return {
    type: "effect",
    name,
    ...(args.duration !== undefined && { duration: args.duration }),
    ...(args.options !== undefined && { options: args.options }),
  };
}

/**
 * A condition argument, as the compiler passes it: its value, its source, and
 * a way to evaluate each of its parts, for explaining why it doesn't hold.
 */
export type ConditionArgument = {
  readonly value: boolean;
  readonly text: string;
  /** Each part's source and its value, or what it threw. */
  readonly parts?: () => readonly {
    readonly text: string;
    readonly value?: unknown;
    readonly error?: string;
  }[];
};

/** A condition's parts, evaluated and written for the inspector; none if they can't be. */
function explain(condition: ConditionArgument): readonly ConditionPart[] | undefined {
  if (!condition.parts) return undefined;
  try {
    return condition
      .parts()
      .map((p) =>
        p.error !== undefined
          ? { text: p.text, error: p.error }
          : { text: p.text, value: describeValue(p.value) },
      );
  } catch {
    return undefined;
  }
}

/**
 * A link guard, from `{when cond}`, `{when cond, hidden}`, `{when cond, disabled}`,
 * or `{when cond, reason: "…"}`. A reason shows the link disabled with it.
 * While the guard is closed, it carries the condition's parts and their values.
 */
export function linkGuard(args: {
  readonly condition: ConditionArgument;
  readonly mode?: "hidden" | "disabled";
  readonly reason?: string;
}): LinkGuard {
  const { condition, mode, reason } = args;
  const parts = condition.value ? undefined : explain(condition);
  return {
    open: condition.value,
    condition: condition.text,
    ...(parts !== undefined && parts.length > 0 && { parts }),
    ...(reason !== undefined
      ? { mode: "disabled-with-reason", reason }
      : mode !== undefined && { mode }),
  };
}
