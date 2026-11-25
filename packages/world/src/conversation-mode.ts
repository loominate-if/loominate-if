/**
 * Conversation mode (#118, ADR 0095): while the player is talking, the page
 * switches to a layout that focuses on the characters: a cast of portraits,
 * with changeable expressions, the one addressed marked; what's said, with
 * the room's own prose receding; and the topics on offer, as buttons. It's
 * the `conversation` layout, with the widgets `conversation-cast` and
 * `conversation-topics`, which a game can restyle or replace.
 */
import {
  _currentPassage,
  _storyRunning,
  emit,
  hook,
  message,
  messages,
  object,
  StateError,
  statusOf,
  t,
  type ObjectRef,
} from "@loominate-if/core";
import {
  actionListWidget,
  castWidget,
  display,
  nameSpeakers,
  layouts,
  widgets,
  type ActionListItem,
  type CastMember,
} from "@loominate-if/presentation";
import { bodyOf, currentPlayerBody, mindFor, mindOf } from "./actors.js";
import {
  _whenConversation,
  address,
  conversation,
  inConversationWith,
  joinConversation,
  startConversation,
} from "./conversations.js";
import { _nodeById, openNode, openNodeOf, type ConvNode } from "./nodes.js";
import { placeOf, thingFor } from "./things.js";
import { stepToward } from "./agendas.js";
import {
  _addressAction,
  _hideTopicLinksWhen,
  _useExpressions,
  suggestedTopics,
  type SuggestedTopic,
} from "./topics.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** What the cast of portraits is called, for screen readers. */
    "conversation.cast": Record<never, never>;
    /** What the list of topics is called, for screen readers. */
    "conversation.topics": Record<never, never>;
    /** What the conversation so far is called, for screen readers. */
    "conversation.transcript": Record<never, never>;
    /** What the disclosure of the room's own links is called while talking: "In the study". */
    "conversation.room": { readonly room: ObjectRef | undefined };
  }
}
const SOURCE = "@loominate-if/world";
messages.register("conversation.cast", "In the conversation", { source: SOURCE });
messages.register("conversation.topics", "Topics", { source: SOURCE });
messages.register("conversation.transcript", "The conversation so far", { source: SOURCE });
messages.register(
  "conversation.room",
  ({ room }) => (room ? t`In {the room}`({ room }) : "Other choices"),
  { source: SOURCE },
);

// --- Switching ---

/** The layout conversations switch to, or `false` for none. Set as the game loads. */
let mode: { readonly layout: string } | false = { layout: "conversation" };
const state = object("world:conversationMode", {
  /** The layout showing before the conversation, to go back to. */
  before: null as string | null,
  /** The passage the conversation started in, where its layout shows. */
  home: null as string | null,
});

/**
 * Says how conversations show, in `story.ts`: in the world model's
 * `conversation` layout (the default), in a layout of the game's own, or,
 * with `false`, not in a layout of their own at all.
 *
 * @example
 * ```ts
 * conversationMode({ layout: "my-talk" });
 * conversationMode(false);
 * ```
 *
 * @throws StateError during play.
 */
export function conversationMode(options: { readonly layout?: string } | false = {}): void {
  if (_storyRunning()) {
    throw new StateError(
      "conversationMode: say how conversations show in story.ts, as the game loads.",
    );
  }
  mode = options === false ? false : { layout: options.layout ?? "conversation" };
}

/** Whether conversation mode's layout is showing now. */
const showing = (): boolean => mode !== false && display.layout === mode.layout;

_whenConversation("started", () => {
  if (mode === false || display.layout === mode.layout) return;
  state.before = display.layout;
  state.home = _currentPassage() ?? null;
  display.layout = mode.layout;
});
_whenConversation("ended", () => {
  if (state.before === null) return;
  display.layout = state.before;
  state.before = null;
  state.home = null;
});
// Elsewhere during a conversation, such as a hear-me-out cut scene, the usual
// layout shows; back where it started, the conversation's does again.
hook("passageEnter").rule(
  "conversation mode follows the passage",
  ({ passage }) => {
    if (mode === false || state.before === null || state.home === null) return;
    display.layout = passage === state.home ? mode.layout : state.before;
  },
  { source: SOURCE },
);
// The layout lists the topics, so the passage doesn't as well.
_hideTopicLinksWhen(showing);

// --- Portraits ---

/** A portrait: an image, and one for each expression. */
export type Portrait = {
  /** The image, when they have no expression or none of their own. */
  readonly image?: string;
  /** An image for each expression, by name: `{ stern: "butler-stern.png" }`. */
  readonly expressions?: Readonly<Record<string, string>>;
};

const portraits = new Map<string, Portrait>();
const faces = object("world:expressions", {
  /** Each mind's expression, by name. */
  of: {} as Record<string, string>,
});

/**
 * Gives an NPC a portrait for conversation mode, in `story.ts`: an image,
 * and one for each expression. Without one, their portrait is their
 * initials.
 *
 * @example
 * ```ts
 * portrait(butler, { image: "butler.png", expressions: { stern: "butler-stern.png" } });
 * ```
 */
export function portrait(npc: ObjectRef, options: Portrait): void {
  portraits.set(mindFor(npc, "portrait").id, options);
}

/**
 * Sets an NPC's expression, or clears it with `undefined`. An entry's
 * `expression` sets it as it answers.
 *
 * @throws StateError if their portrait names its expressions and this isn't one.
 */
export function setExpression(npc: ObjectRef, expression: string | undefined): void {
  const mind = mindFor(npc, "setExpression").id;
  const known = portraits.get(mind)?.expressions;
  if (expression !== undefined && known && !Object.hasOwn(known, expression)) {
    throw new StateError(
      `setExpression: ${JSON.stringify(mind)}'s portrait has no expression ${JSON.stringify(expression)}. It has ${Object.keys(
        known,
      )
        .map((k) => JSON.stringify(k))
        .join(", ")}.`,
    );
  }
  if (expression === undefined) {
    const { [mind]: _gone, ...rest } = faces.of;
    void _gone;
    faces.of = rest;
  } else faces.of = { ...faces.of, [mind]: expression };
}

/** An NPC's expression now, if they have one. */
export function expressionOf(npc: ObjectRef): string | undefined {
  return faces.of[mindFor(npc, "expressionOf").id];
}
_useExpressions(setExpression);

/** Initials for a portrait with no image: "B" for the butler, "MJ" for Mr Jenkins. */
function initials(name: string): string {
  const words = name
    .replace(/^(the|a|an)\s+/i, "")
    .split(/\s+/)
    .filter((w) => w !== "");
  return words
    .slice(0, 2)
    .map((w) => (w[0] ?? "").toUpperCase())
    .join("");
}

/** The cast as conversation mode shows it. @internal */
export function _cast(): readonly CastMember[] {
  const addressed = conversation.addressee?.id;
  return conversation.participants.map((body): CastMember => {
    const mind = mindOf(body);
    const name = typeof body.name === "string" ? body.name : body.id;
    const expression = mind ? faces.of[mind.id] : undefined;
    const p = mind ? portraits.get(mind.id) : undefined;
    const image = (expression !== undefined ? p?.expressions?.[expression] : undefined) ?? p?.image;
    return {
      id: body.id,
      name,
      initials: initials(name),
      addressed: body.id === addressed,
      ...(image !== undefined && { image }),
      ...(expression !== undefined && { expression }),
    };
  });
}

/** The suggested topics conversation mode offers: those not hidden, disabled ones with why. */
const offered = (): readonly { readonly topic: SuggestedTopic; readonly item: ActionListItem }[] =>
  suggestedTopics().flatMap((topic) => {
    const status = statusOf(topic.call);
    if (status.hidden !== undefined) return [];
    return [
      {
        topic,
        item: {
          label: topic.label,
          available: status.disabled === undefined,
          ...(status.disabled !== undefined && { reason: status.disabled }),
        },
      },
    ];
  });

widgets.register(
  "conversation-cast",
  castWidget({
    label: () => message("conversation.cast", {}),
    members: () => _cast(),
    address: (host, id) => {
      const who = conversation.participants.find((p) => p.id === id);
      if (who) host.act(_addressAction({ who }), who.name);
    },
  }),
  { source: SOURCE },
);
widgets.register(
  "conversation-topics",
  actionListWidget({
    label: () => message("conversation.topics", {}),
    items: () => offered().map((o) => o.item),
    take: (host, index) => {
      const chosen = offered()[index];
      if (chosen?.item.available) host.act(chosen.topic.call, chosen.topic.label);
    },
  }),
  { source: SOURCE },
);
layouts.register(
  "conversation",
  {
    // The room's prose above, as context; the cast beside what's said; the topics;
    // and the room's own links below, in a disclosure.
    regions: ["header", "context", "cast", "main", "topics", "more", "history"],
    sidebars: { cast: "start" },
    widgets: { cast: ["conversation-cast"], topics: ["conversation-topics"] },
    standardHeader: true,
    passage: {
      prose: "context",
      choices: "more",
      transcriptLabel: () => message("conversation.transcript", {}),
      // The story so far, at the very bottom.
      drawer: "history",
      choicesLabel: () => {
        const player = currentPlayerBody();
        return message("conversation.room", { room: player ? placeOf(player) : undefined });
      },
      // What's been said since the conversation started, as a transcript.
      transcriptSince: ({ record }) =>
        conversation.active
          ? record.events({ kinds: ["conversation"] }).findLast((e) => e.event === "started")?.seq
          : undefined,
    },
  },
  { source: SOURCE },
);

// --- NPCs starting conversations ---

/**
 * Has an NPC start a conversation with the player, for an agenda item's
 * `act`: if they're with the player, it starts one (or brings them into
 * the player's), says their opening line, opens a node if given, and
 * returns true, so `act` can call `done()`. Otherwise it returns false.
 * With `comes: true`, an NPC who isn't with the player takes a step toward
 * them first, through `stepToward`, and speaks the turn they arrive (#389).
 *
 * @example
 * ```ts
 * agenda(butler, "announce dinner", {
 *   act: ({ npc, done }) => {
 *     if (approach(npc, { says: "“Dinner is served, sir.”", comes: true })) done();
 *   },
 * });
 * ```
 */
export function approach(
  npc: ObjectRef,
  options: {
    readonly says?: string;
    readonly opens?: ConvNode;
    /** Whether they come to the player first, a step a turn, if they aren't together. */
    readonly comes?: boolean;
  } = {},
): boolean {
  const body = bodyOf(mindFor(npc, "approach"));
  const player = currentPlayerBody();
  const here = player ? placeOf(player) : undefined;
  if (!body || !here || !player) return false;
  if (placeOf(body)?.id !== here.id && options.comes === true) stepToward(npc, player);
  if (placeOf(body)?.id !== here.id) return false;
  if (!conversation.active) startConversation(npc);
  else if (!inConversationWith(npc)) joinConversation(npc);
  address(npc);
  if (options.says !== undefined) {
    emit("action-result", { text: options.says }, ["topic", `speaker:${body.id}`]);
  }
  if (options.opens) openNode(npc, options.opens);
  return true;
}

// --- The inspector's view (#119) ---

/** The conversation now, as the inspector's Conversation tab shows it. @internal */
export type _ConversationNow = {
  readonly active: boolean;
  /** Whether the player may leave: free, soft, or hard. */
  readonly exit: string;
  readonly participants: readonly {
    readonly id: string;
    readonly name: string;
    readonly addressed: boolean;
    /** Their open node, if any. */
    readonly node?: { readonly name: string; readonly restricts: boolean; readonly exit?: string };
  }[];
  /** Each lock, with who or what holds it, by name. */
  readonly locks: readonly {
    readonly level: string;
    readonly owner: string;
    readonly reason?: string;
  }[];
};

/** The conversation now, for the inspector. @internal */
export function _conversationNow(): _ConversationNow {
  const nameOf = (body: ObjectRef | undefined): string =>
    body ? t`{the x}`({ x: body }) : "someone";
  return {
    active: conversation.active,
    exit: conversation.exit,
    participants: conversation.participants.map((body) => {
      const node = openNodeOf(body);
      return {
        id: body.id,
        name: nameOf(body),
        addressed: body.id === conversation.addressee?.id,
        ...(node && {
          node: {
            name: node.name,
            restricts: node.restricts,
            ...(node.exit !== undefined && { exit: node.exit }),
          },
        }),
      };
    }),
    locks: conversation.locks.map((lock) => {
      const node = _nodeById(lock.by);
      const owner = node
        ? `${nameOf(bodyOf({ id: node.mind }))}'s node ${node.name}`
        : (() => {
            try {
              return nameOf(bodyOf({ id: lock.by }));
            } catch {
              return lock.by;
            }
          })();
      return {
        level: lock.level,
        owner,
        ...(lock.reason !== undefined && { reason: lock.reason }),
      };
    }),
  };
}

// The story log names speakers by their bodies' names: "Mira", "Maid" (#127).
nameSpeakers((id) => {
  const body = thingFor({ id });
  if (!body) return undefined;
  if (body.id === currentPlayerBody()?.id) return "You";
  const name = (body as { readonly name?: unknown }).name;
  return typeof name === "string" ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : undefined;
});
