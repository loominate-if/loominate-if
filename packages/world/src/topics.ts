/**
 * Topic entries (#111, ADR 0088), as adv3Lite has them: what an NPC says
 * when the player asks or tells them about something, answers yes or no,
 * greets them, or says goodbye. Each entry declares when it applies, by a
 * condition, an actor state, or a scene, and has a priority; when several
 * match, the highest priority wins, then the most specific, then the first
 * defined. The player talks through standard actions, so links, menus, and
 * the inspector all see them.
 */
import {
  _effectContext,
  _storyRunning,
  action,
  emit,
  hook,
  message,
  messages,
  object,
  randomStream,
  redirect,
  StateError,
  t,
  actLink,
  type ActionCall,
  type LinkNode,
  type ConditionArgument,
  type ObjectRef,
  type Passage,
  type Period,
  type StateId,
} from "@loominate-if/core";
import { reachNotNeeded } from "./acting.js";
import { allBodies, bodyOf, currentPlayerBody, isBody, mindFor, mindOf } from "./actors.js";
import {
  _endConversation,
  _lockedReason,
  _object,
  _objectsToLeaving,
  _whenLeaving,
  address,
  conversation,
  inConversationWith,
  joinConversation,
  startConversation,
  type LeftBy,
} from "./conversations.js";
import { _allNodes, _isNode, closeNode, openNode, openNodeOf, type ConvNode } from "./nodes.js";
import { _knowable, factNamed, player, type Fact } from "./knowledge.js";
import { clock } from "./clock.js";
import {
  _givingTopics,
  _showingTopics,
  accept,
  give,
  react,
  show,
  type ActingOn,
  type Offer,
  type Reaction,
} from "./standard.js";
import { isWithin, placeOf, thingFor } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** What an NPC with no entry for it says to being asked or told about something. `who` is their body. */
    "topic.noResponse": { readonly who: ObjectRef };
    /** Greeting an NPC with no hello entry. */
    "topic.hello": { readonly who: ObjectRef };
    /** Saying goodbye to an NPC with no bye entry. */
    "topic.bye": { readonly who: ObjectRef };
    /** Saying yes or no to an NPC with no entry for it. */
    "topic.noAnswer": { readonly who: ObjectRef };
    /** Why the player can't talk to something: it isn't someone. */
    "topic.notSomeone": { readonly who: ObjectRef };
    /** Why the player can't talk to someone: they aren't here. */
    "topic.notHere": { readonly who: ObjectRef };
    /** Why the player can't talk to themselves. */
    "topic.self": Record<never, never>;
    /** Why the player can't greet someone: they're already talking. */
    "topic.alreadyTalking": { readonly who: ObjectRef };
    /** Why the player can't say goodbye, yes, or no: they aren't in a conversation. */
    "topic.notTalking": Record<never, never>;
    /** Why the player can't ask about something: there's no such subject. */
    "topic.noSubject": { readonly about: string };
    /** The player's line when they ask: "You ask the maid about the gold." */
    "topic.player.ask": { readonly who: ObjectRef; readonly about: string };
    /** The player's line when they tell: "You tell the maid about the war." */
    "topic.player.tell": { readonly who: ObjectRef; readonly about: string };
    /** The player's line when they greet someone. */
    "topic.player.hello": { readonly who: ObjectRef };
    /** The player's line when they say goodbye. */
    "topic.player.bye": { readonly who: ObjectRef };
    /** The player's line when they say yes. */
    "topic.player.yes": { readonly who: ObjectRef };
    /** The player's line when they say no. */
    "topic.player.no": { readonly who: ObjectRef };
    /** The player's line when they show something: "You show the brooch to the maid." */
    "topic.player.show": { readonly who: ObjectRef; readonly thing: ObjectRef };
    /** The player's line when they give something: "You give the brooch to the maid." */
    "topic.player.give": { readonly who: ObjectRef; readonly thing: ObjectRef };
    /** Why the player can't ask or tell about a fact: they don't know it. */
    "topic.unknown": Record<never, never>;
    /** A suggested topic's link: "Ask about the gold". `about` is how the player refers to it. */
    "topic.suggest.ask": { readonly about: string };
    /** A suggested topic's link: "Tell about the war". */
    "topic.suggest.tell": { readonly about: string };
    /** The goodbye link among suggested topics. */
    "topic.suggest.bye": Record<never, never>;
    /** An open node's yes, among suggested topics. */
    "topic.suggest.yes": Record<never, never>;
    /** An open node's no, among suggested topics. */
    "topic.suggest.no": Record<never, never>;
    /** What an NPC with an open, restrictive node and no `presses` line says to a change of subject. */
    "topic.node.waits": { readonly who: ObjectRef };
    /** A suggested showing's link: "Show the photograph". */
    "topic.suggest.show": { readonly thing: ObjectRef };
    /** A suggested giving's link: "Give the locket". */
    "topic.suggest.give": { readonly thing: ObjectRef };
  }
}
const SOURCE = "@loominate-if/world";
const register = <K extends Parameters<typeof messages.register>[0]>(
  key: K,
  text: Parameters<typeof messages.register<K>>[1],
) => {
  messages.register(key, text, { source: SOURCE });
};
register("topic.noResponse", ({ who }) =>
  t`{The subj who} {has} nothing to say about that.`({ who }),
);
register("topic.hello", ({ who }) => t`{The subj who} {nods} to you.`({ who }));
register("topic.bye", ({ who }) => t`You take your leave of {the who}.`({ who }));
register("topic.noAnswer", ({ who }) => t`{The subj who} {wasn't} asking you anything.`({ who }));
register("topic.notSomeone", ({ who }) => t`You can't talk to {the who}.`({ who }));
register("topic.notHere", ({ who }) => t`{The subj who} {isn't} here.`({ who }));
register("topic.self", () => "Talking to yourself won't help.");
register("topic.alreadyTalking", ({ who }) => t`You're already talking to {the who}.`({ who }));
register("topic.notTalking", () => "You aren't talking to anyone.");
register("topic.player.ask", ({ who, about }) => t`You ask {the who} about ${about}.`({ who }));
register("topic.player.tell", ({ who, about }) => t`You tell {the who} about ${about}.`({ who }));
register("topic.player.hello", ({ who }) => t`You greet {the who}.`({ who }));
register("topic.player.bye", ({ who }) => t`You say goodbye to {the who}.`({ who }));
register("topic.player.yes", () => "You say yes.");
register("topic.player.no", () => "You say no.");
register("topic.player.show", ({ who, thing }) =>
  t`You show {the thing} to {the who}.`({ who, thing }),
);
register("topic.player.give", ({ who, thing }) =>
  t`You give {the thing} to {the who}.`({ who, thing }),
);
register("topic.unknown", () => "You don't know anything about that.");
register("topic.suggest.ask", ({ about }) => `Ask about ${about}`);
register("topic.suggest.tell", ({ about }) => `Tell about ${about}`);
register("topic.suggest.bye", () => "Say goodbye");
register("topic.suggest.yes", () => "Say yes");
register("topic.suggest.no", () => "Say no");
register("topic.node.waits", ({ who }) => t`{The subj who} {waits} for your answer.`({ who }));
register("topic.suggest.show", ({ thing }) => t`Show {the thing}`({ thing }));
register("topic.suggest.give", ({ thing }) => t`Give {the thing}`({ thing }));
register("topic.noSubject", ({ about }) => `There's no subject called ${JSON.stringify(about)}.`);

/** A named topic: something to talk about that isn't a thing or a fact, as the weather. */
export type Topic = ObjectRef & { readonly name: string };

/** A named topic's definition: its name, or its name and whether the player knows of it from the start. */
export type TopicDefinition = string | { readonly name: string; readonly known?: boolean };

/**
 * Defines named topics, things to talk about that aren't things in the world
 * or facts, in `story.ts`. Each is an object, `topic:` and its key. The
 * player knows of each from the start, so it's suggested, unless it says
 * `known: false`; then `player.learnAbout(topic)` teaches it.
 *
 * @example
 * ```ts
 * export const { weather, affair } = topics({
 *   weather: "the weather",
 *   affair: { name: "the affair", known: false },
 * });
 * ```
 */
export function topics<D extends Readonly<Record<string, TopicDefinition>>>(
  definitions: D,
): { readonly [K in keyof D]: Topic } {
  const made: Record<string, Topic> = {};
  for (const [key, d] of Object.entries(definitions)) {
    const { name, known = true } = typeof d === "string" ? { name: d } : d;
    const topic = object(`topic:${key}` as StateId, { name, isFamiliar: known }) as Topic;
    _knowable(topic);
    made[key] = topic;
  }
  return made as { readonly [K in keyof D]: Topic };
}

/** A catch-all subject: an entry for anything the NPC has no particular entry for. */
export const anything: { readonly anything: true } = Object.freeze({ anything: true });

/** What a topic entry is about: a thing, a named topic, a fact, or {@link anything}. */
export type Subject = ObjectRef | Fact | typeof anything;

// --- Actor states ---

/** An actor state, as adv3Lite's: on duty, off duty. Topics `in` one apply only while it's current. */
export type ActorState = {
  /** Its ID: the mind's, then its name, as `butler:mind:onDuty`. */
  readonly id: string;
  /** Its name, as given. */
  readonly name: string;
  /** The mind whose state it is. */
  readonly mind: string;
};

const actorStatesByMind = new Map<string, ActorState[]>();
const startingStates = new Map<string, string>();
const stateStore = object("world:actorStates", {
  /** Each mind's current state, by name, as changed in play. */
  current: {} as Record<string, string>,
});

/**
 * Gives an NPC named states, in `story.ts`, such as on duty and off duty:
 * their topics can apply in one only. Returns a handle for each, in order.
 *
 * @example
 * ```ts
 * const [onDuty, offDuty] = actorStates(butler, ["onDuty", "offDuty"], { starts: "onDuty" });
 * ```
 *
 * @throws StateError if the NPC already has states, or `starts` isn't one of them.
 */
export function actorStates<const N extends readonly string[]>(
  npc: ObjectRef,
  names: N,
  options: { readonly starts?: N[number] } = {},
): { readonly [I in keyof N]: ActorState } {
  const mind = mindFor(npc, "actorStates").id;
  const where = `actorStates ${JSON.stringify(mind)}`;
  if (actorStatesByMind.has(mind)) throw new StateError(`${where}: this NPC already has states.`);
  if (names.length === 0) throw new StateError(`${where}: give at least one state.`);
  if (new Set(names).size !== names.length)
    throw new StateError(`${where}: a state is named twice.`);
  if (options.starts !== undefined && !names.includes(options.starts)) {
    throw new StateError(
      `${where}: it starts in ${JSON.stringify(options.starts)}, which isn't one of its states.`,
    );
  }
  const made = names.map((name): ActorState => ({ id: `${mind}:${name}`, name, mind }));
  actorStatesByMind.set(mind, made);
  if (options.starts !== undefined) startingStates.set(mind, options.starts);
  return made as unknown as { readonly [I in keyof N]: ActorState };
}

/**
 * Changes an NPC's state. During play it's game state; in `story.ts`, it's
 * how they start.
 *
 * @throws StateError if the state isn't one of theirs.
 */
export function setActorState(npc: ObjectRef, to: ActorState): void {
  const mind = mindFor(npc, "setActorState").id;
  if (to.mind !== mind) {
    throw new StateError(
      `setActorState: ${JSON.stringify(to.id)} is another NPC's state, not ${JSON.stringify(mind)}'s.`,
    );
  }
  if (!_storyRunning()) startingStates.set(mind, to.name);
  else stateStore.current = { ...stateStore.current, [mind]: to.name };
}

/** An NPC's current state, or `undefined` if they have none, or haven't started in one. */
export function actorStateOf(npc: ObjectRef): ActorState | undefined {
  const mind = mindFor(npc, "actorStateOf").id;
  const name =
    _storyRunning() && Object.hasOwn(stateStore.current, mind)
      ? stateStore.current[mind]
      : startingStates.get(mind);
  return actorStatesByMind.get(mind)?.find((s) => s.name === name);
}

// --- Topic entries ---

/** What a topic entry's response is given, when it's a function. */
export type TopicContext = {
  /** The NPC answering, as their body. */
  readonly npc: ObjectRef;
  /** The subject asked or told about, if it's an ask or tell. */
  readonly about?: ObjectRef | Fact;
  /** For a goodbye: how the conversation ended for them, `goodbye` if the player said it. */
  readonly how?: LeftBy;
};

/** What the NPC says: text, or a function that can change state and returns the text, if any. */
export type Says = string | ((context: TopicContext) => string | undefined);

/** The order a list of responses is said in: see {@link TopicOptions.order}. */
export type ListOrder = "stop" | "cycle" | "shuffle";

const isList = (says: Says | readonly Says[]): says is readonly Says[] => Array.isArray(says);

/** When and how strongly a topic entry applies. */
export type TopicOptions = {
  /** What it says, or a list of responses, one each time it answers, in {@link TopicOptions.order}. */
  readonly says: Says | readonly Says[];
  /**
   * For a list: `stop`, the default, says each in turn, then the last again;
   * `cycle` goes back to the first; `shuffle` says each once a round, in a
   * random order, never starting a round with the one just said.
   */
  readonly order?: ListOrder;
  /** Only while this holds. */
  readonly when?: () => boolean;
  /** Only in this actor state of theirs, or while this scene is happening. */
  readonly in?: ActorState | Period | ConvNode;
  /** Higher wins among entries that match. Defaults to 0. */
  readonly priority?: number;
  /** Facts the player learns when it answers, from the NPC, as does everyone else in the conversation. */
  readonly reveals?: Fact | readonly Fact[];
  /** Whether it's suggested to the player, when they know its subject. Defaults to true. */
  readonly suggested?: boolean;
  /** For a `tell` about a fact: whether the NPC learns it, from the player. Defaults to true. */
  readonly informs?: boolean;
  /**
   * Only once the NPC has answered the same exchange before, by any entry:
   * the same kind, about the same subject. Among entries of the same
   * priority, it comes first, so it answers every time after the first.
   */
  readonly again?: boolean;
  /** A conversation node it opens after answering, as when the NPC asks a question. */
  readonly opens?: ConvNode;
  /** For an entry in a node: the node stays open after it answers. Otherwise it closes. */
  readonly stays?: boolean;
  /**
   * A cut scene the NPC tells after answering, as "hear me out": the player
   * goes to this passage, the conversation held, and its `{continue back}`
   * returns them to where they were talking.
   */
  readonly hearMeOut?: string;
  /** The NPC's expression after it answers, for their portrait: "stern". */
  readonly expression?: string;
  /** A stable ID for the entry, kept across edits, for saves and the inspector. Compiled topic blocks get one from their line. */
  readonly id?: string;
};

/** A topic entry: what kind of exchange it answers, and its options. */
export type TopicEntry = TopicOptions &
  (
    | { readonly ask: Subject }
    | { readonly tell: Subject }
    | { readonly askOrTell: Subject }
    | { readonly yes: true }
    | { readonly no: true }
    /** `implicit: true` only when talking starts without a greeting; `false` only for a greeting. Both if not given. */
    | { readonly hello: true; readonly implicit?: boolean }
    /** `implicit: true` only when the conversation ends without goodbye; `false` only for goodbye. Both if not given. */
    | { readonly bye: true; readonly implicit?: boolean }
    | { readonly show: ObjectRef | typeof anything }
    /** `takes: true` and they take what they're given; otherwise they keep their hands to themselves. */
    | { readonly give: ObjectRef | typeof anything; readonly takes?: boolean }
    | { readonly showOrGive: ObjectRef | typeof anything; readonly takes?: boolean }
  );

/** The kind of exchange the player makes. */
export type TopicKind = "ask" | "tell" | "yes" | "no" | "hello" | "bye" | "show" | "give";

type Entry = {
  readonly id: string;
  readonly mind: string;
  readonly kinds: readonly TopicKind[];
  /** The subject's key, `*` for anything, or undefined for kinds without one. */
  readonly subject?: string;
  /** What it's about, as given, to name it for the inspector. */
  readonly about?: Subject;
  readonly implicit?: boolean;
  /** For giving: whether they take it. */
  readonly takes?: boolean;
  /** A compiled topic block, which says its prose and runs its effects. */
  readonly block?: Passage;
  /** A compiled block's condition as written, with its parts, for the inspector. */
  readonly condition?: () => ConditionArgument;
  readonly index: number;
} & TopicOptions;

const entries = new Map<string, Entry[]>();

const isFact = (s: unknown): s is Fact =>
  typeof s === "object" && s !== null && "id" in s && factNamed((s as Fact).id) === s;

/** A subject's key: things and topics by ID, facts as `fact:` and theirs. */
function subjectKey(s: Subject): string {
  if (s === anything) return "*";
  if (isFact(s)) return `fact:${s.id}`;
  return (s as ObjectRef).id;
}

/** A subject as the inspector names it: "the letter", "the war", the fact “The letter is missing.” */
const nameOf = (s: Subject): string => {
  if (s === anything) return "anything";
  if (isFact(s)) return s.name ?? `the fact “${s.text}”`;
  const ref = s as ObjectRef;
  if (thingFor(ref)) return t`{the x}`({ x: ref });
  const name = (s as { readonly name?: unknown }).name;
  return typeof name === "string" ? name : ref.id;
};

const isPeriod = (x: ActorState | Period | ConvNode): x is Period => "isHappening" in x;
/** How specific an entry's context is: a scene over an actor state over the actor. */
const contextLevel = (e: Entry): number =>
  e.in === undefined ? 0 : _isNode(e.in) ? 3 : isPeriod(e.in) ? 2 : 1;

/**
 * Gives an NPC a topic entry, in `story.ts`: what they say when the player
 * asks or tells them about a subject, answers yes or no, greets them, or
 * says goodbye. When several match, the highest `priority` wins, then the
 * most specific (a scene's, then an actor state's, then the actor's; a
 * particular subject over {@link anything}), then the first defined.
 *
 * @example
 * ```ts
 * topic(butler, { ask: letter, says: "“I placed it on the desk myself, sir.”" });
 * topic(butler, { ask: letter, in: offDuty, priority: 5, says: "“Off the record? I took it.”" });
 * topic(butler, { askOrTell: anything, says: "“I couldn't say, sir.”" });
 * topic(butler, { bye: true, implicit: true, says: "The butler bows as you go." });
 * ```
 *
 * @throws StateError if `in` is another NPC's state, or the entry has no kind.
 */
export function topic(npc: ObjectRef, entry: TopicEntry): void {
  addEntry(npc, entry);
}

function addEntry(
  npc: ObjectRef,
  entry: TopicEntry,
  block?: Passage,
  condition?: () => ConditionArgument,
): void {
  const mind = mindFor(npc, "topic").id;
  const where = `topic for ${JSON.stringify(mind)}`;
  const e = entry as TopicOptions &
    Partial<Record<"ask" | "tell" | "askOrTell" | "show" | "give" | "showOrGive", Subject>> & {
      yes?: true;
      no?: true;
      hello?: true;
      bye?: true;
      implicit?: boolean;
      takes?: boolean;
    };
  const subjectOf = e.ask ?? e.tell ?? e.askOrTell ?? e.show ?? e.give ?? e.showOrGive;
  const kinds: TopicKind[] =
    e.show !== undefined
      ? ["show"]
      : e.give !== undefined
        ? ["give"]
        : e.showOrGive !== undefined
          ? ["show", "give"]
          : e.ask !== undefined
            ? ["ask"]
            : e.tell !== undefined
              ? ["tell"]
              : e.askOrTell !== undefined
                ? ["ask", "tell"]
                : e.yes
                  ? ["yes"]
                  : e.no
                    ? ["no"]
                    : e.hello
                      ? ["hello"]
                      : e.bye
                        ? ["bye"]
                        : [];
  if (kinds.length === 0) {
    throw new StateError(
      `${where}: say what it answers: ask, tell, askOrTell, show, give, showOrGive, yes, no, hello, or bye.`,
    );
  }
  if (isList(entry.says) && entry.says.length === 0) {
    throw new StateError(`${where}: its list of responses is empty. Give at least one.`);
  }
  if (entry.order !== undefined && !isList(entry.says)) {
    throw new StateError(
      `${where}: \`order\` is for a list of responses, but \`says\` is one. Give \`says\` a list, or leave out \`order\`.`,
    );
  }
  if (entry.order !== undefined && !["stop", "cycle", "shuffle"].includes(entry.order)) {
    throw new StateError(
      `${where}: the order is "stop", "cycle", or "shuffle", not ${JSON.stringify(entry.order)}.`,
    );
  }
  if ((e.show ?? e.give ?? e.showOrGive) !== undefined && isFact(subjectOf)) {
    throw new StateError(
      `${where}: a fact can't be shown or given. Show or give a thing, or anything.`,
    );
  }
  if (entry.in && !isPeriod(entry.in) && entry.in.mind !== mind) {
    if (_isNode(entry.in))
      throw new StateError(`${where}: ${JSON.stringify(entry.in.id)} is another NPC's node.`);
    throw new StateError(`${where}: ${JSON.stringify(entry.in.id)} is another NPC's state.`);
  }
  const list = entries.get(mind) ?? [];
  const subject = subjectOf === undefined ? undefined : subjectKey(subjectOf);
  const id =
    entry.id ??
    `${mind}:${kinds.join("|")}${subject === undefined ? "" : `:${subject}`}#${String(list.length + 1)}`;
  if (list.some((other) => other.id === id)) {
    throw new StateError(
      `${where}: another entry has the ID ${JSON.stringify(id)}. Give each its own.`,
    );
  }
  list.push({
    ...entry,
    ...(block && { block }),
    ...(condition && { condition }),
    id,
    mind,
    kinds,
    ...(subjectOf !== undefined && { subject: subjectKey(subjectOf), about: subjectOf }),
    ...(e.implicit !== undefined && { implicit: e.implicit }),
    ...(e.takes !== undefined && { takes: e.takes }),
    index: list.length,
  });
  entries.set(mind, list);
}

/** How often entries and exchanges have been answered: game state. */
const counts = object("world:topicCounts", {
  /** Times each entry has answered, by entry ID. */
  entries: {} as Record<string, number>,
  /** Times each exchange has been answered by any entry, by mind, kind, and subject. */
  exchanges: {} as Record<string, number>,
});
const exchangeKey = (mind: string, kind: TopicKind, subject: string | undefined): string =>
  `${mind}|${kind}|${subject ?? ""}`;

/** Why an entry doesn't answer, or `undefined` if it matches. */
function whyNot(
  e: Entry,
  kind: TopicKind,
  subject: string | undefined,
  implicit: boolean,
): string | undefined {
  if (!e.kinds.includes(kind)) return "It answers something else.";
  if (subject !== undefined && e.subject !== "*" && e.subject !== subject)
    return "It's about something else.";
  if (e.again === true && (counts.exchanges[exchangeKey(e.mind, kind, subject)] ?? 0) === 0) {
    return "It's for when this has been answered before.";
  }
  if (e.implicit !== undefined && e.implicit !== implicit) {
    return e.implicit ? "It's only for when nothing was said." : "It's only for when it's said.";
  }
  if (e.in) {
    if (_isNode(e.in)) {
      if (openNodeOf({ id: e.mind })?.id !== e.in.id) return `Its node, ${e.in.name}, isn't open.`;
    } else if (isPeriod(e.in)) {
      if (!e.in.isHappening) return `Its scene, ${e.in.name ?? e.in.id}, isn't happening.`;
    } else if (actorStateOf({ id: e.mind })?.id !== e.in.id) {
      return `Its actor state, ${e.in.name}, isn't current.`;
    }
  }
  if (e.when && !e.when()) return "Its condition is false.";
  return undefined;
}

/** How an entry fared in matching, for the inspector. */
export type TopicCandidate = {
  /** The entry's ID: the mind, kinds, subject, and its number among theirs. */
  readonly id: string;
  /** Whether it answers. */
  readonly wins: boolean;
  /** Why not, if it doesn't: its condition, state, or scene, or which entry beat it. */
  readonly why?: string;
  readonly priority: number;
};

/** Ranks matching entries: priority, then context, then particular subject, then order. */
const rank = (a: Entry, b: Entry): number =>
  (b.priority ?? 0) - (a.priority ?? 0) ||
  Number(b.again === true) - Number(a.again === true) ||
  contextLevel(b) - contextLevel(a) ||
  Number(b.subject !== "*") - Number(a.subject !== "*") ||
  a.index - b.index;

/** Which entry answers an exchange, and how each fared. */
function match(
  npc: ObjectRef,
  kind: TopicKind,
  about: ObjectRef | Fact | undefined,
  implicit: boolean,
): { readonly winner: Entry | undefined; readonly candidates: readonly TopicCandidate[] } {
  const mind = mindFor(npc, "matchTopic").id;
  const subject = about === undefined ? undefined : subjectKey(about);
  const relevant = (entries.get(mind) ?? []).filter((e) => e.kinds.includes(kind));
  const reasons = new Map(relevant.map((e) => [e, whyNot(e, kind, subject, implicit)] as const));
  const winner = relevant.filter((e) => reasons.get(e) === undefined).sort(rank)[0];
  return {
    winner,
    candidates: relevant.map((e) => ({
      id: e.id,
      wins: e === winner,
      priority: e.priority ?? 0,
      ...(e !== winner && {
        why: reasons.get(e) ?? `Outranked by ${winner?.id ?? "another entry"}.`,
      }),
    })),
  };
}

/**
 * Which of an NPC's entries answers an exchange, by ID, and why each other
 * doesn't: deterministic, and what the inspector shows. @internal
 */
export function _matchTopic(
  npc: ObjectRef,
  kind: TopicKind,
  about?: ObjectRef | Fact,
  implicit = false,
): { readonly winner: string | undefined; readonly candidates: readonly TopicCandidate[] } {
  const { winner, candidates } = match(npc, kind, about, implicit);
  return { winner: winner?.id, candidates };
}

/** Every topic entry of an NPC's, as the inspector lists them. @internal */
export function _topicEntries(npc: ObjectRef): readonly {
  readonly id: string;
  readonly kinds: readonly TopicKind[];
  readonly subject?: string;
  readonly subjectName?: string;
}[] {
  return (entries.get(mindFor(npc, "topicEntries").id) ?? []).map((e) => ({
    id: e.id,
    kinds: e.kinds,
    ...(e.about !== undefined && { subject: e.subject, subjectName: nameOf(e.about) }),
  }));
}

/** A stand-in subject no entry names, so only catch-alls match it. */
const SOMETHING_ELSE: ObjectRef = Object.freeze({ id: "$something-else" });

const VERBS: Record<TopicKind, string> = {
  ask: "Ask",
  tell: "Tell",
  yes: "Say yes to",
  no: "Say no to",
  hello: "Greet",
  bye: "Say goodbye to",
  show: "Show",
  give: "Give",
};

/**
 * Each topic entry of those the player is talking to, or, if they aren't,
 * of those here: whether it would answer now, and if not, why. What the
 * inspector's Choices tab shows. @internal
 */
export function _topicExplanations(): readonly {
  readonly label: string;
  readonly available: boolean;
  readonly why?: string;
}[] {
  const player = currentPlayerBody();
  const here = player ? placeOf(player) : undefined;
  const people = conversation.active
    ? conversation.participants
    : allBodies().filter(
        (b) => b.id !== player?.id && here !== undefined && placeOf(b)?.id === here.id,
      );
  return people.flatMap((body) => {
    const mind = mindOf(body);
    if (!mind) return [];
    return (entries.get(mind.id) ?? []).map((e) => {
      const { label, answers } = inspectEntry(body, e);
      return {
        label: `${label} (${e.id})`,
        available: answers.now,
        ...(answers.why !== undefined && { why: answers.why }),
      };
    });
  });
}

/** An entry as the inspector names it, and whether it would answer now, and why not. */
function inspectEntry(
  body: ObjectRef,
  e: Entry,
): { readonly label: string; readonly answers: { readonly now: boolean; readonly why?: string } } {
  const who = t`{the x}`({ x: body });
  const kind = e.kinds[0] ?? "ask";
  const about =
    e.about === undefined
      ? undefined
      : e.about === anything
        ? SOMETHING_ELSE
        : (e.about as ObjectRef | Fact);
  const handed = kind === "show" || kind === "give";
  const verb = e.kinds.length > 1 ? (handed ? "Show or give" : "Ask or tell") : VERBS[kind];
  const subjectName =
    e.about === undefined ? "" : e.about === anything ? "anything else" : nameOf(e.about);
  const when = e.implicit === true ? ", unprompted" : e.implicit === false ? ", in words" : "";
  const c = match(body, kind, about, e.implicit ?? false).candidates.find((x) => x.id === e.id);
  // A restrictive node holds up everything but its own replies.
  const node = openNodeOf(body);
  const held = c?.wins === true && node?.restricts === true && !unheld(kind) && e.in !== node;
  const label = handed
    ? `${verb} ${subjectName} to ${who}`
    : `${verb} ${who}${e.about === undefined ? "" : ` about ${subjectName}`}${when}`;
  const why = held
    ? `Its node, ${node.name}, is open and restrictive, so the NPC presses the point instead.`
    : c?.why;
  return {
    label,
    answers: { now: (c?.wins ?? false) && !held, ...(why !== undefined && { why }) },
  };
}

/**
 * Every topic entry, as coverage reports (#133) need them: what it's about,
 * the node it opens or applies in, its label, and how often it's answered in
 * the game in play. @internal
 */
export function _coverageEntries(): readonly {
  readonly id: string;
  readonly label: string;
  readonly kinds: readonly TopicKind[];
  /** The subject's key: `fact:` and its ID for a fact. */
  readonly subject?: string;
  readonly opens?: ConvNode;
  readonly in?: ConvNode;
  readonly answered: number;
}[] {
  return [...entries].flatMap(([mind, list]) => {
    const body = allBodies().find((b) => mindOf(b)?.id === mind);
    return list.map((e) => ({
      id: e.id,
      label: body ? inspectEntry(body, e).label : `${e.kinds.join(" or ")} (${mind})`,
      kinds: e.kinds,
      ...(e.subject !== undefined && { subject: e.subject }),
      ...(e.opens !== undefined && { opens: e.opens }),
      ...(e.in !== undefined && _isNode(e.in) && { in: e.in }),
      answered: counts.entries[e.id] ?? 0,
    }));
  });
}

/** A topic entry as the inspector's Conversation tab shows it. @internal */
export type _TopicRow = {
  readonly id: string;
  /** What it answers, as "Ask the maid about the gold". */
  readonly label: string;
  /** Where it applies: an actor state, a scene, or a node. */
  readonly scope?: string;
  readonly priority: number;
  /** Its other options, as written: `again`, `stays`, `opens: tea`, `reveals: …`. */
  readonly flags: readonly string[];
  /** Its condition as written, its value now (or what it threw), and its parts' values. */
  readonly condition?: {
    readonly text: string;
    readonly value: boolean | string;
    readonly parts?: readonly {
      readonly text: string;
      readonly value?: unknown;
      readonly error?: string;
    }[];
  };
  /** Whether it would answer now, and why not. */
  readonly answers: { readonly now: boolean; readonly why?: string };
  /** Whether it's suggested to the player now, and why not. */
  readonly suggested: { readonly now: boolean; readonly why?: string };
};

/** An entry's condition, for the inspector: a block's as written, or a function's source. */
function conditionOf(e: Entry): _TopicRow["condition"] {
  if (e.condition) {
    try {
      const c = e.condition();
      return { text: c.text, value: c.value, ...(c.parts && { parts: c.parts() }) };
    } catch (error) {
      return { text: "(when)", value: error instanceof Error ? error.message : String(error) };
    }
  }
  if (!e.when) return undefined;
  const text = e.when.toString().replace(/^\(\)\s*=>\s*/, "");
  try {
    return { text, value: e.when() };
  } catch (error) {
    return { text, value: error instanceof Error ? error.message : String(error) };
  }
}

/** Why an entry isn't suggested now, or `undefined` if it is. */
function whyNotSuggested(body: ObjectRef, e: Entry): string | undefined {
  const kind = e.kinds[0] ?? "ask";
  if (kind === "hello" || kind === "bye") {
    return "Greetings and goodbyes aren't suggested as topics; Say goodbye always is.";
  }
  if (conversation.addressee?.id !== body.id) {
    return conversation.active && inConversationWith(body)
      ? "Topics are suggested for the one the player is addressing, and that's someone else."
      : "The player isn't talking to them.";
  }
  const node = openNodeOf(body);
  if (kind === "yes" || kind === "no") {
    if (!node || e.in !== node) return "Yes and no are suggested only as replies in an open node.";
    const { winner } = match(body, kind, undefined, false);
    if (winner !== e) return `Another entry answers it: ${winner?.id ?? "none"}.`;
    return e.suggested === false ? "It says suggested: false." : undefined;
  }
  if (e.about === anything) {
    return "Catch-alls aren't suggested; they answer whatever has no entry of its own.";
  }
  if (e.suggested === false) return "It says suggested: false.";
  const about = e.about as ObjectRef | Fact;
  if ((kind === "ask" || kind === "tell") && !knownToPlayer(about)) {
    return `The player doesn't know of ${isFact(about) ? (about.name ?? `the fact “${about.text}”`) : nameOf(about)}.`;
  }
  if (kind === "show" || kind === "give") {
    const carrier = currentPlayerBody();
    const thing = about as ObjectRef;
    if (!carrier || !thingFor(thing) || !isWithin(thing, carrier)) {
      return `The player isn't carrying ${nameOf(thing)}.`;
    }
  }
  const { winner, candidates } = match(body, kind, about, false);
  if (winner !== e) {
    // When only a catch-all would answer, what matters is why this entry doesn't.
    return winner && winner.subject !== "*"
      ? `Another entry answers it: ${winner.id}.`
      : `It wouldn't answer now: ${candidates.find((c) => c.id === e.id)?.why ?? "it doesn't match"}`;
  }
  if (node?.restricts === true && e.in !== node) {
    return `The node ${node.name} is open and restrictive, so only its replies are suggested.`;
  }
  return undefined;
}

/** A scope as the inspector says it. */
function scopeOf(e: Entry): string | undefined {
  if (!e.in) return undefined;
  if (_isNode(e.in)) return `in the node ${e.in.name}`;
  if (isPeriod(e.in)) return `while ${e.in.name ?? e.in.id} is happening`;
  return `in the actor state ${e.in.name}`;
}

/** Every entry an NPC has, for the inspector's Conversation tab. @internal */
export function _topicRows(npc: ObjectRef): readonly _TopicRow[] {
  const body = bodyOf(mindFor(npc, "topicRows"));
  if (!body) return [];
  return (entries.get(mindFor(npc, "topicRows").id) ?? []).map((e): _TopicRow => {
    const { label, answers } = inspectEntry(body, e);
    const reveals = e.reveals === undefined ? [] : isFactList(e.reveals) ? e.reveals : [e.reveals];
    const flags = [
      ...(e.again === true ? ["again"] : []),
      ...(e.stays === true ? ["stays"] : []),
      ...(e.takes === true ? ["takes"] : []),
      ...(e.opens ? [`opens: ${e.opens.name}`] : []),
      ...(e.hearMeOut !== undefined ? [`hear me out: ${e.hearMeOut}`] : []),
      ...(e.expression !== undefined ? [`expression: ${e.expression}`] : []),
      ...reveals.map((f) => `reveals: ${f.id}`),
      ...(e.informs === false ? ["informs: false"] : []),
      ...(e.suggested === false ? ["suggested: false"] : []),
    ];
    const condition = conditionOf(e);
    const why = whyNotSuggested(body, e);
    const scope = scopeOf(e);
    return {
      id: e.id,
      label,
      ...(scope !== undefined && { scope }),
      priority: e.priority ?? 0,
      flags,
      ...(condition !== undefined && { condition }),
      answers,
      suggested: { now: why === undefined, ...(why !== undefined && { why }) },
    };
  });
}

/** The NPCs with topic entries, by body, for the inspector's character picker. @internal */
export function _topicCharacters(): readonly ObjectRef[] {
  return [...entries.keys()].flatMap((mind) => {
    const body = bodyOf({ id: mind });
    return body ? [body] : [];
  });
}

/** How far each entry's list has got, by entry ID: game state. */
const lists = object("world:topicLists", {
  /** How many times each list has answered. */
  said: {} as Record<string, number>,
  /** For a shuffled list, what's left of this round, as positions in the list. */
  deck: {} as Record<string, number[]>,
  /** For a shuffled list, the position said last. */
  last: {} as Record<string, number>,
});
const shuffling = randomStream("world:topics");

/** Which response of a list answers now, moving the list on. */
function nextOf(e: Entry, count: number): number {
  const said = lists.said[e.id] ?? 0;
  lists.said = { ...lists.said, [e.id]: said + 1 };
  if (e.order === "cycle") return said % count;
  if (e.order !== "shuffle") return Math.min(said, count - 1);
  let deck = lists.deck[e.id] ?? [];
  if (deck.length === 0) {
    deck = shuffling.substream(e.id).shuffle([...Array(count).keys()]);
    // A new round doesn't start with the one just said.
    const last = lists.last[e.id];
    if (count > 1 && deck[0] === last) [deck[0], deck[1]] = [deck[1] as number, deck[0] as number];
  }
  const [chosen = 0, ...rest] = deck;
  lists.deck = { ...lists.deck, [e.id]: rest };
  lists.last = { ...lists.last, [e.id]: chosen };
  return chosen;
}

function respond(e: Entry, context: TopicContext): void {
  if (e.expression !== undefined) _setExpression(context.npc, e.expression);
  if (e.block) {
    sayBlock(e, e.block, context.npc);
    return;
  }
  const says = Array.isArray(e.says)
    ? (e.says as readonly Says[])[nextOf(e, e.says.length)]
    : (e.says as Says);
  const text = says === undefined ? undefined : typeof says === "string" ? says : says(context);
  if (typeof text === "string" && text !== "") say(text, context.npc);
  const revealed = e.reveals === undefined ? [] : isFactList(e.reveals) ? e.reveals : [e.reveals];
  if (revealed.length === 0) return;
  // Everyone in the conversation hears it: the player, and the others in it.
  const hearers = [
    player,
    ...conversation.participants.flatMap((b) => {
      const m = mindOf(b);
      return m && m.id !== e.mind ? [m] : [];
    }),
  ];
  for (const f of revealed) for (const h of hearers) h.learn(f, { from: context.npc });
}

const isFactList = (x: Fact | readonly Fact[]): x is readonly Fact[] => Array.isArray(x);

/**
 * Says a compiled topic block: its effects, `{on first visit: …}` the first
 * time it answers and `{on enter: …}` every time, then its prose, each
 * paragraph with its line.
 */
function sayBlock(e: Entry, block: Passage, npc: ObjectRef): void {
  const times = counts.entries[e.id] ?? 1;
  const context = { ..._effectContext(block.id), visits: times, firstVisit: times === 1 };
  if (times === 1) block.effects?.firstVisit?.(context);
  block.effects?.enter?.(context);
  for (const node of block.body(context)) {
    if (node.type !== "text" || node.text.trim() === "") continue;
    emit(
      "action-result",
      {
        text: node.text,
        ...(node.styles !== undefined && node.styles.length > 0 && { styles: node.styles }),
        ...(node.line !== undefined && { line: node.line }),
      },
      ["topic", `speaker:${npc.id}`],
    );
  }
}

const say = (text: string, npc: ObjectRef): void => {
  emit("action-result", { text }, ["topic", `speaker:${npc.id}`]);
};

/** The player's side of an exchange, recorded as their line, tagged `player`, for the transcript. */
const playerSays = (text: string): void => {
  const me = currentPlayerBody();
  emit("action-result", { text }, ["topic", "player", ...(me ? [`speaker:${me.id}`] : [])]);
};

/** Runs the winning entry, or says `fallback` if none matches. */
function answer(
  who: ObjectRef,
  kind: TopicKind,
  options: { about?: ObjectRef | Fact; implicit?: boolean; how?: LeftBy },
  fallback: string | undefined,
): Entry | undefined {
  const { winner } = match(who, kind, options.about, options.implicit ?? false);
  const node = openNodeOf(who);
  if (pressed(who, kind, node, winner)) return undefined;
  if (winner) {
    const key = exchangeKey(
      winner.mind,
      kind,
      options.about === undefined ? undefined : subjectKey(options.about),
    );
    counts.entries = { ...counts.entries, [winner.id]: (counts.entries[winner.id] ?? 0) + 1 };
    counts.exchanges = { ...counts.exchanges, [key]: (counts.exchanges[key] ?? 0) + 1 };
    respond(winner, {
      npc: who,
      ...(options.about !== undefined && { about: options.about }),
      ...(options.how !== undefined && { how: options.how }),
    });
  } else if (fallback !== undefined) say(fallback, who);
  afterNode(who, kind, node, winner);
  if (winner?.hearMeOut !== undefined) redirect(winner.hearMeOut);
  return winner;
}

/** Exchanges a node never holds up: greeting and goodbye. */
const unheld = (kind: TopicKind): boolean => kind === "hello" || kind === "bye";

/**
 * Whether a restrictive node holds the exchange up: it isn't one of the
 * node's own replies, so the NPC presses the point instead of answering.
 */
function pressed(
  who: ObjectRef,
  kind: TopicKind,
  node: ConvNode | undefined,
  winner: Entry | undefined,
): boolean {
  if (!node?.restricts || unheld(kind) || winner?.in === node) return false;
  pressPoint(who, node);
  return true;
}

/** After an answer: a node reply closes its node, an entry may open one, and an open node presses the point. */
function afterNode(
  who: ObjectRef,
  kind: TopicKind,
  node: ConvNode | undefined,
  winner: Entry | undefined,
): void {
  if (node && winner?.in === node && winner.stays !== true) closeNode(who);
  else if (node && !unheld(kind) && winner?.in !== node && node.presses !== undefined)
    pressPoint(who, node);
  if (winner?.opens) openNode(who, winner.opens);
}

/** The NPC presses the point of their open node. */
function pressPoint(who: ObjectRef, node: ConvNode): void {
  const text = typeof node.presses === "function" ? node.presses() : node.presses;
  say(text ?? message("topic.node.waits", { who }), who);
}

// --- The player's side ---

/** The subject an `ask` or `tell` names: a thing or topic, or a fact by its ID. */
function subjectFrom(about: ObjectRef | string): ObjectRef | Fact | undefined {
  return typeof about === "string" ? factNamed(about) : about;
}

/** Why the player can't talk to `who` now, or `undefined`. */
function cantTalkTo(who: ObjectRef): string | undefined {
  const player = currentPlayerBody();
  if (who.id === player?.id) return message("topic.self", {});
  if (!isBody(who) || !mindOf(who)) return message("topic.notSomeone", { who });
  const here = player ? placeOf(player) : undefined;
  if (!here || placeOf(who)?.id !== here.id) return message("topic.notHere", { who });
  return undefined;
}

/** Talks to `who`: into the conversation, addressed, with an implicit hello if it starts now. */
function turnTo(who: ObjectRef): void {
  if (!conversation.active) {
    startConversation(who);
    answer(who, "hello", { implicit: true }, undefined);
  } else if (!inConversationWith(who)) {
    joinConversation(who);
    address(who);
    answer(who, "hello", { implicit: true }, undefined);
  } else address(who);
}

/** How long each exchange takes on the game clock, in minutes. */
const EXCHANGE_MINUTES = 1;

const talk = (kind: "ask" | "tell") =>
  action<{ who: ObjectRef; about: ObjectRef | string }>(kind, {
    source: SOURCE,
    verbs:
      kind === "ask"
        ? ["ask {who} about {about}", "ask {who} {about}", "question {who} about {about}"]
        : ["tell {who} about {about}", "inform {who} about {about}"],
    minutes: EXCHANGE_MINUTES,
    verify: ({ who, about }) => {
      const subject = subjectFrom(about);
      if (subject === undefined) return message("topic.noSubject", { about: String(about) });
      if (isFact(subject) && !player.knows(subject)) return message("topic.unknown", {});
      return cantTalkTo(who);
    },
    run: ({ who, about }) => {
      const subject = subjectFrom(about);
      if (subject !== undefined) {
        playerSays(
          message(kind === "ask" ? "topic.player.ask" : "topic.player.tell", {
            who,
            about: playerName(subject),
          }),
        );
      }
      turnTo(who);
      const winner = answer(
        who,
        kind,
        subject === undefined ? {} : { about: subject },
        message("topic.noResponse", { who }),
      );
      // Telling someone a fact teaches it to them, unless the entry says otherwise.
      const mind = mindOf(who);
      if (kind === "tell" && isFact(subject) && mind && winner?.informs !== false) {
        const from = currentPlayerBody();
        mind.learn(subject, from ? { from } : {});
      }
    },
  });

/**
 * Asks someone about a subject: a thing, a named topic, or a fact by its ID.
 * It starts a conversation with them if need be, with any implicit hello.
 * Each exchange takes a minute.
 *
 * @example
 * ```ts
 * ask({ who: butler, about: letter })
 * ask({ who: butler, about: facts.missingLetter.id })
 * ```
 */
export const ask = talk("ask");

/** Tells someone about a subject, as {@link ask} asks. */
export const tell = talk("tell");

/** Greets someone, starting a conversation with them, with their hello entry. */
export const hello = action<{ who: ObjectRef }>("hello", {
  source: SOURCE,
  verbs: ["greet {who}", "say hello to {who}", "talk to {who}"],
  minutes: EXCHANGE_MINUTES,
  verify: ({ who }) => cantTalkTo(who),
  check: ({ who }) =>
    inConversationWith(who) ? message("topic.alreadyTalking", { who }) : undefined,
  run: ({ who }) => {
    playerSays(message("topic.player.hello", { who }));
    if (!conversation.active) startConversation(who);
    else {
      joinConversation(who);
      address(who);
    }
    answer(who, "hello", { implicit: false }, message("topic.hello", { who }));
  },
});

/** Says goodbye, ending the conversation, with the addressee's bye entry. */
export const goodbye = action<Record<never, never>>("goodbye", {
  source: SOURCE,
  verbs: ["goodbye", "bye", "say goodbye"],
  minutes: EXCHANGE_MINUTES,
  verify: () => (conversation.active ? undefined : message("topic.notTalking", {})),
  // A hard lock keeps the player in the conversation (#117).
  check: () => _lockedReason(),
  run: () => {
    // A soft lock meets the first goodbye with an objection; the next insists.
    if (_objectsToLeaving()) {
      _object();
      return;
    }
    const who = conversation.addressee;
    if (who) playerSays(message("topic.player.bye", { who }));
    if (who) answer(who, "bye", { implicit: false, how: "goodbye" }, message("topic.bye", { who }));
    _endConversation("goodbye");
  },
});

const answerWith = (kind: "yes" | "no") =>
  action<Record<never, never>>(kind, {
    source: SOURCE,
    verbs: kind === "yes" ? ["yes", "say yes"] : ["no", "say no"],
    minutes: EXCHANGE_MINUTES,
    verify: () => (conversation.active ? undefined : message("topic.notTalking", {})),
    run: () => {
      const who = conversation.addressee;
      if (!who) return;
      playerSays(message(kind === "yes" ? "topic.player.yes" : "topic.player.no", { who }));
      answer(who, kind, {}, message("topic.noAnswer", { who }));
    },
  });

/** Answers yes to the addressee. */
export const yes = answerWith("yes");

/** Answers no to the addressee. */
export const no = answerWith("no");

// Talking needs them here, not in reach, and a subject can be anywhere.
reachNotNeeded(ask, "who", "about");
reachNotNeeded(tell, "who", "about");
reachNotNeeded(hello, "who");

// An NPC leaving the conversation without goodbye says their implicit bye.
_whenLeaving((mind, how) => {
  if (how === "goodbye") return;
  const body = bodyOf({ id: mind });
  if (body) answer(body, "bye", { implicit: true, how }, undefined);
});

// --- Suggestions ---

/** A subject as the player refers to it: "the gold", "the weather", "the missing letter". */
function playerName(s: ObjectRef | Fact): string {
  if (isFact(s)) return s.name ?? `“${s.text}”`;
  return nameOf(s);
}

/** Whether the player knows a subject: a fact they know, or a thing or topic they know of. */
const knownToPlayer = (s: ObjectRef | Fact): boolean =>
  isFact(s) ? player.knows(s) : player.knowsAbout(s);

/** A suggested topic: its label, and the action that takes it. */
export type SuggestedTopic = {
  /** The link's label, as "Ask about the gold". */
  readonly label: string;
  /** The action: `ask`, `tell`, or `goodbye`. */
  readonly call: ActionCall<Readonly<Record<string, unknown>>>;
};

/**
 * The topics to suggest to the player now, for the person they're talking
 * to: each subject they have an entry for that would answer, which the
 * player knows, in the order the entries were defined, then goodbye. A
 * catch-all isn't suggested, nor an entry with `suggested: false`. Empty
 * when the player isn't talking to anyone.
 */
export function suggestedTopics(): readonly SuggestedTopic[] {
  const who = conversation.addressee;
  const mind = who && mindOf(who);
  if (!who || !mind) return [];
  const out: SuggestedTopic[] = [];
  const done = new Set<string>();
  const node = openNodeOf(who);
  // While a restrictive node is open, only its own replies are suggested.
  const allowed = (winner: Entry): boolean => !node?.restricts || winner.in === node;
  // An open node's yes and no come first, as answers to its question.
  if (node) {
    for (const kind of ["yes", "no"] as const) {
      const { winner } = match(who, kind, undefined, false);
      if (winner?.in !== node || winner.suggested === false) continue;
      out.push({
        label: message(kind === "yes" ? "topic.suggest.yes" : "topic.suggest.no", {}),
        call: (kind === "yes" ? yes : no)({}) as unknown as SuggestedTopic["call"],
      });
    }
  }
  for (const e of entries.get(mind.id) ?? []) {
    if (e.about === undefined || e.about === anything) continue;
    const about = e.about as ObjectRef | Fact;
    for (const kind of e.kinds) {
      if (kind !== "ask" && kind !== "tell") continue;
      const key = `${kind}|${e.subject ?? ""}`;
      if (done.has(key) || !knownToPlayer(about)) continue;
      const { winner } = match(who, kind, about, false);
      if (!winner || winner.subject === "*" || winner.suggested === false || !allowed(winner))
        continue;
      done.add(key);
      const arg = isFact(about) ? about.id : about;
      out.push({
        label: message(kind === "ask" ? "topic.suggest.ask" : "topic.suggest.tell", {
          about: playerName(about),
        }),
        call: (kind === "ask" ? ask : tell)({
          who,
          about: arg,
        }) as unknown as SuggestedTopic["call"],
      });
    }
  }
  // What the player carries that they have something particular to say about.
  const carrier = currentPlayerBody();
  for (const e of entries.get(mind.id) ?? []) {
    if (e.about === undefined || e.about === anything || !carrier) continue;
    const thing = e.about as ObjectRef;
    if (isFact(thing) || !thingFor(thing) || !isWithin(thing, carrier)) continue;
    for (const kind of e.kinds) {
      if (kind !== "show" && kind !== "give") continue;
      const key = `${kind}|${e.subject ?? ""}`;
      if (done.has(key)) continue;
      const { winner } = match(who, kind, thing, false);
      if (!winner || winner.subject === "*" || winner.suggested === false || !allowed(winner))
        continue;
      done.add(key);
      out.push({
        label: message(kind === "show" ? "topic.suggest.show" : "topic.suggest.give", { thing }),
        call: (kind === "show" ? show : give)({
          thing: thingFor(thing) as ActingOn,
          to: who as ActingOn,
        }) as unknown as SuggestedTopic["call"],
      });
    }
  }
  out.push({
    label: message("topic.suggest.bye", {}),
    call: goodbye({}) as unknown as SuggestedTopic["call"],
  });
  return out;
}

let linksHidden = (): boolean => false;
/** Hides `{topics}`'s links while `hidden` says, as conversation mode does. @internal */
export function _hideTopicLinksWhen(hidden: () => boolean): void {
  linksHidden = hidden;
}

/** Expressions entries set, through conversation mode's portraits. */
let _setExpression = (npc: ObjectRef, expression: string): void => {
  void npc;
  void expression;
};
/** How an entry's `expression` is set, from conversation mode. @internal */
export function _useExpressions(set: (npc: ObjectRef, expression: string) => void): void {
  _setExpression = set;
}

/** Turns to someone already in the conversation, as choosing their portrait does. @internal */
export const _addressAction = action<{ who: ObjectRef }>("address", {
  source: SOURCE,
  verify: ({ who }) => (inConversationWith(who) ? undefined : message("topic.notTalking", {})),
  run: ({ who }) => {
    address(who);
  },
});

/**
 * What `{topics}` shows: a link for each suggested topic, as
 * {@link suggestedTopics} gives them, each taking its action.
 */
export function topicLinks(args: Readonly<Record<string, never>> = {}): LinkNode[] {
  void args; // `{topics}` takes no arguments; directives pass them as an object.
  // While conversation mode shows the topics, the passage doesn't list them again.
  if (linksHidden()) return [];
  return suggestedTopics().map((s): LinkNode => ({
    type: "link",
    label: s.label,
    target: s.label,
    guard: actLink({ call: s.call }),
  }));
}

// --- Showing and giving ---

/**
 * Answers the player showing or giving something with a topic entry, after
 * the game's own `giving` and `showing` rules and before the default
 * refusal. The NPC joins the conversation, and it takes the usual minute.
 */
function handedTo(kind: "show" | "give", offer: Offer): Reaction | undefined {
  const player = currentPlayerBody();
  if (!player || offer.body?.id !== player.id) return undefined;
  if (!mindOf(offer.to)) return undefined;
  const { winner } = match(offer.to, kind, offer.thing, false);
  const node = openNodeOf(offer.to);
  if (winner || node?.restricts) {
    playerSays(
      message(kind === "show" ? "topic.player.show" : "topic.player.give", {
        who: offer.to,
        thing: offer.thing,
      }),
    );
  }
  if (pressed(offer.to, kind, node, winner)) {
    clock.advance(EXCHANGE_MINUTES);
    return react("");
  }
  if (!winner) return undefined;
  turnTo(offer.to);
  const key = exchangeKey(winner.mind, kind, subjectKey(offer.thing));
  counts.entries = { ...counts.entries, [winner.id]: (counts.entries[winner.id] ?? 0) + 1 };
  counts.exchanges = { ...counts.exchanges, [key]: (counts.exchanges[key] ?? 0) + 1 };
  respond(winner, { npc: offer.to, about: offer.thing });
  afterNode(offer.to, kind, node, winner);
  if (winner.hearMeOut !== undefined) redirect(winner.hearMeOut);
  clock.advance(EXCHANGE_MINUTES);
  return kind === "give" && winner.takes === true ? accept("") : react("");
}

_givingTopics.rule("topic entries", (offer) => handedTo("give", offer), { source: SOURCE });
_showingTopics.rule("topic entries", (offer) => handedTo("show", offer), { source: SOURCE });

// --- Compiled topic blocks (#115) ---

/** A topic block's arguments, as `{ask letter, again, when: …}` gives them. */
export type TopicBlockArguments = {
  /** What it's about: for ask, tell, show, give, and their pairs. */
  readonly about?: Subject;
  /** `again`: only once the exchange has been answered before. */
  readonly again?: "again";
  /** `takes`: for giving, they take it. */
  readonly takes?: "takes";
  /** `implicit` or `explicit`: for hello and bye. */
  readonly implicit?: "implicit" | "explicit";
  /** Only while this holds. */
  readonly when?: () => ConditionArgument;
  readonly priority?: number;
  /** An actor state, scene, or node, besides the passage's. */
  readonly in?: ActorState | Period | ConvNode;
  /** A node it opens after answering. */
  readonly opens?: ConvNode;
  /** `stays`: a node reply that leaves its node open. */
  readonly stays?: "stays";
  /** `-> Passage`: a cut scene the NPC tells after answering. */
  readonly hearMeOut?: string;
  /** The NPC's expression after it answers. */
  readonly expression?: string;
  readonly suggested?: boolean;
  readonly informs?: boolean;
};

/** Where a topic block was written: its actor passage, the block's directive, and the passage's tag role values. */
export type TopicBlockPassage = {
  readonly id: string;
  readonly directive: string;
  readonly roles: Readonly<Record<string, unknown>>;
};

const BLOCK_KINDS: Readonly<Record<string, string>> = {
  ask: "ask",
  tell: "tell",
  "ask or tell": "askOrTell",
  show: "show",
  give: "give",
  "show or give": "showOrGive",
  yes: "yes",
  no: "no",
  hello: "hello",
  bye: "bye",
};

/**
 * What a compiled topic block in an actor passage calls as the game loads:
 * adds the topic entry it stands for, scoped by the passage's `state:` or
 * `scene:` and its own `in:`, saying its prose and running its effects
 * when it answers.
 *
 * @throws StateError if the passage scopes by both a state and a scene, or the block also gives `in:`.
 */
export function topicBlock(
  args: TopicBlockArguments,
  block: Passage,
  passage: TopicBlockPassage,
): void {
  const where = `topic block in ${JSON.stringify(passage.id)}`;
  const npc = passage.roles["actor"] as ObjectRef | undefined;
  if (!npc) throw new StateError(`${where}: give the passage an actor, as [actor: butler].`);
  const scopes = [
    args.in,
    passage.roles["state"],
    passage.roles["scene"],
    passage.roles["node"],
  ].filter((x): x is ActorState | Period | ConvNode => x !== undefined);
  if (scopes.length > 1) {
    throw new StateError(
      `${where}: it's scoped by more than one of the block's \`in:\` and the passage's \`state:\`, \`scene:\`, and \`node:\`. Give one.`,
    );
  }
  const kind = BLOCK_KINDS[passage.directive];
  if (kind === undefined)
    throw new StateError(`${where}: \`{${passage.directive}}\` isn't a topic block.`);
  const when = args.when;
  const entry = {
    ...(args.about !== undefined ? { [kind]: args.about } : { [kind]: true }),
    says: "",
    id: block.id,
    ...(when && { when: () => when().value }),
    ...(args.priority !== undefined && { priority: args.priority }),
    ...(scopes[0] && { in: scopes[0] }),
    ...(args.opens && { opens: args.opens }),
    ...(args.stays && { stays: true }),
    ...(args.hearMeOut !== undefined && { hearMeOut: args.hearMeOut }),
    ...(args.expression !== undefined && { expression: args.expression }),
    ...(args.again && { again: true }),
    ...(args.takes && { takes: true }),
    ...(args.implicit && { implicit: args.implicit === "implicit" }),
    ...(args.suggested !== undefined && { suggested: args.suggested }),
    ...(args.informs !== undefined && { informs: args.informs }),
  } as unknown as TopicEntry;
  addEntry(npc, entry, block, when);
}

/** What `[actor: butler]` calls as the game loads: checks it's someone with a mind. */
export function registerActorPassage(
  actor: ObjectRef,
  passage: { readonly id: string; readonly tags: readonly string[] },
): void {
  mindFor(actor, `passage ${JSON.stringify(passage.id)}`);
}

/** What `[state: onDuty]` calls as the game loads: the value is checked as an actor state. */
export function registerStatePassage(
  state: ActorState,
  passage: { readonly id: string; readonly tags: readonly string[] },
): void {
  void state;
  void passage;
}

/** What `[node: proposal]` calls as the game loads: the value is checked as a conversation node. */
export function registerNodePassage(
  node: ConvNode,
  passage: { readonly id: string; readonly tags: readonly string[] },
): void {
  void node;
  void passage;
}

/** What `[scene: storm]` calls as the game loads: the value is checked as a scene. */
export function registerScenePassage(
  scene: Period,
  passage: { readonly id: string; readonly tags: readonly string[] },
): void {
  void scene;
  void passage;
}

// --- Locks need a way out (#117) ---

/**
 * Checks, as the game starts, that every node with a hard lock has a reply
 * that closes it, so the player can always get out. A node the game closes
 * from code says `closedElsewhere: true`.
 */
function checkWaysOut(): void {
  for (const node of _allNodes()) {
    if (node.exit !== "hard" || node.closedElsewhere === true) continue;
    const replies = (entries.get(node.mind) ?? []).filter((e) => e.in === node);
    if (replies.some((e) => e.stays !== true)) continue;
    throw new StateError(
      `convNode ${JSON.stringify(node.name)} (${JSON.stringify(node.mind)}) locks the conversation hard, but ${replies.length === 0 ? "it has no replies" : "every reply it has stays"}, so the player could never leave. Give it a reply that closes it, as topic(npc, { yes: true, in: node, says }) or a block in a [node: ${node.name}] passage; if the game closes it with closeNode(), give the node closedElsewhere: true.`,
    );
  }
}
hook("gameStart").rule("locked nodes have a way out", checkWaysOut, { source: SOURCE });
