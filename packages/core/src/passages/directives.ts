/**
 * What core's passage directives compile to (ADR 0015). Generated passage
 * modules call these; the compiler's core extension names them, so core's
 * directives work exactly as a package's would.
 */
import { StateError } from "../state/value.js";
import type { BeatNode, ContinueNode, LinkGuard, NamedEffectNode, PassageId } from "./story.js";

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
 * A link guard, from `{when cond}`, `{when cond, hidden}`, `{when cond, disabled}`,
 * or `{when cond, reason: "…"}`. A reason shows the link disabled with it.
 */
export function linkGuard(args: {
  readonly condition: { readonly value: boolean; readonly text: string };
  readonly mode?: "hidden" | "disabled";
  readonly reason?: string;
}): LinkGuard {
  const { condition, mode, reason } = args;
  return {
    open: condition.value,
    condition: condition.text,
    ...(reason !== undefined
      ? { mode: "disabled-with-reason", reason }
      : mode !== undefined && { mode }),
  };
}
