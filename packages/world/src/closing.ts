/**
 * Closing time (#316, ADR 0059): what happens to the player inside a place
 * when its opening hours end. Nothing does unless a game says so, since the
 * player may have something to finish there; `closingTime` lists what
 * happens, step by step: the baker glares after five minutes, and shows
 * the customer out after twenty.
 *
 * It's built from a daemon at the door's closing time and a fuse for each
 * step, so the inspector lists them, and undo, saves, and replays see them.
 */
import { object, redirect, StateError, type ObjectRef, type Text } from "@loominate-if/core";
import { currentPlayerBody } from "./actors.js";
import { clock, isJumping } from "./clock.js";
import { hoursOf, openAt } from "./hours.js";
import { arrivalPassage } from "./rooms.js";
import { daemon, fuse, minutes, moves, type Delay } from "./schedule.js";
import { move, placeOf } from "./things.js";

const SOURCE = "@loominate-if/world";

/** One step of what happens at closing time, for {@link closingTime}. */
export type ClosingStep = {
  /** How long after closing it happens, as `minutes(5)`. */
  readonly after: Delay;
  /** What the player is told: "The baker glares at you over the counter." */
  readonly say?: string | Text;
  /** A place to move the player to, such as the street: the story goes to its room's passage. */
  readonly moveTo?: ObjectRef;
  /** Anything else to do, which may return more to say. */
  readonly do?: () => string | Text | undefined;
  /**
   * While this holds, the step waits, such as while the player is paying:
   * it's checked again each minute and each move, and happens once it's
   * clear, if the player is still inside.
   */
  readonly unless?: () => boolean;
};

const words = (said: string | Text | undefined): string =>
  said === undefined ? "" : typeof said === "function" ? said() : said;

/**
 * Says what happens to the player if they're inside the place `door`'s
 * opening hours are `of` when it closes. Each step happens only if they're
 * still inside, and stands out; one that does anything interrupts a jump of
 * the clock, such as a nap in the bakery. Call it in `story.ts`, after the
 * door, which must have `openingHours`. Without it, nothing happens at
 * closing time, and the player is free to leave.
 *
 * @example
 * ```ts
 * closingTime(bakeryDoor, [
 *   { after: minutes(5), say: "The baker glares at you over the counter." },
 *   { after: minutes(20), say: "The baker shows you out.", moveTo: street, unless: () => till.isPaying },
 * ]);
 * ```
 *
 * @throws StateError if a step isn't timed in minutes, or the door is given twice.
 */
export function closingTime(door: ObjectRef, steps: readonly ClosingStep[]): void {
  const base = `closing:${door.id}`;
  for (const [i, step] of steps.entries()) {
    if (!("minutes" in step.after)) {
      throw new StateError(
        `closingTime ${JSON.stringify(door.id)}: step ${String(i + 1)} must be timed in minutes after closing, as minutes(5).`,
      );
    }
  }
  const hours = () => {
    const h = hoursOf(door);
    if (!h) {
      throw new StateError(
        `closingTime ${JSON.stringify(door.id)}: it has no opening hours. Give it ...openingHours({ of, open, close }).`,
      );
    }
    return h;
  };
  /** Which steps are waiting for their `unless` to clear, by index. */
  const record = object(`world:${base}`, { waiting: [] as number[] });
  const inside = (): boolean => {
    const body = currentPlayerBody();
    return body !== undefined && placeOf(body)?.id === hours().of.id;
  };

  const run = (i: number): string => {
    const step = steps[i];
    if (!step) return "";
    const said = [words(step.say), words(step.do?.())];
    if (step.moveTo) {
      const body = currentPlayerBody();
      const target = arrivalPassage(step.moveTo);
      if (target === undefined) {
        throw new StateError(
          `closingTime ${JSON.stringify(door.id)}: step ${String(i + 1)} moves the player to ${JSON.stringify(step.moveTo.id)}, which no passage describes. Tag one [room: …] for it.`,
        );
      }
      if (body) move(body, step.moveTo);
      redirect(target);
    }
    if (isJumping()) clock.interrupt();
    return said.filter((s) => s !== "").join(" ");
  };

  /** Tries step `i`: it happens, or waits, or is dropped if the player has left. */
  const attempt = (i: number): string => {
    const waiting = record.waiting.filter((w) => w !== i);
    if (!inside()) {
      record.waiting = waiting;
      return "";
    }
    if (steps[i]?.unless?.() === true) {
      if (!record.waiting.includes(i)) record.waiting = [...waiting, i];
      waitEachMinute.start();
      waitEachMove.start();
      return "";
    }
    record.waiting = waiting;
    return run(i);
  };

  const retry = (): string | undefined => {
    const said = [...record.waiting]
      .sort((a, b) => a - b)
      .map(attempt)
      .filter((s) => s !== "");
    if (record.waiting.length === 0) {
      waitEachMinute.stop();
      waitEachMove.stop();
    }
    return said.length === 0 ? undefined : said.join(" ");
  };
  const waitEachMinute = daemon(
    `${base}:waiting`,
    { every: minutes(1), standsOut: true, source: SOURCE },
    retry,
  );
  const waitEachMove = daemon(
    `${base}:waiting-moves`,
    { every: moves(1), standsOut: true, source: SOURCE },
    retry,
  );

  const stepFuses = steps.map((step, i) =>
    fuse(`${base}:${String(i + 1)}`, { after: step.after, standsOut: true, source: SOURCE }, () => {
      const said = attempt(i);
      return said === "" ? undefined : said;
    }),
  );

  daemon(base, { at: () => hours().close, running: true, source: SOURCE }, () => {
    // It closes now if it was open a minute ago; the daemon fires at that time every day.
    if (!openAt(hours(), clock.minutes - 1) || !inside()) return undefined;
    record.waiting = [];
    for (const f of stepFuses) f.start();
    return undefined;
  });
}
