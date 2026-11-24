/**
 * Conversation nodes (#116, ADR 0093), as adv3Lite's ConvNodes: moments in
 * a conversation that need structure, such as an NPC asking a question. A
 * node is opened by an entry that answers, or by `openNode`; entries `in`
 * it apply only while it's open, ahead of all others. A restrictive node
 * answers only its own replies, pressing the point otherwise. It closes
 * when one of its entries answers, on `closeNode`, or when the
 * conversation ends.
 */
import { NameTaken, object, StateError, type ObjectRef } from "@loominate-if/core";
import { mindFor } from "./actors.js";
import { _whenLeaving, inConversationWith } from "./conversations.js";

/** What a node's NPC says to press the point: text, or a function that returns it. */
export type Presses = string | (() => string | undefined);

/** A conversation node: one NPC's, by name. */
export type ConvNode = {
  /** Its ID: the mind's, then `node:` and its name, as `butler:mind:node:proposal`. */
  readonly id: string;
  /** Its name, as given. */
  readonly name: string;
  /** The mind whose node it is. */
  readonly mind: string;
  /** Whether only its own entries answer while it's open. */
  readonly restricts: boolean;
  /** What the NPC says when the player changes the subject, if anything. */
  readonly presses?: Presses;
  /** Marks it as a node, apart from actor states and scenes. */
  readonly isNode: true;
};

const nodes = new Map<string, ConvNode>();
const state = object("world:convNodes", {
  /** Each mind's open node, by its ID. */
  open: {} as Record<string, string>,
});

/**
 * Defines a conversation node for an NPC, in `story.ts`. With `restricts`,
 * only the node's own entries answer while it's open, and the NPC presses
 * the point instead; without it, other exchanges are answered, and then
 * the NPC presses the point, if it has a `presses` line.
 *
 * @example
 * ```ts
 * export const proposal = convNode(butler, "proposal", {
 *   restricts: true,
 *   presses: "“Well, sir? Will you take the post?”",
 * });
 * ```
 *
 * @throws NameTaken if the NPC already has a node with this name.
 */
export function convNode(
  npc: ObjectRef,
  name: string,
  options: { readonly restricts?: boolean; readonly presses?: Presses } = {},
): ConvNode {
  const mind = mindFor(npc, "convNode").id;
  const id = `${mind}:node:${name}`;
  if (nodes.has(id)) {
    throw new NameTaken(
      `convNode ${JSON.stringify(name)}: ${JSON.stringify(mind)} already has a node with this name.`,
    );
  }
  const node: ConvNode = Object.freeze({
    id,
    name,
    mind,
    restricts: options.restricts === true,
    ...(options.presses !== undefined && { presses: options.presses }),
    isNode: true as const,
  });
  nodes.set(id, node);
  return node;
}

/**
 * Opens one of an NPC's nodes, closing any other of theirs, as when they ask
 * a question. The NPC must be in the player's conversation.
 *
 * @throws StateError if the node is another NPC's, or they aren't in the conversation.
 */
export function openNode(npc: ObjectRef, node: ConvNode): void {
  const mind = mindFor(npc, "openNode").id;
  if (node.mind !== mind) {
    throw new StateError(
      `openNode: ${JSON.stringify(node.id)} is another NPC's node, not ${JSON.stringify(mind)}'s.`,
    );
  }
  if (!inConversationWith(npc)) {
    throw new StateError(
      `openNode: ${JSON.stringify(mind)} isn't in the conversation. Start it first, with startConversation.`,
    );
  }
  state.open = { ...state.open, [mind]: node.id };
}

/** Closes an NPC's open node, if they have one. */
export function closeNode(npc: ObjectRef): void {
  const mind = mindFor(npc, "closeNode").id;
  if (!Object.hasOwn(state.open, mind)) return;
  const { [mind]: _closed, ...rest } = state.open;
  void _closed;
  state.open = rest;
}

/** An NPC's open node, or `undefined`. */
export function openNodeOf(npc: ObjectRef): ConvNode | undefined {
  const id = state.open[mindFor(npc, "openNodeOf").id];
  return id === undefined ? undefined : nodes.get(id);
}

/** Whether `x`, an entry's `in`, is a node. @internal */
export function _isNode(x: unknown): x is ConvNode {
  return typeof x === "object" && x !== null && (x as { isNode?: unknown }).isNode === true;
}

// A node closes when its NPC leaves the conversation.
_whenLeaving((mind) => {
  closeNode({ id: mind });
});
