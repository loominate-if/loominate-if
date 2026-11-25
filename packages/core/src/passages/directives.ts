/**
 * What core's passage directives compile to (ADR 0015). Generated passage
 * modules call these; the compiler's core extension names them, so core's
 * directives work exactly as a package's would.
 */
import { describeValue, emit } from "../objects/objects.js";
import { StateError } from "../state/value.js";
import { _previousPassage } from "./story.js";
import type {
  BeatNode,
  ConditionPart,
  ContinueNode,
  EffectContext,
  LinkGuard,
  LogNode,
  NamedEffectNode,
  NoticesNode,
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
 * A continue point, from `{continue -> Target}` or `{continue -> Target, label: "…"}`;
 * or `{continue back}`, to the passage the player was at before this one,
 * as at the end of a cut scene played partway through a conversation.
 */
export function continueTo(args: {
  readonly target?: PassageId;
  readonly back?: "back";
  readonly label?: string;
}): ContinueNode {
  const target = args.back === "back" ? _previousPassage() : args.target;
  if (target === undefined) {
    throw new StateError(
      args.back === "back"
        ? "{continue back}: the player hasn't been anywhere before this passage to go back to."
        : "{continue}: give it a passage, as {continue -> Platform}, or `back`.",
    );
  }
  return {
    type: "continue",
    target,
    ...(args.label !== undefined && { label: args.label }),
  };
}

/** Checks a beat's game minutes: a whole number, 0 or more. */
function gameMinutes(where: string, minutes: number | undefined): { minutes?: number } {
  if (minutes === undefined) return {};
  if (!Number.isInteger(minutes) || minutes < 0) {
    throw new StateError(
      `${where}: minutes ${String(minutes)} isn't a number of game minutes. Give a whole number, 0 or more, as in {beat 2s, minutes: 30}.`,
    );
  }
  return { minutes };
}

/**
 * A timed pause, from `{beat 1.5s}`: what follows appears after `duration`
 * milliseconds. With `minutes`, `{beat 2s, minutes: 30}`, that much game
 * time passes as the player moves past it.
 */
export function beat(args: { readonly duration: number; readonly minutes?: number }): BeatNode {
  return { type: "beat", duration: args.duration, ...gameMinutes("{beat}", args.minutes) };
}

/**
 * A pause until the player moves on, from `{wait}`, or `{wait minutes: 60}`
 * for game time to pass as they do.
 */
export function wait(args: { readonly minutes?: number } = {}): BeatNode {
  return { type: "beat", ...gameMinutes("{wait}", args.minutes) };
}

/**
 * A page break, from `{page}`: a pause until the player moves on, after which
 * what follows replaces what came before on screen. `{page minutes: 600}`
 * passes game time too, as between chapters.
 */
export function pageBreak(args: { readonly minutes?: number } = {}): BeatNode {
  return { type: "beat", page: true, ...gameMinutes("{page}", args.minutes) };
}

/**
 * Where the move's notices go, from `{notices}`. It takes no arguments; the
 * parameter is the empty object every directive call passes.
 */
export function notices(args: Readonly<Record<string, never>> = {}): NoticesNode {
  return { ...args, type: "notices" };
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

/** `{log only}`: the next paragraph is only in the story log, as connective text. */
export function logOnly(args: Readonly<Record<string, never>> = {}): LogNode {
  void args; // `{log only}` takes no arguments; directives pass them as an object.
  return { type: "log", only: "log" };
}

/** `{page only}`: the next paragraph is only on the page, as an instruction to the player. */
export function pageOnly(args: Readonly<Record<string, never>> = {}): LogNode {
  void args; // `{page only}` takes no arguments; directives pass them as an object.
  return { type: "log", only: "page" };
}

/** `{in log: "…"}`: the story log's own wording of the paragraph before. */
export function inLog(args: { readonly log: string }): LogNode {
  return { type: "log", text: args.log };
}

/**
 * What `{chapter "The House on the Hill"}` calls when the player reaches it:
 * records the start of a chapter, which the story log shows as a heading
 * and exports divide at.
 */
export function markChapter(args: { readonly title: string }, context: EffectContext): void {
  context.emit("chapter", { title: args.title });
}

/**
 * Starts a chapter of the story log, from code during a move, as
 * `{chapter "…"}` does in a passage.
 *
 * @example
 * ```ts
 * chapter("The House on the Hill");
 * ```
 */
export function chapter(title: string): void {
  emit("chapter", { title });
}
