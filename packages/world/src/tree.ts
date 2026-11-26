/**
 * The world as a tree, for the inspector's World tab (#82, ADR 0073): places
 * with what's in them, nested, then what's out of the world and minds with
 * no body; and for any node, where it is, its mind or body, and who knows
 * what. It reads the world and changes nothing.
 */
import { _worldMap } from "./map-layout.js";
import { _allMinds, bodyOf, currentPlayerBody, isBody, isMind, mindFor, mindOf } from "./actors.js";
import { _allThings, _mapPin, isPlace, thingFor } from "./things.js";

/** A node in the world tree. @internal */
export type _TreeNode = {
  readonly id: string;
  readonly name: string;
  readonly kind: "place" | "thing" | "body" | "mind";
  /** For a body, the mind in it now. */
  readonly mind?: string;
  /** For a stack, how many it holds. */
  readonly count?: number;
  readonly children: readonly _TreeNode[];
};

/** The world tree: places, then what's out of the world, then minds with no body. @internal */
export type _WorldTree = {
  readonly places: readonly _TreeNode[];
  readonly nowhere: readonly _TreeNode[];
  readonly bodiless: readonly _TreeNode[];
};

const nameOf = (t: { readonly name?: unknown; readonly id: string }): string =>
  typeof t.name === "string" ? t.name : t.id;

/** The world as a tree, as it is now. @internal */
export function _worldTree(): _WorldTree {
  const things = _allThings();
  const inside = new Map<string, typeof things>();
  for (const t of things) {
    const at = t.location?.id;
    if (at === undefined) continue;
    inside.set(at, [...(inside.get(at) ?? []), t]);
  }
  const node = (t: (typeof things)[number]): _TreeNode => {
    const inBody = isBody(t) ? mindOf(t)?.id : undefined;
    const count =
      (t as { count?: unknown; stackOf?: unknown }).stackOf !== undefined
        ? (t as { count?: number }).count
        : undefined;
    return Object.freeze({
      id: t.id,
      name: nameOf(t),
      kind: isPlace(t) ? "place" : isBody(t) ? "body" : "thing",
      ...(inBody !== undefined && { mind: inBody }),
      ...(count !== undefined && { count }),
      children: (inside.get(t.id) ?? []).map(node),
    });
  };
  return {
    places: things.filter((t) => isPlace(t) && t.location == null).map(node),
    nowhere: things.filter((t) => !isPlace(t) && t.location == null).map(node),
    bodiless: _allMinds()
      .filter((m) => bodyOf(m) === undefined)
      .map((m) => Object.freeze({ id: m.id, name: nameOf(m), kind: "mind", children: [] })),
  };
}

/** What a mind knows, as the World tab shows it. @internal */
export type _Knowledge = {
  readonly mind: string;
  readonly facts: readonly {
    readonly id: string;
    readonly text: string;
    readonly from?: string;
    readonly passage?: string;
  }[];
  /** Things it has seen. */
  readonly seen: readonly string[];
  /** Things it knows of without having seen them. */
  readonly knownOf: readonly string[];
};

/** A node's details. @internal */
export type _Details = {
  readonly id: string;
  readonly name: string;
  readonly kind: _TreeNode["kind"];
  /** Where it is: what holds it, then what holds that, out to its place. */
  readonly within: readonly string[];
  /** For a body, the mind in it; for a mind, the body it's in. */
  readonly mind?: string;
  readonly body?: string;
  /** For a mind, or a body with a mind in it: what that mind knows. */
  readonly knowledge?: _Knowledge;
  /** For a thing: the minds that have seen it, and those that know of it without having seen it. */
  readonly seenBy?: readonly string[];
  readonly knownOfBy?: readonly string[];
  /** For a place on the map grid: its cell, and whether it was nudged off the one its exits ask for (#394). */
  readonly map?: {
    readonly x: number;
    readonly y: number;
    readonly nudged: boolean;
    readonly pinned: boolean;
  };
};

function knowledgeOf(mindId: string): _Knowledge {
  const m = mindFor({ id: mindId }, "inspector");
  const things = _allThings();
  return {
    mind: m.id,
    facts: m.knownFacts().map((f) => {
      const source = m.sourceOf(f);
      return {
        id: f.id,
        text: f.text,
        ...(source?.from !== undefined && { from: source.from.id }),
        ...(source?.passage !== undefined && { passage: source.passage }),
      };
    }),
    seen: things.filter((t) => m.hasSeen(t)).map((t) => t.id),
    knownOf: things.filter((t) => !m.hasSeen(t) && m.knowsAbout(t)).map((t) => t.id),
  };
}

/** The details of the node with `id`, or `undefined` if there's none. @internal */
export function _worldDetails(id: string): _Details | undefined {
  if (isMind({ id }) && !thingFor({ id })) {
    const m = mindFor({ id }, "inspector");
    const body = bodyOf(m)?.id;
    return {
      id,
      name: nameOf(m),
      kind: "mind",
      within: [],
      ...(body !== undefined && { body }),
      knowledge: knowledgeOf(id),
    };
  }
  const t = thingFor({ id });
  if (!t) return undefined;
  const within: string[] = [];
  for (let at = t.location; at; at = thingFor(at)?.location ?? null) within.push(at.id);
  const minds = _allMinds();
  const body = isBody(t);
  const inside = body ? mindOf(t)?.id : undefined;
  const grid = isPlace(t) ? _worldMap().layout : undefined;
  const cell = grid?.cells.get(id);
  return {
    id,
    name: nameOf(t),
    kind: isPlace(t) ? "place" : body ? "body" : "thing",
    within,
    ...(inside !== undefined && { mind: inside, knowledge: knowledgeOf(inside) }),
    seenBy: minds.filter((m) => m.hasSeen(t)).map((m) => m.id),
    knownOfBy: minds.filter((m) => !m.hasSeen(t) && m.knowsAbout(t)).map((m) => m.id),
    ...(cell && {
      map: {
        ...cell,
        nudged: grid?.nudged.includes(id) === true,
        pinned: _mapPin(t) !== undefined,
      },
    }),
  };
}

/** The player's body, and what holds it out to its place, for opening the tree on them. @internal */
export function _playerPath(): readonly string[] {
  const body = currentPlayerBody();
  if (!body) return [];
  const path = [body.id];
  for (let at = body.location; at; at = thingFor(at)?.location ?? null) path.unshift(at.id);
  return path;
}
