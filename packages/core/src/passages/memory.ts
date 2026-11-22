/**
 * Visit memory (#200): whose visits a passage's `visits` and `firstVisit`
 * count.
 *
 * Core counts every real visit itself. Remembering where you've been is a
 * memory, though, and memories belong to minds, which core doesn't know. A
 * package that does, such as the world model, registers a visit memory, and
 * passages ask it. Without one, memory is the real count.
 */
import type { PassageId } from "./story.js";

/** Where a story remembers visits, as {@link useVisitMemory} takes it. */
export interface VisitMemory {
  /**
   * How many visits to `passage` are remembered, or `undefined` to use the
   * real count, such as when nobody is the player yet.
   */
  count(passage: PassageId): number | undefined;
  /** Remembers one more visit to `passage`. It runs during the move, so it may change state. */
  record(passage: PassageId): void;
}

let memory: VisitMemory | undefined;

/**
 * Sets where stories remember visits, or with `undefined`, goes back to the
 * real count. The world model calls it, so visits follow the player's mind.
 *
 * @example
 * ```ts
 * useVisitMemory({
 *   count: (passage) => currentMind().visits[passage] ?? 0,
 *   record: (passage) => { … },
 * });
 * ```
 */
export function useVisitMemory(visitMemory: VisitMemory | undefined): void {
  memory = visitMemory;
}

/** The visit memory in use, if any. @internal */
export function visitMemory(): VisitMemory | undefined {
  return memory;
}
