/**
 * Scope: what a thing can see, reach, and hear (#62, ADR 0031).
 *
 * A sense spreads through the containment tree from the observer until
 * something stops it. A place stops every sense, so nothing is sensed from
 * another place. A closed container stops reach; a closed opaque one stops
 * sight too; nothing but a place stops hearing. Sight also needs light: a
 * place is lit unless it's dark, and a lit light source lights everything in
 * sight of it. In the dark, nothing can be seen.
 */
import { StateError, type ObjectRef, type StateId } from "@loominate-if/core";
import { byId, contents, features, isPlace, parentOf, thingFor, type Thing } from "./things.js";

/** A way of sensing things: by sight, by touch, or by sound. */
export type Sense = "see" | "reach" | "hear";

/** Whether `t` keeps `sense` from passing between its inside and its outside. */
function encloses(t: Thing, sense: Sense): boolean {
  if (isPlace(t)) return true;
  const f = features(t);
  // Only a closed container encloses: a surface, or a thing that holds nothing, never does.
  if (f.holds !== "in" || f.isOpen !== false) return false;
  if (sense === "hear") return false;
  if (sense === "see") return f.isTransparent !== true;
  return true;
}

/** How far `sense` reaches up from `observer`: the first thing above it that encloses it, or the top. */
function rootOf(observer: Thing, sense: Sense): Thing {
  const seen = new Set<StateId>();
  let at = observer;
  if (isPlace(at)) return at;
  for (let up = parentOf(at); up && !seen.has(up.id); up = parentOf(up)) {
    seen.add(up.id);
    if (encloses(up, sense)) return up;
    at = up;
  }
  return at;
}

/** Everything `sense` reaches inside `root`, without passing into anything that encloses it. */
function within(root: Thing, sense: Sense, out: Thing[] = [], seen = new Set<StateId>()): Thing[] {
  for (const t of contents(root)) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
    if (!encloses(t, sense)) within(t, sense, out, seen);
  }
  return out;
}

/** The thing `ref` names, or an error saying it isn't one. */
function known(ref: ObjectRef, where: string): Thing {
  const t = thingFor(ref);
  if (!t) {
    throw new StateError(
      `${where}: ${JSON.stringify(ref.id)} isn't defined with thing() or place().`,
    );
  }
  return t;
}

/** Everything `observer` could sense with `sense`, light aside: its root and all within. */
function field(observer: Thing, sense: Sense): Thing[] {
  const root = rootOf(observer, sense);
  return [root, ...within(root, sense)];
}

/**
 * Whether there's light where `observer` is: its place isn't dark, or a lit
 * light source is in sight of it, carried, on a table, or in an open box.
 * Inside a closed opaque container, only a light inside it helps.
 */
export function isInLight(observer: ObjectRef): boolean {
  const o = known(observer, "isInLight");
  const root = rootOf(o, "see");
  if (isPlace(root) && features(root).isDark !== true) return true;
  return field(o, "see").some((t) => features(t).isLit === true);
}

/**
 * Everything `observer` can sense with `sense`, sorted by ID: things in its
 * place, its own place, and what it carries, but not itself. In the dark,
 * it sees nothing: a lit light source in sight would have lit the place.
 *
 * @example
 * ```ts
 * inScope(player, "reach"); // everything the player could touch
 * ```
 */
export function inScope(observer: ObjectRef, sense: Sense): Thing[] {
  const o = known(observer, "inScope");
  if (sense === "see" && !isInLight(o)) return [];
  return field(o, sense)
    .filter((t) => t.id !== o.id)
    .sort(byId);
}

/** Whether `observer` can sense `target` with `sense`. A thing always senses itself. */
function senses(observer: ObjectRef, target: ObjectRef, sense: Sense, where: string): boolean {
  known(observer, where);
  known(target, where);
  if (observer.id === target.id) return true;
  return inScope(observer, sense).some((t) => t.id === target.id);
}

/**
 * Whether `observer` can see `target`: they're in the same place, nothing
 * closed and opaque is between them, and there's light.
 */
export function canSee(observer: ObjectRef, target: ObjectRef): boolean {
  return senses(observer, target, "see", "canSee");
}

/**
 * Whether `observer` can reach `target`: they're in the same place and
 * nothing closed is between them, even something transparent. Reach doesn't
 * need light.
 */
export function canReach(observer: ObjectRef, target: ObjectRef): boolean {
  return senses(observer, target, "reach", "canReach");
}

/** Whether `observer` can hear `target`: they're in the same place. Closed containers don't stop sound. */
export function canHear(observer: ObjectRef, target: ObjectRef): boolean {
  return senses(observer, target, "hear", "canHear");
}
