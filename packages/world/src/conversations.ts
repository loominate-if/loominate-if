/**
 * Conversations (#110, ADR 0087): the data model under topics, nodes, and
 * conversation mode. There's one conversation at a time, the player's, with
 * any number of NPCs in it, one of them addressed, so one-on-one is a group
 * of one. Locks, each with an owner, say whether the player may leave; the
 * strictest decides. A participant who isn't with the player any more,
 * after a move, leaves it, and with no one left it ends.
 */
import {
  _storyRunning,
  action,
  emit,
  hook,
  message,
  messages,
  object,
  StateError,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import { bodyOf, currentPlayerBody, mindFor, type Mind } from "./actors.js";
import { placeOf, type Thing } from "./things.js";

/** How strictly a lock holds the player in a conversation. */
export type LockLevel = "soft" | "hard";

/** A lock on the conversation, held by a participant or a conversation node. */
export type ConversationLock = {
  /** Who or what holds it: a participant's mind ID, or a node's. */
  readonly by: string;
  /** `soft`: the NPC objects to the player leaving, but they can insist. `hard`: they can't leave. */
  readonly level: LockLevel;
  /** Why, for the player and the inspector: "He hasn't finished." */
  readonly reason?: string;
};

/** Whether the player may leave: freely, over an objection, or not at all. */
export type ConversationExit = "free" | LockLevel;

const SOURCE = "@loominate-if/world";
const state = object("world:conversation", {
  /** The NPCs in it, by mind ID, in the order they joined. Empty: no conversation. */
  participants: [] as string[],
  /** The mind addressed, one of the participants. */
  addressee: null as string | null,
  /** Locks, one per owner, in the order they were made. */
  locks: [] as ConversationLock[],
  /** Whether the player has already tried to leave against a soft lock, so trying again goes. */
  insisted: false,
});

/** The player's conversation, as it is now. */
export type ConversationView = {
  /** Whether the player is in a conversation. */
  readonly active: boolean;
  /** The NPCs in it, by their bodies, in the order they joined. */
  readonly participants: readonly Thing[];
  /** The NPC the player is talking to, if in a conversation. */
  readonly addressee: Thing | undefined;
  /** The locks held on it, in the order they were made. */
  readonly locks: readonly ConversationLock[];
  /** Whether the player may leave, by the strictest lock. */
  readonly exit: ConversationExit;
};

const bodyFor = (mind: string): Thing | undefined => bodyOf({ id: mind });

/** The player's conversation, as it is now. */
export const conversation: ConversationView = Object.freeze({
  get active() {
    return state.participants.length > 0;
  },
  get participants() {
    return state.participants.flatMap((m) => bodyFor(m) ?? []);
  },
  get addressee() {
    return state.addressee === null ? undefined : bodyFor(state.addressee);
  },
  get locks() {
    return state.locks;
  },
  get exit(): ConversationExit {
    return state.locks.some((l) => l.level === "hard")
      ? "hard"
      : state.locks.length > 0
        ? "soft"
        : "free";
  },
});

/** The NPC's mind, checked: in play, not the player, with a body. */
function npcMind(where: string, npc: ObjectRef): Mind {
  if (!_storyRunning()) {
    throw new StateError(
      `${where}: conversations change during play. Do it in a passage's effect, an action, or an NPC's turn.`,
    );
  }
  const mind = mindFor(npc, where);
  const body = bodyOf(mind);
  if (!body) throw new StateError(`${where}: ${JSON.stringify(mind.id)} has no body to talk with.`);
  if (body.id === currentPlayerBody()?.id) {
    throw new StateError(`${where}: that's the player, who's in every conversation they have.`);
  }
  return mind;
}

/**
 * Starts a conversation between the player and one NPC, or several, the
 * first of whom the player addresses.
 *
 * @example
 * ```ts
 * startConversation(butler);
 * startConversation([butler, maid]);
 * ```
 *
 * @throws StateError outside play, for the player, for someone with no body, or if a conversation is going on.
 */
export function startConversation(withWhom: ObjectRef | readonly ObjectRef[]): void {
  const list = Array.isArray(withWhom) ? withWhom : [withWhom as ObjectRef];
  if (list.length === 0) throw new StateError("startConversation: give at least one NPC.");
  const minds = list.map((n) => npcMind("startConversation", n).id);
  if (state.participants.length > 0) {
    throw new StateError(
      "startConversation: the player is already in a conversation. Add someone with joinConversation, or end it first with endConversation.",
    );
  }
  const unique = [...new Set(minds)];
  state.participants = unique;
  state.addressee = unique[0] ?? null;
  state.locks = [];
  state.insisted = false;
  emit("conversation", { event: "started", with: [...unique] });
  for (const l of changes.started) l();
}

/**
 * How someone left the conversation: the player said goodbye, they're no
 * longer together, or the game took them out or ended it.
 */
export type LeftBy = "goodbye" | "apart" | "ended";

/** What's told when someone leaves, before they're gone: implicit goodbyes. */
const leaving: ((mind: string, how: LeftBy) => void)[] = [];

/** What's told when a conversation starts and ends, as conversation mode switches the layout. */
const changes: { started: (() => void)[]; ended: (() => void)[] } = { started: [], ended: [] };

/** Calls `listener` just after a conversation starts, or ends. @internal */
export function _whenConversation(event: "started" | "ended", listener: () => void): void {
  changes[event].push(listener);
}

/** Calls `listener` as each participant leaves, while they're still in it. @internal */
export function _whenLeaving(listener: (mind: string, how: LeftBy) => void): void {
  leaving.push(listener);
}

/** Ends the player's conversation, with its locks. Does nothing if there isn't one. */
export function endConversation(): void {
  _endConversation("ended");
}

/** Ends the conversation, telling how. @internal */
export function _endConversation(how: LeftBy): void {
  const was = [...state.participants];
  for (const mind of [...state.participants]) for (const l of leaving) l(mind, how);
  state.participants = [];
  state.addressee = null;
  state.locks = [];
  state.insisted = false;
  if (was.length > 0) {
    emit("conversation", { event: "ended", with: was });
    for (const l of changes.ended) l();
  }
}

/**
 * Adds an NPC to the player's conversation.
 *
 * @throws StateError if there's no conversation, or as {@link startConversation}.
 */
export function joinConversation(npc: ObjectRef): void {
  const mind = npcMind("joinConversation", npc).id;
  if (state.participants.length === 0) {
    throw new StateError(
      "joinConversation: there's no conversation. Start one with startConversation.",
    );
  }
  if (!state.participants.includes(mind)) state.participants = [...state.participants, mind];
}

/**
 * Takes an NPC out of the player's conversation, with the locks they hold.
 * If they were addressed, the player addresses whoever joined first of
 * those left; with no one left, the conversation ends.
 */
export function leaveConversation(npc: ObjectRef): void {
  remove(mindFor(npc, "leaveConversation").id, "ended");
}

function remove(mind: string, how: LeftBy): void {
  if (!state.participants.includes(mind)) return;
  const left = state.participants.filter((m) => m !== mind);
  if (left.length === 0) {
    _endConversation(how);
    return;
  }
  for (const l of leaving) l(mind, how);
  state.participants = left;
  state.locks = state.locks.filter((l) => l.by !== mind);
  if (state.addressee === mind) state.addressee = left[0] ?? null;
}

/**
 * Makes an NPC in the conversation the one the player addresses.
 *
 * @throws StateError if they aren't in it.
 */
export function address(npc: ObjectRef): void {
  const mind = mindFor(npc, "address").id;
  if (!state.participants.includes(mind)) {
    throw new StateError(
      `address: ${JSON.stringify(mind)} isn't in the conversation. Add them with joinConversation first.`,
    );
  }
  state.addressee = mind;
}

/** Whether an NPC is in the player's conversation. */
export function inConversationWith(npc: ObjectRef): boolean {
  return state.participants.includes(mindFor(npc, "inConversationWith").id);
}

/** A lock's owner: an NPC, or a conversation node by its ID. */
const ownerId = (where: string, by: ObjectRef | string): string =>
  typeof by === "string" ? by : mindFor(by, where).id;

/**
 * Locks the conversation: `soft`, the NPC objects to the player leaving, or
 * `hard`, they can't. Each owner holds one lock; locking again replaces it.
 * A participant's locks go when they leave, and all go when it ends.
 *
 * @example
 * ```ts
 * lockConversation({ by: butler, level: "soft", reason: "He hasn't finished." });
 * ```
 *
 * @throws StateError if there's no conversation, or the owner is an NPC who isn't in it.
 */
export function lockConversation(lock: {
  readonly by: ObjectRef | string;
  readonly level: LockLevel;
  readonly reason?: string;
}): void {
  const by = ownerId("lockConversation", lock.by);
  if (state.participants.length === 0) {
    throw new StateError("lockConversation: there's no conversation to lock.");
  }
  if (typeof lock.by !== "string" && !state.participants.includes(by)) {
    throw new StateError(
      `lockConversation: ${JSON.stringify(by)} isn't in the conversation, so can't hold it.`,
    );
  }
  if (lock.level !== "soft" && lock.level !== "hard") {
    throw new StateError(
      `lockConversation: the level is "soft" or "hard", not ${JSON.stringify(lock.level)}.`,
    );
  }
  const made: ConversationLock = {
    by,
    level: lock.level,
    ...(lock.reason !== undefined && { reason: lock.reason }),
  };
  const at = state.locks.findIndex((l) => l.by === by);
  state.locks = at < 0 ? [...state.locks, made] : state.locks.map((l, i) => (i === at ? made : l));
}

/** Removes the lock an NPC or node holds, if any. */
export function unlockConversation(by: ObjectRef | string): void {
  const id = ownerId("unlockConversation", by);
  state.locks = state.locks.filter((l) => l.by !== id);
}

// After each move, after NPCs' turns, anyone no longer with the player leaves.
hook("turnEnd").rule(
  "conversation participants",
  () => {
    if (state.participants.length === 0) return;
    const player = currentPlayerBody();
    const here = player ? placeOf(player) : undefined;
    for (const mind of [...state.participants]) {
      const body = bodyFor(mind);
      const there = body ? placeOf(body) : undefined;
      if (!here || !there || there.id !== here.id) remove(mind, "apart");
    }
  },
  { source: "@loominate-if/world", after: "npc turns" },
);

// --- Exit control (#117) ---

declare module "@loominate-if/core" {
  interface EventKinds {
    /**
     * A conversation starting or ending, with who's in it, by mind ID. The page
     * never shows it; conversation mode's transcript starts at it.
     */
    conversation: { readonly event: "started" | "ended"; readonly with: readonly string[] };
  }
  interface Messages {
    /** What an NPC says when the player tries to leave against a soft lock with no reason of its own. */
    "conversation.objects": { readonly who: ObjectRef };
    /** Why the player can't leave against a hard lock with no reason of its own. */
    "conversation.locked": { readonly who: ObjectRef };
  }
}
messages.register(
  "conversation.objects",
  ({ who }) => t`“Just a moment,” {the who} {says}. “I haven't finished.”`({ who }),
  { source: SOURCE },
);
messages.register(
  "conversation.locked",
  ({ who }) => t`You can't leave until you answer {the who}.`({ who }),
  { source: SOURCE },
);

/** The strictest lock, which decides the exit. */
const strictest = (): ConversationLock | undefined =>
  state.locks.find((l) => l.level === "hard") ?? state.locks[0];

/** Who a lock's owner is, as a body to name: the participant, or the node's NPC. */
function ownerBody(lock: ConversationLock): Thing | undefined {
  const mind = state.participants.find((m) => lock.by === m || lock.by.startsWith(`${m}:node:`));
  return bodyFor(mind ?? state.addressee ?? "");
}

/**
 * Why the player can't leave the conversation now, against a hard lock, or
 * `undefined`. Goodbye and the room's exits are disabled with it. @internal
 */
export function _lockedReason(): string | undefined {
  const lock = strictest();
  if (lock?.level !== "hard") return undefined;
  const who = ownerBody(lock);
  return lock.reason ?? (who ? message("conversation.locked", { who }) : undefined);
}

/**
 * Whether leaving now meets an objection: a soft lock holds, and the player
 * hasn't insisted yet. @internal
 */
export function _objectsToLeaving(): boolean {
  return strictest()?.level === "soft" && !state.insisted;
}

/** The NPC objects to the player leaving; trying again insists. @internal */
export function _object(): void {
  const lock = strictest();
  if (!lock) return;
  const who = ownerBody(lock);
  const text = lock.reason ?? (who ? message("conversation.objects", { who }) : "");
  if (text !== "")
    emit("action-result", { text }, ["topic", ...(who ? [`speaker:${who.id}`] : [])]);
  state.insisted = true;
}

/**
 * Tries to leave the conversation by a way out of the room, against a soft
 * lock: the NPC objects, and trying again goes. What an exit link takes
 * while a soft lock holds. @internal
 */
export const _excuseYourself = action<{ way: string }>("excuseYourself", {
  source: SOURCE,
  verify: () => (_objectsToLeaving() ? undefined : "There's nothing to excuse yourself from."),
  run: () => {
    _object();
  },
});
