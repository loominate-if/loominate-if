/**
 * Companions (#121, ADR 0098): ordinary NPCs with extra states. One who's
 * accompanying the player goes where they go, from room to room, and the
 * move is told as a group, "You and Mira head north."; one who's waiting
 * stays put. Orders as actions the player takes are #123.
 */
import {
  _storyRunning,
  emit,
  message,
  messages,
  object,
  StateError,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import { bodyOf, currentPlayerBody, mindFor, mindsIn } from "./actors.js";
import { exitsOf } from "./exits.js";
import { noteSights } from "./knowledge.js";
import { happen } from "./perception.js";
import { _whenPlayerMoves } from "./rooms.js";
import { placeOf, thingFor, type Place } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /**
     * The player and their companions moving together: "You and Mira head
     * north.", or, with no way, as a jump in a passage, "Mira comes with you."
     */
    "companions.together": { readonly companions: readonly ObjectRef[]; readonly way?: string };
    /** A companion told to wait: "Mira waits here." */
    "companions.waits": { readonly companion: ObjectRef };
    /** A companion told to come along: "Mira comes along." */
    "companions.accompanies": { readonly companion: ObjectRef };
  }
}
const SOURCE = "@loominate-if/world";
messages.register(
  "companions.together",
  ({ companions, way }) => {
    const names = message("list.join", { items: companions.map((c) => t`{the c}`({ c })) });
    if (way !== undefined) {
      const all = message("list.join", {
        items: ["you", ...companions.map((c) => t`{the c}`({ c }))],
      });
      return `${all.charAt(0).toUpperCase()}${all.slice(1)} head ${way}.`;
    }
    const [only] = companions;
    return companions.length === 1 && only
      ? t`{The subj c} {comes} with you.`({ c: only })
      : `${names.charAt(0).toUpperCase()}${names.slice(1)} come with you.`;
  },
  { source: SOURCE },
);
messages.register(
  "companions.waits",
  ({ companion }) => t`{The subj c} {waits} here.`({ c: companion }),
  { source: SOURCE },
);
messages.register(
  "companions.accompanies",
  ({ companion }) => t`{The subj c} {comes} along.`({ c: companion }),
  { source: SOURCE },
);

/** What a companion is doing: going with the player, or waiting where they are. */
export type CompanionState = "accompanying" | "waiting";

/** The companions, by mind ID, as given, in the order made. */
const companions = new Map<string, ObjectRef>();
const starting = new Map<string, CompanionState>();
const state = object("world:companions", {
  /** Each companion's state, as changed in play, by mind ID. */
  of: {} as Record<string, CompanionState>,
});

/**
 * Makes an NPC a companion, in `story.ts`: accompanying the player, the
 * default, or waiting where they are.
 *
 * @example
 * ```ts
 * companion(mira, { starts: "accompanying" });
 * ```
 *
 * @throws StateError during play, or for the player.
 */
export function companion(
  npc: ObjectRef,
  options: { readonly starts?: CompanionState; readonly shares?: SharingPolicy } = {},
): void {
  const mind = mindFor(npc, "companion").id;
  if (_storyRunning()) {
    throw new StateError(
      `companion ${JSON.stringify(mind)}: make companions in story.ts, as the game loads.`,
    );
  }
  companions.set(mind, npc);
  starting.set(mind, options.starts ?? "accompanying");
  if (options.shares !== undefined) policies.set(mind, options.shares);
  for (const l of made) l(npc);
}

/**
 * How what the player and a companion know is shared: `reunion`, everything,
 * whenever they're together; `together`, what's learned while they're
 * together; or `conversation`, only by talking.
 */
export type SharingPolicy = "reunion" | "together" | "conversation";

/** Companions' own policies, by mind ID, where they differ from the game's. */
const policies = new Map<string, SharingPolicy>();
/** What's told when a companion is made, as sharing giving them a topic. */
const made: ((npc: ObjectRef) => void)[] = [];

/** Calls `listener` as each companion is made, in story.ts. @internal */
export function _whenCompanionMade(listener: (npc: ObjectRef) => void): void {
  made.push(listener);
}

/** A companion's own sharing policy, if it has one. @internal */
export function _policyOf(mind: string): SharingPolicy | undefined {
  return policies.get(mind);
}

/** Every companion, by mind ID, in the order made. @internal */
export function _companionMinds(): readonly string[] {
  return [...companions.keys()];
}

const checked = (where: string, npc: ObjectRef): string => {
  const mind = mindFor(npc, where).id;
  if (!companions.has(mind)) {
    throw new StateError(
      `${where}: ${JSON.stringify(mind)} isn't a companion. Make them one with companion(npc) in story.ts.`,
    );
  }
  return mind;
};

/** A companion's state now, or `undefined` for an NPC who isn't one. */
export function companionState(npc: ObjectRef): CompanionState | undefined {
  const mind = mindFor(npc, "companionState").id;
  if (!companions.has(mind)) return undefined;
  return (_storyRunning() ? state.of[mind] : undefined) ?? starting.get(mind);
}

function set(
  where: string,
  npc: ObjectRef,
  to: CompanionState,
  said: "companions.waits" | "companions.accompanies",
): void {
  const mind = checked(where, npc);
  if (!_storyRunning()) {
    starting.set(mind, to);
    return;
  }
  if (companionState(npc) === to) return;
  state.of = { ...state.of, [mind]: to };
  const body = bodyOf({ id: mind });
  if (body) happen(body, { seen: message(said, { companion: body }) });
}

/** Has a companion come along with the player again: "Mira comes along." In story.ts, it's how they start. */
export function accompany(npc: ObjectRef): void {
  set("accompany", npc, "accompanying", "companions.accompanies");
}

/** Has a companion wait where they are: "Mira waits here." In story.ts, it's how they start. */
export function waitHere(npc: ObjectRef): void {
  set("waitHere", npc, "waiting", "companions.waits");
}

/** Whether an NPC is a companion accompanying the player, so their timetable leaves them be. @internal */
export function _isAccompanying(mind: ObjectRef): boolean {
  return companions.has(mind.id) && companionState(mind) === "accompanying";
}

// Accompanying companions who were with the player go with them, told as a group.
_whenPlayerMoves((from: Place, to: Place) => {
  const coming = [...companions.keys()].sort().flatMap((mind) => {
    const body = bodyOf({ id: mind });
    // Not the one the player now plays, after a switch.
    return body &&
      body.id !== currentPlayerBody()?.id &&
      companionState({ id: mind }) === "accompanying" &&
      placeOf(body)?.id === from.id
      ? [body]
      : [];
  });
  if (coming.length === 0) return;
  for (const body of coming) {
    // Moved directly, so they aren't told as arriving apart from the player.
    const thing = thingFor(body) as { location: ObjectRef | null } | undefined;
    if (thing) thing.location = to;
    noteSights(body, mindsIn(body));
  }
  const way = exitsOf(from).find((e) => e.to.id === to.id)?.direction.name;
  emit(
    "action-result",
    {
      text: message("companions.together", {
        companions: coming,
        ...(way !== undefined && { way }),
      }),
    },
    ["lead", "companions"],
  );
});
