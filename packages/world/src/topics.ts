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
  _storyRunning,
  action,
  emit,
  message,
  messages,
  object,
  StateError,
  t,
  type ObjectRef,
  type Period,
  type StateId,
} from "@loominate-if/core";
import { _reachNotNeeded } from "./acting.js";
import { allBodies, bodyOf, currentPlayerBody, isBody, mindFor, mindOf } from "./actors.js";
import {
  _endConversation,
  _whenLeaving,
  address,
  conversation,
  inConversationWith,
  joinConversation,
  startConversation,
  type LeftBy,
} from "./conversations.js";
import { factNamed, type Fact } from "./knowledge.js";
import { placeOf, thingFor } from "./things.js";

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
register("topic.noSubject", ({ about }) => `There's no subject called ${JSON.stringify(about)}.`);

/** A named topic: something to talk about that isn't a thing or a fact, as the weather. */
export type Topic = ObjectRef & { readonly name: string };

/**
 * Defines named topics, things to talk about that aren't things in the world
 * or facts, in `story.ts`. Each is an object, `topic:` and its key.
 *
 * @example
 * ```ts
 * export const { weather, war } = topics({ weather: "the weather", war: "the war" });
 * ```
 */
export function topics<D extends Readonly<Record<string, string>>>(
  definitions: D,
): { readonly [K in keyof D]: Topic } {
  const made: Record<string, Topic> = {};
  for (const [key, name] of Object.entries(definitions)) {
    made[key] = object(`topic:${key}` as StateId, { name }) as Topic;
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

/** When and how strongly a topic entry applies. */
export type TopicOptions = {
  /** What it says. */
  readonly says: Says;
  /** Only while this holds. */
  readonly when?: () => boolean;
  /** Only in this actor state of theirs, or while this scene is happening. */
  readonly in?: ActorState | Period;
  /** Higher wins among entries that match. Defaults to 0. */
  readonly priority?: number;
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
  );

/** The kind of exchange the player makes. */
export type TopicKind = "ask" | "tell" | "yes" | "no" | "hello" | "bye";

type Entry = {
  readonly id: string;
  readonly mind: string;
  readonly kinds: readonly TopicKind[];
  /** The subject's key, `*` for anything, or undefined for kinds without one. */
  readonly subject?: string;
  /** What it's about, as given, to name it for the inspector. */
  readonly about?: Subject;
  readonly implicit?: boolean;
  readonly order: number;
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
  if (isFact(s)) return `the fact “${s.text}”`;
  const ref = s as ObjectRef;
  if (thingFor(ref)) return t`{the x}`({ x: ref });
  const name = (s as { readonly name?: unknown }).name;
  return typeof name === "string" ? name : ref.id;
};

const isPeriod = (x: ActorState | Period): x is Period => "isHappening" in x;
/** How specific an entry's context is: a scene over an actor state over the actor. */
const contextLevel = (e: Entry): number => (e.in === undefined ? 0 : isPeriod(e.in) ? 2 : 1);

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
  const mind = mindFor(npc, "topic").id;
  const where = `topic for ${JSON.stringify(mind)}`;
  const e = entry as TopicOptions &
    Partial<Record<"ask" | "tell" | "askOrTell", Subject>> & {
      yes?: true;
      no?: true;
      hello?: true;
      bye?: true;
      implicit?: boolean;
    };
  const subjectOf = e.ask ?? e.tell ?? e.askOrTell;
  const kinds: TopicKind[] =
    e.ask !== undefined
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
      `${where}: say what it answers: ask, tell, askOrTell, yes, no, hello, or bye.`,
    );
  }
  if (entry.in && !isPeriod(entry.in) && entry.in.mind !== mind) {
    throw new StateError(`${where}: ${JSON.stringify(entry.in.id)} is another NPC's state.`);
  }
  const list = entries.get(mind) ?? [];
  const subject = subjectOf === undefined ? undefined : subjectKey(subjectOf);
  list.push({
    ...entry,
    id: `${mind}:${kinds.join("|")}${subject === undefined ? "" : `:${subject}`}#${String(list.length + 1)}`,
    mind,
    kinds,
    ...(subjectOf !== undefined && { subject: subjectKey(subjectOf), about: subjectOf }),
    ...(e.implicit !== undefined && { implicit: e.implicit }),
    order: list.length,
  });
  entries.set(mind, list);
}

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
  if (e.implicit !== undefined && e.implicit !== implicit) {
    return e.implicit ? "It's only for when nothing was said." : "It's only for when it's said.";
  }
  if (e.in) {
    if (isPeriod(e.in)) {
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
  contextLevel(b) - contextLevel(a) ||
  Number(b.subject !== "*") - Number(a.subject !== "*") ||
  a.order - b.order;

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
    const who = t`{the x}`({ x: body });
    return (entries.get(mind.id) ?? []).map((e) => {
      const kind = e.kinds[0] ?? "ask";
      const about =
        e.about === undefined
          ? undefined
          : e.about === anything
            ? SOMETHING_ELSE
            : (e.about as ObjectRef | Fact);
      const verb = e.kinds.length > 1 ? "Ask or tell" : VERBS[kind];
      const what =
        e.about === undefined
          ? ""
          : ` about ${e.about === anything ? "anything else" : nameOf(e.about)}`;
      const when = e.implicit === true ? ", unprompted" : e.implicit === false ? ", in words" : "";
      const c = match(body, kind, about, e.implicit ?? false).candidates.find((x) => x.id === e.id);
      return {
        label: `${verb} ${who}${what}${when} (${e.id})`,
        available: c?.wins ?? false,
        ...(c?.why !== undefined && { why: c.why }),
      };
    });
  });
}

/** Says an entry's response, as the NPC, recorded for the page. */
function respond(e: Entry, context: TopicContext): void {
  const text = typeof e.says === "string" ? e.says : e.says(context);
  if (typeof text === "string" && text !== "") say(text, context.npc);
}

const say = (text: string, npc: ObjectRef): void => {
  emit("action-result", { text }, ["topic", `speaker:${npc.id}`]);
};

/** Runs the winning entry, or says `fallback` if none matches. */
function answer(
  who: ObjectRef,
  kind: TopicKind,
  options: { about?: ObjectRef | Fact; implicit?: boolean; how?: LeftBy },
  fallback: string | undefined,
): void {
  const { winner } = match(who, kind, options.about, options.implicit ?? false);
  if (winner) {
    respond(winner, {
      npc: who,
      ...(options.about !== undefined && { about: options.about }),
      ...(options.how !== undefined && { how: options.how }),
    });
  } else if (fallback !== undefined) say(fallback, who);
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
    verify: ({ who, about }) =>
      cantTalkTo(who) ??
      (subjectFrom(about) === undefined
        ? message("topic.noSubject", { about: String(about) })
        : undefined),
    run: ({ who, about }) => {
      turnTo(who);
      const subject = subjectFrom(about);
      answer(
        who,
        kind,
        subject === undefined ? {} : { about: subject },
        message("topic.noResponse", { who }),
      );
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
  run: () => {
    const who = conversation.addressee;
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
      if (who) answer(who, kind, {}, message("topic.noAnswer", { who }));
    },
  });

/** Answers yes to the addressee. */
export const yes = answerWith("yes");

/** Answers no to the addressee. */
export const no = answerWith("no");

// Talking needs them here, not in reach, and a subject can be anywhere.
_reachNotNeeded(ask, "who", "about");
_reachNotNeeded(tell, "who", "about");
_reachNotNeeded(hello, "who");

// An NPC leaving the conversation without goodbye says their implicit bye.
_whenLeaving((mind, how) => {
  if (how === "goodbye") return;
  const body = bodyOf({ id: mind });
  if (body) answer(body, "bye", { implicit: true, how }, undefined);
});
