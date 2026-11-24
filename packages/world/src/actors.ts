/**
 * Minds, bodies, actors, and the player (#65, ADR 0032).
 *
 * A mind inhabits a body, and that link is state on the mind: the body, and
 * whether it's a passenger there. A body's controlling mind and passengers
 * are computed from the minds, the way contents are computed from locations,
 * so a body never has two minds in control. The player is whichever mind the
 * player controls; nothing else about it is special.
 */
import {
  object,
  StateError,
  type Handle,
  type ObjectDefinition,
  type ObjectRef,
  type StateId,
} from "@loominate-if/core";
import {
  createKnowledge,
  KNOWLEDGE_METHODS,
  mindKnowledge,
  type MindKnowledge,
} from "./knowledge.js";
import {
  byId,
  container,
  thing,
  thingFor,
  withDefaults,
  type Thing,
  type ThingOf,
} from "./things.js";

/** What every mind has: where it is. */
export type MindFields = {
  /** The body it inhabits, or `null` when it's in none. Change it with {@link possess}. */
  inhabits: ObjectRef | null;
  /** Whether it rides in its body as a passenger, without control. */
  isPassenger: boolean;
  /**
   * The mind it took control from, kept in its body as a passenger, or
   * `null`. When this mind leaves, that one takes control again.
   */
  displaced: ObjectRef | null;
};

/** A mind: what an actor knows and thinks. It inhabits a body, or none. */
export type Mind = Handle<MindFields> & MindKnowledge;

/** A mind as {@link mind} defines it from definition `D`. */
export type MindOf<D> = Omit<D, keyof MindFields | keyof MindKnowledge> &
  MindFields &
  MindKnowledge;

/** What an actor adds to its body: its two halves. */
export type ActorHalves<M> = {
  /** The actor's mind. */
  readonly mind: Handle<MindOf<M>>;
  /** The actor's body: the actor itself. */
  readonly body: Thing;
};

/** An actor, as {@link actor} defines it: its body, which reads its mind's properties through. */
export type Actor<B, M, Id extends StateId = StateId> = Handle<
  ThingOf<B> & MindOf<M> & ActorHalves<M>,
  Id
>;

/** Every mind, by ID. */
const minds = new Map<StateId, Mind>();
/** The IDs of bodies. */
const bodies = new Set<StateId>();
/** The body each mind's definition starts it in control of, by mind ID. */
const startingControllers = new Map<StateId, StateId>();
/** Each actor's mind, by the actor's ID. */
const actorMinds = new Map<StateId, Mind>();
/** The world's record of who the player is, once {@link startAs} names them. */
let chosenPlayer: Handle<{ mind: ObjectRef }> | undefined;

/**
 * The ID under which the world keeps the player's mind. It has a colon, which
 * IDs from `story.ts` rarely do. @internal
 */
export const PLAYER_ID = "world:player";

/**
 * Defines a body: a thing that holds things in it, its inventory, and that a
 * mind can inhabit. An {@link actor} makes one for you.
 *
 * @example
 * ```ts
 * export const statue = body("statue", { name: "marble statue", location: hall });
 * ```
 *
 * @throws StateError if the ID is taken or invalid, or a property isn't valid state.
 */
export function body<Id extends StateId, D extends ObjectDefinition<D> & { name: string }>(
  id: Id,
  definition: D & { location?: ObjectRef | null } & ThisType<Handle<ThingOf<D>, Id>>,
): Handle<ThingOf<D>, Id> {
  const handle = thing(id, withDefaults(container, definition));
  bodies.add(id);
  return handle;
}

/**
 * Defines a mind. Give it `inhabits` to start it in a body, and
 * `isPassenger: true` to start it there without control. An {@link actor}
 * makes a mind in its own body for you.
 *
 * @example
 * ```ts
 * export const ghost = mind("ghost", { name: "ghost", malice: 2 });
 * ```
 *
 * @throws StateError if the ID is taken or invalid, a property isn't valid
 * state, `inhabits` isn't a body, or another mind already starts in control of it.
 */
export function mind<Id extends StateId, D extends ObjectDefinition<D>>(
  id: Id,
  definition: D &
    Partial<MindFields> & {
      [K in keyof D & keyof MindKnowledge]: {
        error: `"${K & string}" is what every mind does with what it knows; give the property another name.`;
      };
    } & ThisType<Handle<MindOf<D>, Id>>,
): Handle<MindOf<D>, Id> {
  const where = `mind ${JSON.stringify(id)}`;
  for (const key of KNOWLEDGE_METHODS) {
    if (Object.hasOwn(definition, key)) {
      throw new StateError(
        `${where}: "${key}" is what every mind does with what it knows; give the property another name.`,
      );
    }
  }
  const start = definition.inhabits ?? null;
  const passenger = start !== null && definition.isPassenger === true;
  if (start !== null) {
    if (!bodies.has(start.id)) {
      throw new StateError(
        `${where}: it inhabits ${JSON.stringify(start.id)}, which isn't a body. Define it with body() or actor().`,
      );
    }
    const holder = passenger ? undefined : startingController(start.id);
    if (holder) {
      throw new StateError(
        `${where}: ${JSON.stringify(holder)} already starts in control of ${JSON.stringify(start.id)}. Give one of them isPassenger: true.`,
      );
    }
  }
  const handle = object(
    id,
    // Copied as descriptors, not spread, so `hasAmnesia` stays a getter.
    withDefaults(
      withDefaults(definition, { inhabits: start, isPassenger: passenger, displaced: null }),
      mindKnowledge,
    ) as unknown as ObjectDefinition<D>,
  );
  minds.set(id, handle as unknown as Mind);
  createKnowledge(handle);
  if (start !== null && !passenger) startingControllers.set(id, start.id);
  return handle as unknown as Handle<MindOf<D>, Id>;
}

/**
 * The mind a body belongs to: the one whose definition starts it in
 * control, such as an actor's own mind. Others take the body for it, even
 * when another mind possesses it (#66). @internal
 */
export function ownerOf(b: ObjectRef): Mind | undefined {
  const id = startingController(b.id);
  return id === undefined ? undefined : minds.get(id);
}

/** The mind whose definition starts it in control of `bodyId`. Read from definitions, since no story runs yet. */
function startingController(bodyId: StateId): StateId | undefined {
  for (const [m, b] of startingControllers) if (b === bodyId) return m;
  return undefined;
}

/**
 * Defines an actor: a body and the mind that inhabits it, linked for good,
 * for the common case where the two never part.
 *
 * @remarks
 * The actor is its body, with ID `id`, since the body is what's moved and
 * seen. Its mind's ID is `id` + `":mind"`. The actor reads and writes its
 * mind's properties through, so `mira.courage` is the mind's though `mira` is
 * the body, and a key in both halves is an error. `mira.mind` and `mira.body`
 * are the halves. If another mind possesses the body, `mira.courage` is still
 * Mira's own.
 *
 * @example
 * ```ts
 * export const mira = actor("mira", {
 *   body: { name: "Mira", location: hall, strength: 2 },
 *   mind: { courage: 3 },
 * });
 * ```
 *
 * @throws StateError if either ID is taken, a property isn't valid state, or a key is in both halves.
 */
export function actor<
  Id extends StateId,
  B extends ObjectDefinition<B> & { name: string },
  M extends ObjectDefinition<M> = Record<never, never>,
>(
  id: Id,
  definition: {
    // A key that can't be used gets a type no value has, which carries the
    // explanation into the compiler's message. A bare message type would
    // collapse the definition to `never` against a literal value instead.
    body: B & { location?: ObjectRef | null } & {
      [K in keyof B & keyof MindKnowledge]: {
        error: `"${K & string}" is what every mind does with what it knows; give the property another name.`;
      };
    } & ThisType<Actor<B, M, Id>>;
    mind?: M & {
      [K in keyof M & (keyof B | keyof MindKnowledge)]: {
        error: K extends keyof MindKnowledge
          ? `"${K & string}" is what every mind does with what it knows; give the property another name.`
          : `"${K & string}" is in both the body and the mind; give one of them another name.`;
      };
    } & ThisType<Actor<B, M, Id>>;
  },
): Actor<B, M, Id> {
  const where = `actor ${JSON.stringify(id)}`;
  const bodyDef = definition.body as object;
  const mindDef = (definition.mind ?? {}) as object;
  const mindKeys = [
    ...Object.keys(mindDef),
    "inhabits",
    "isPassenger",
    "displaced",
    ...KNOWLEDGE_METHODS,
  ];
  for (const key of KNOWLEDGE_METHODS) {
    if (Object.hasOwn(bodyDef, key) || Object.hasOwn(mindDef, key)) {
      throw new StateError(
        `${where}: "${key}" is what every mind does with what it knows; give the property another name.`,
      );
    }
  }
  for (const key of [...mindKeys, "mind", "body"]) {
    if (Object.hasOwn(bodyDef, key)) {
      throw new StateError(
        key === "mind" || key === "body"
          ? `${where}: its body has "${key}", which names the actor's ${key}; give the property another name.`
          : `${where}: "${key}" is in both its body and its mind; give one of them another name.`,
      );
    }
  }
  // The body comes first, so the mind can start in it. Its pass-through
  // properties read the mind only when used, by which time it exists.
  const theMind = (): Record<string, unknown> => m as unknown as Record<string, unknown>;
  const passThrough: PropertyDescriptorMap = {
    mind: { get: () => m, enumerable: false },
    body: { get: () => thingFor({ id }), enumerable: false },
  };
  for (const key of mindKeys) {
    passThrough[key] = {
      get: () => theMind()[key],
      set: (value: unknown) => {
        theMind()[key] = value;
      },
      enumerable: false,
    };
  }
  const withMind = Object.defineProperties(withDefaults({}, bodyDef), passThrough) as B;
  const handle = body(id, withMind);
  const m = mind(
    `${id}:mind`,
    withDefaults(mindDef, { inhabits: handle }) as never,
  ) as unknown as Mind;
  actorMinds.set(id, m);
  return handle as unknown as Actor<B, M, Id>;
}

/** The mind `ref` names: a mind, or an actor's mind. @internal */
export function mindFor(ref: ObjectRef, where: string): Mind {
  const found = minds.get(ref.id) ?? actorMinds.get(ref.id);
  if (!found) {
    throw new StateError(
      `${where}: ${JSON.stringify(ref.id)} isn't a mind. Define it with mind() or actor().`,
    );
  }
  return found;
}

/** The body `ref` names. */
function bodyFor(ref: ObjectRef, where: string): Thing {
  const found = bodies.has(ref.id) ? thingFor(ref) : undefined;
  if (!found) {
    throw new StateError(
      `${where}: ${JSON.stringify(ref.id)} isn't a body. Define it with body() or actor().`,
    );
  }
  return found;
}

/** Every body, sorted by ID. @internal */
export function allBodies(): Thing[] {
  return [...bodies].sort().flatMap((id) => {
    const b = thingFor({ id });
    return b ? [b] : [];
  });
}

/** The minds in `b`: the one in control, then its passengers. @internal */
export function mindsIn(b: ObjectRef): Mind[] {
  const controller = mindOf(b);
  return [...(controller ? [controller] : []), ...passengersOf(b)];
}

/** Every mind, actors' included, sorted by ID. @internal */
export function _allMinds(): Mind[] {
  const all = new Map<StateId, Mind>([
    ...minds,
    ...[...actorMinds.values()].map((m) => [m.id, m] as const),
  ]);
  return [...all.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Whether `ref` is a mind, or an actor. */
export function isMind(ref: ObjectRef): boolean {
  return minds.has(ref.id) || actorMinds.has(ref.id);
}

/** Whether `ref` is a body. An actor is its body. */
export function isBody(ref: ObjectRef): boolean {
  return bodies.has(ref.id);
}

/** The body `m` inhabits, in control or as a passenger, or `undefined` if it's in none. */
export function bodyOf(m: ObjectRef): Thing | undefined {
  const at = mindFor(m, "bodyOf").inhabits;
  return at ? thingFor(at) : undefined;
}

/** The mind in control of `b`, or `undefined` if it's empty or only carries passengers. */
export function mindOf(b: ObjectRef): Mind | undefined {
  const id = bodyFor(b, "mindOf").id;
  return [...minds.values()].sort(byId).find((m) => m.inhabits?.id === id && !m.isPassenger);
}

/** The passengers in `b`, sorted by ID: minds in it without control. */
export function passengersOf(b: ObjectRef): Mind[] {
  const id = bodyFor(b, "passengersOf").id;
  return [...minds.values()].filter((m) => m.inhabits?.id === id && m.isPassenger).sort(byId);
}

/** How {@link possess} puts a mind in a body. */
export type PossessOptions = {
  /**
   * `"controller"`, the default, takes control. `"passenger"` rides along
   * without it, leaving the body's mind in control.
   */
  readonly as?: "controller" | "passenger";
  /**
   * Where the mind that was in control goes, when `m` takes control:
   * `"passenger"`, the default, keeps it in the body without control, and
   * `"out"` leaves it in no body.
   */
  readonly displaced?: "passenger" | "out";
};

/**
 * Puts mind `m` in body `b`, leaving whatever body it was in. Pass an actor
 * for either, and its mind or body is used.
 *
 * @remarks
 * By default `m` takes control, and the mind that was in control stays in the
 * body as a passenger, to take control again when `m` leaves.
 * `{ displaced: "out" }` pushes it out of any body instead, and
 * `{ as: "passenger" }` has `m` ride along without control. Leaving another
 * body hands it back, as {@link leaveBody} does. Each is one change for undo.
 *
 * @example
 * ```ts
 * possess(ghost, mira);                        // Mira's mind watches, helpless
 * possess(ghost, mira, { displaced: "out" });  // Mira's mind is cast out
 * possess(ghost, mira, { as: "passenger" });   // the ghost rides along
 * ```
 *
 * @throws StateError if `m` isn't a mind or `b` isn't a body.
 */
export function possess(m: ObjectRef, b: ObjectRef, options: PossessOptions = {}): void {
  const where = `possess ${JSON.stringify(m.id)} into ${JSON.stringify(b.id)}`;
  const moving = mindFor(m, where);
  const into = bodyFor(b, where);
  if (moving.inhabits?.id === into.id && !moving.isPassenger) return; // already in control
  vacate(moving, true);
  if (options.as === "passenger") {
    moving.inhabits = into;
    moving.isPassenger = true;
    return;
  }
  const holder = mindOf(into);
  if (holder && options.displaced === "out") {
    // Cast out, it can't take control back; whoever it displaced still can.
    moving.displaced = holder.displaced;
    holder.inhabits = null;
    holder.isPassenger = false;
    holder.displaced = null;
  } else if (holder) {
    moving.displaced = holder;
    holder.isPassenger = true;
  }
  moving.inhabits = into;
  moving.isPassenger = false;
}

/** How {@link leaveBody} leaves a body. */
export type LeaveOptions = {
  /**
   * Whether the mind the leaving one displaced takes control again, as it
   * does by default. `false` leaves the body empty, with that mind still a
   * passenger, such as a body left in a trance.
   */
  readonly restore?: boolean;
};

/**
 * Has mind `m` leave its body, so it inhabits none.
 *
 * @remarks
 * If `m` was in control, the mind it displaced with {@link possess} takes
 * control again, if it's still a passenger there. `{ restore: false }` leaves
 * the body empty instead. A passenger that rode along of its own accord never
 * takes control this way.
 *
 * @example
 * ```ts
 * leaveBody(ghost);                     // Mira is herself again
 * leaveBody(ghost, { restore: false }); // Mira's body stands empty, her mind trapped inside
 * ```
 *
 * @throws StateError if `m` isn't a mind.
 */
export function leaveBody(m: ObjectRef, options: LeaveOptions = {}): void {
  vacate(mindFor(m, "leaveBody"), options.restore ?? true);
}

/** Takes `leaving` out of its body, handing control back to the mind it displaced if `restore`. */
function vacate(leaving: Mind, restore: boolean): void {
  const at = leaving.inhabits;
  const was = leaving.displaced ? minds.get(leaving.displaced.id) : undefined;
  if (restore && at && !leaving.isPassenger && was?.inhabits?.id === at.id && was.isPassenger) {
    was.isPassenger = false;
  }
  leaving.inhabits = null;
  leaving.isPassenger = false;
  leaving.displaced = null;
}

/**
 * Exchanges two minds' places: each takes the body the other was in, in
 * control or as a passenger as the other was. Pass actors to swap their minds.
 *
 * @example
 * ```ts
 * swapBodies(you, tom); // you wake up as Tom, and Tom as you
 * ```
 *
 * @throws StateError if either isn't a mind.
 */
export function swapBodies(a: ObjectRef, b: ObjectRef): void {
  const first = mindFor(a, "swapBodies");
  const second = mindFor(b, "swapBodies");
  // What each displaced goes with its place: it's that body's mind to restore.
  const [at, passenger, displaced] = [first.inhabits, first.isPassenger, first.displaced];
  first.inhabits = second.inhabits;
  first.isPassenger = second.isPassenger;
  first.displaced = second.displaced;
  second.inhabits = at;
  second.isPassenger = passenger;
  second.displaced = displaced;
}

/**
 * Names the mind the player starts as, in `story.ts`. Pass an actor, and the
 * player starts as its mind.
 *
 * @example
 * ```ts
 * export const you = actor("you", { body: { name: "you", location: hall } });
 * startAs(you);
 * ```
 *
 * @throws StateError if `m` isn't a mind, or the player has already been named.
 */
export function startAs(m: ObjectRef): void {
  const chosen = mindFor(m, "startAs");
  if (chosenPlayer) {
    throw new StateError(
      `startAs ${JSON.stringify(m.id)}: the player already starts as ${JSON.stringify(chosenPlayer.mind.id)}. Call startAs() once; switch during play with playAs().`,
    );
  }
  chosenPlayer = object(PLAYER_ID, { mind: chosen as ObjectRef });
}

/**
 * Switches the mind the player controls, during play. Pass an actor to play as its mind.
 *
 * @throws StateError if `m` isn't a mind, or `story.ts` never called {@link startAs}.
 */
export function playAs(m: ObjectRef): void {
  const chosen = mindFor(m, "playAs");
  playerRecord("playAs").mind = chosen;
}

/**
 * The mind the player controls now.
 *
 * @throws StateError if `story.ts` never called {@link startAs}.
 */
export function playerMind(): Mind {
  return mindFor(playerRecord("playerMind").mind, "playerMind");
}

/**
 * The body the player's mind is in now, or `undefined` if it's in none.
 *
 * @throws StateError if `story.ts` never called {@link startAs}.
 */
export function playerBody(): Thing | undefined {
  return bodyOf(playerMind());
}

function playerRecord(where: string): Handle<{ mind: ObjectRef }> {
  if (!chosenPlayer) {
    throw new StateError(
      `${where}: nobody is the player yet. Call startAs() in story.ts with the mind or actor the player starts as.`,
    );
  }
  return chosenPlayer;
}

/** The player's mind, or `undefined` if there's no player yet. @internal */
export function currentPlayerMind(): Mind | undefined {
  return chosenPlayer ? mindFor(chosenPlayer.mind, "player") : undefined;
}

/** The player's body, or `undefined` if there's no player yet or it's in no body. @internal */
export function currentPlayerBody(): Thing | undefined {
  return chosenPlayer ? bodyOf(chosenPlayer.mind) : undefined;
}
