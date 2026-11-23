/**
 * The passage runtime: plays compiled passages.
 *
 * A compiled passage is an ID, tags, and a pure `body` function that turns the
 * current state into text, links, and continue points. Rendering can happen any
 * number of times without changing anything; state changes only when the
 * player follows a link, which moves to the next passage and records it in the
 * event record.
 */
import type { EventKind, EventKinds, EventRecord, LineId, TextStyle } from "../events/record.js";
import type { StateId, StateSnapshot, StateStore } from "../state/store.js";
import { bindObjects, renderingObjects } from "../objects/objects.js";
import { StateError } from "../state/value.js";
import { MOVE_FIELD, RANDOM_ID, SEED_FIELD } from "../random/random.js";
import { ATTEMPTS_ID } from "../state/history.js";
import { ENGINE_VERSION, type GameInfo } from "../save/save.js";
import {
  createPersistent,
  persistentState,
  type PersistentStore,
} from "../persistent/persistent.js";
import {
  choiceRef,
  REPLAY_FORMAT,
  REPLAY_VERSION,
  type Replay,
  type ReplayCheck,
  type StoryAction,
} from "../replay/replay.js";
import { checkInlineLinks, checkStyles } from "./prose.js";
import { hook } from "../rules/hooks.js";
import { visitMemory } from "./memory.js";
import {
  callOf,
  logCall,
  perform,
  statusOf,
  type ActionCall,
  type ActionRule,
  type LoggedCall,
} from "../actions/actions.js";

/** A passage's ID: its name from `:: Name`. */
export type PassageId = StateId;

/** A paragraph of prose in a rendered passage. Build formatted ones with {@link prose}. */
export type TextNode = {
  /** Node type. */
  readonly type: "text";
  /** The prose, without formatting. */
  readonly text: string;
  /** Formatting over parts of `text`, when it has any. */
  readonly styles?: readonly TextStyle[];
  /** The authored line it came from, when it came from one. */
  readonly line?: LineId;
  /** Links inside the paragraph, in order, as ranges of `text`. */
  readonly links?: readonly InlineLink[];
};

/** A link to another passage, from `[[Label -> Target]]`. */
export type LinkNode = {
  /** Node type. */
  readonly type: "link";
  /** The text the player sees. */
  readonly label: string;
  /** The passage the link goes to. */
  readonly target: PassageId;
  /** The authored line the label came from, when it came from one. */
  readonly line?: LineId;
  /** The link's `{when …}` guard, if it has one. */
  readonly guard?: LinkGuard;
};

/**
 * How a link whose guard is closed is shown:
 * - `hidden`: not shown at all;
 * - `disabled`: shown, but can't be followed;
 * - `disabled-with-reason`: shown, can't be followed, and shows the guard's `reason`.
 */
export type GuardMode = "hidden" | "disabled" | "disabled-with-reason";

/** A `{when …}` guard on a link, evaluated when the passage renders. */
export type LinkGuard = {
  /** Whether the condition held at render time, so the link can be followed. */
  readonly open: boolean;
  /** The condition's source, e.g. `lantern.isLit`, so the inspector can explain a closed link. */
  readonly condition: string;
  /** How to show the link while closed. Defaults to the story's {@link StoryOptions.guardMode}. */
  readonly mode?: GuardMode;
  /** Shown to the player in `disabled-with-reason` mode, e.g. "It's too dark to see the steps." */
  readonly reason?: string;
  /**
   * The action an `{act …}` link takes, as logged: following the link
   * performs it and stays on the passage, instead of going to a target.
   */
  readonly act?: LoggedCall;
  /**
   * The ID of the thing a `{menu …}` link opens a menu for: the page shows
   * the thing's actions instead of following the link.
   */
  readonly menu?: string;
  /** For an action link that's hidden or disabled, the rule that did it. */
  readonly by?: ActionRule;
  /**
   * While the guard is closed, the condition's parts and their values, so
   * the inspector can show which part closed it: for
   * `lamp.lit && !night.signalled`, `lamp.lit` and `night.signalled`.
   */
  readonly parts?: readonly ConditionPart[];
};

/** A part of a condition, with its value when the condition was checked. */
export type ConditionPart = {
  /** The part's source, e.g. `keeper.hasMatches`. */
  readonly text: string;
  /**
   * Its value, written as the inspector shows it: `true`, `3`, `"Shed"`, or
   * `→ lamp` for a reference to an object. Absent when the part threw.
   */
  readonly value?: string;
  /**
   * Why the part couldn't be evaluated on its own, for example `door.open`
   * in `door && door.open` when there's no door.
   */
  readonly error?: string;
};

/** A link as rendered: whether it can be followed, and why not. */
export type RenderedLink = LinkNode & {
  /** Whether the player can follow the link now. */
  readonly available: boolean;
  /** Why the link is disabled, for the player; only in `disabled-with-reason` mode. */
  readonly reason?: string;
};

/** A link that can't be followed now, with the explanation the inspector shows. */
export type UnavailableLink = {
  /** The link as authored. */
  readonly link: LinkNode;
  /** How it's shown: hidden, disabled, or disabled with a reason. */
  readonly mode: GuardMode;
  /** The guard condition that didn't hold. */
  readonly condition: string;
};

/** A continue point, from `{continue -> Target}`: a single way on, usually after a scene. */
export type ContinueNode = {
  /** Node type. */
  readonly type: "continue";
  /** The passage to continue to. */
  readonly target: PassageId;
  /** The text the player sees; presentation supplies a default such as "Continue". */
  readonly label?: string;
};

/**
 * A named presentation effect, from `{effect shake}` or
 * `{effect typewriter, duration: 2s}`: a fade, a typewriter, a shake. It
 * changes nothing in the story; presentation looks the name up in its effects
 * registry and plays it, on what follows or on the whole page.
 *
 * Not to be confused with a passage's {@link PassageEffects}, which change state.
 */
export type NamedEffectNode = {
  /** Node type. */
  readonly type: "effect";
  /** The registered effect's name, e.g. `fade`. */
  readonly name: string;
  /** How long it should take, in milliseconds, when the passage says. */
  readonly duration?: number;
  /** Further settings the effect understands. */
  readonly options?: Readonly<Record<string, unknown>>;
};

/**
 * A beat, which divides a passage into parts the player reaches in turn:
 * `{beat 1.5s}` is a timed pause, `{wait}` waits for the player, and `{page}`
 * waits for the player and then clears the screen, for long introductions.
 * {@link Story.advance} moves past it.
 */
export type BeatNode = {
  /** Node type. */
  readonly type: "beat";
  /** How long the pause lasts, in milliseconds. Missing when it waits for the player. */
  readonly duration?: number;
  /** True when what follows replaces what came before on screen. */
  readonly page?: true;
};

/**
 * Where the move's notices go, from `{notices}`: what the player noticed
 * and what their actions did, the `perception` and `action-result` events
 * recorded during the move. Without one, presentation shows them after the
 * passage's text, before its first choice. It changes nothing in the story.
 */
export type NoticesNode = {
  /** Node type. */
  readonly type: "notices";
};

/** One piece of a rendered passage, in reading order. */
export type PassageNode =
  TextNode | LinkNode | ContinueNode | NamedEffectNode | NoticesNode | BeatNode;

/**
 * A link inside a paragraph, from `You could [[ask about it -> Hall]] now.`
 *
 * @remarks
 * The label is part of the paragraph's `text`, at `text.slice(start, end)`,
 * so the text reads as a whole sentence in transcripts and search. Offsets are
 * UTF-16 positions, `start` inclusive and `end` exclusive, never empty. Inline
 * links don't overlap each other, and styles either contain a link, sit inside
 * its label, or stay clear of it.
 */
export type InlineLink = LinkNode & {
  /** Offset of the label's first character in the paragraph's `text`. */
  readonly start: number;
  /** Offset just past the label's last character. */
  readonly end: number;
};

/** A way out of the current passage: a link or a continue point. */
export type Choice = LinkNode | ContinueNode;

/** An inline link as rendered: whether it can be followed, and why not. */
export type RenderedInlineLink = RenderedLink & {
  /** Offset of the label's first character in the paragraph's `text`. */
  readonly start: number;
  /** Offset just past the label's last character. */
  readonly end: number;
};

/**
 * A paragraph as rendered. An inline link whose guard hides it is left out of
 * `links`, and its label stays in `text` as plain words, so the sentence still
 * reads; disabled ones stay in.
 */
export type RenderedText = Omit<TextNode, "links"> & {
  /** Links inside the paragraph the player can see, in order. */
  readonly links?: readonly RenderedInlineLink[];
};

/** One piece of a rendered passage. Hidden links are left out; disabled ones stay in. */
export type RenderedNode =
  RenderedText | RenderedLink | ContinueNode | NamedEffectNode | NoticesNode;

/** Read-only access to state, which is all a passage body gets. */
export type StateReader = Pick<StateStore, "get" | "has" | "entity" | "ids">;

/** What a passage body can see while rendering. */
export interface RenderContext {
  /** The game state, read-only. */
  readonly state: StateReader;
  /** Persistent cross-playthrough data (achievements, endings, settings), read-only. */
  readonly persistent: StateReader;
  /** The passage being rendered. */
  readonly passage: PassageId;
  /**
   * How many times the player remembers entering this passage, counting the
   * current visit. Without a visit memory ({@link useVisitMemory}), every
   * real visit.
   */
  readonly visits: number;
  /** Whether this is the player's first remembered visit to this passage. */
  readonly firstVisit: boolean;
  /** Whether the player remembers entering `passage`. */
  visited(passage: PassageId): boolean;
}

/** Read and write access to state, which effect phases get. */
export type StateWriter = StateReader & Pick<StateStore, "set" | "delete">;

/**
 * The effect phases written after a beat. They run when the player reaches the
 * beat's part of the passage, so a scene can change things as it unfolds.
 */
export type BeatEffects = {
  readonly [P in "firstVisit" | "enter"]?: (context: EffectContext) => void;
};

/** The effect phases a passage can declare. */
export type EffectPhase = "firstVisit" | "enter" | "leave";

/** What an effect phase can see and do. */
export interface EffectContext extends Omit<RenderContext, "state" | "persistent"> {
  /** The game state. Changes are recorded for undo, save, and replay. */
  readonly state: StateWriter;
  /**
   * Persistent cross-playthrough data. Changes outlast undo, restarts, and
   * loading a save, but not a move that fails: those are rolled back.
   */
  readonly persistent: StateWriter;
  /** Records output, such as a message the effect wants to show. */
  readonly emit: EventRecord["emit"];
}

/**
 * A passage's effect phases, from `{on first visit: …}`, `{on enter: …}`, and
 * `{on leave: …}`. Each runs exactly once per real visit: never on re-render or load.
 */
export type PassageEffects = { readonly [P in EffectPhase]?: (context: EffectContext) => void };

/** A compiled passage. The compiler produces these from `:: Name [tags]` blocks. */
export interface Passage {
  /** The passage's ID, from its name. */
  readonly id: PassageId;
  /** Tags from `[tags]`, which assign roles such as `scene`. */
  readonly tags: readonly string[];
  /** Renders the passage. Must be pure: it may read state but never change it. */
  readonly body: (context: RenderContext) => readonly PassageNode[];
  /** The passage's effect phases, the only place a passage changes state. */
  readonly effects?: PassageEffects;
  /**
   * The effect phases written after each beat, in order: `beats[0]` runs
   * when the player reaches the part after the first beat.
   */
  readonly beats?: readonly BeatEffects[];
}

/** A rendered passage. */
export interface RenderedPassage {
  /** The passage rendered. */
  readonly passage: Passage;
  /**
   * What the player sees, in reading order: text, links (hidden ones left
   * out), continue points, and named effects, up to the beat the player has
   * reached, from the last page break before it.
   */
  readonly nodes: readonly RenderedNode[];
  /** The beat the player hasn't moved past yet, if the passage has more to show. */
  readonly beat?: BeatNode;
  /** How many beats the player has moved past in this visit. */
  readonly step: number;
  /** The links and continue points the player can follow now, in reading order. */
  readonly choices: readonly Choice[];
  /** Links whose guards are closed, hidden or disabled, with their conditions, for the inspector. */
  readonly unavailable: readonly UnavailableLink[];
}

/** Options for {@link createStory}. */
export interface StoryOptions {
  /** The passage the story starts in. */
  readonly start: PassageId;
  /** How links with closed guards are shown when a link doesn't say. Defaults to `hidden`. */
  readonly guardMode?: GuardMode;
  /**
   * The master seed every random stream derives from (ADR 0008). It's stored in
   * state when the story begins, so a loaded save keeps its own. Defaults to
   * `"0"`; a new game normally gets a fresh seed from whatever starts it.
   */
  readonly seed?: string;
  /**
   * Persistent cross-playthrough data, from `openPersistent`. Defaults to an
   * empty store in memory. The story copies it into game state when it begins,
   * so saves and replays carry what it held then.
   */
  readonly persistent?: PersistentStore;
}

/** Plays a set of compiled passages over a state store and event record. */
export interface Story {
  /** The current passage's ID, or `undefined` before {@link Story.begin}. */
  readonly current: PassageId | undefined;
  /** Looks up a passage by ID. */
  passage(id: PassageId): Passage | undefined;
  /**
   * How many times the player remembers entering a passage, as passages see
   * it. Following a link back to the same passage counts. Without a visit
   * memory ({@link useVisitMemory}), it's {@link Story.totalVisits}.
   */
  visits(id: PassageId): number;
  /** Whether the player remembers entering a passage. */
  visited(id: PassageId): boolean;
  /**
   * How many times the story has really entered a passage, whoever the
   * player was and whatever they remember, for the story map, coverage, and
   * the inspector.
   */
  totalVisits(id: PassageId): number;
  /**
   * Enters the start passage, if the story hasn't begun. Does nothing on a story
   * that has already begun, for example one loaded from a save.
   */
  begin(): void;
  /**
   * Renders the current passage without changing anything.
   * @throws {@link StateError} before {@link Story.begin}, or if the body changes state.
   */
  render(): RenderedPassage;
  /**
   * Follows one of the current passage's choices. In order: runs the current
   * passage's `leave` effect, records a navigation event, moves to the target and
   * counts the visit, runs the target's `firstVisit` (on its first remembered visit) and
   * `enter` effects, then records the target's prose. If an effect throws on a
   * store with no uncommitted changes, the whole move is rolled back.
   * @throws {@link StateError} if `choice` isn't one of the current choices, or if an
   * effect throws or tries to navigate.
   */
  follow(choice: Choice): void;
  /**
   * Moves past the current passage's next beat, revealing the part after it:
   * runs that part's `firstVisit` (on the passage's first visit) and `enter`
   * effects, records a beat event and the part's prose, and logs the action,
   * so undo, saves, and replays stop at beat boundaries. Presentation calls it
   * when a timed beat's time is up, or the player moves on.
   * @throws {@link StateError} if the passage has no beat left, or an effect throws.
   */
  advance(): void;
  /**
   * Moves straight to a passage, as author code does. Records the same events as
   * {@link Story.follow}.
   * @throws {@link StateError} if there's no passage with that ID.
   */
  goTo(id: PassageId): void;
  /**
   * Takes an action, as from a thing's menu: the same `act` move as an
   * action link, staying on the passage. The page calls it when the player
   * chooses from a menu.
   * @throws {@link StateError} if the action is hidden or disabled now, saying why.
   */
  act(call: ActionCall): void;
  /**
   * Every action since the story began, oldest first: each successful
   * {@link Story.follow} and {@link Story.goTo}. The log lives in the state
   * store, so undo trims it and saves carry it.
   */
  readonly actions: readonly StoryAction[];
  /**
   * Takes one action, as {@link Story.follow} or {@link Story.goTo} would.
   * @throws {@link StateError} as those do.
   */
  perform(action: StoryAction): void;
  /**
   * The replay file for the story so far: its seed and {@link Story.actions},
   * the engine version, and `game` when given. Playing it on a fresh story
   * reproduces the state and event record exactly.
   * @throws {@link StateError} before {@link Story.begin}.
   */
  toReplay(game?: GameInfo): Replay;
  /**
   * Begins the story with a replay's seed and takes its actions in order. If an
   * action fails, for example because the game changed since the replay was
   * made, the story stays at the last action that worked, so it can be
   * inspected, and the error says if the replay came from another version.
   *
   * The story plays against the persistent data the replay began with, in
   * memory, so the player's own persistent data is never read or changed.
   *
   * Pass the running `game` to check the replay belongs to it. The result says
   * whether the replay came from the same game and engine versions.
   * @throws {@link StateError} if the story has already begun, if the replay is
   * from another game, or naming the first action that fails.
   */
  playReplay(replay: Replay, game?: GameInfo): ReplayCheck;
}

/** The state entity holding story progress. IDs starting with `$` are reserved for core. */
const STORY_ID = "$story";
const CURRENT_FIELD = "current";
/** How many beats the player has moved past in the current passage, when any. */
const STEP_FIELD = "step";
/** The state entity holding visit counts, one field per visited passage. */
const VISITS_ID = "$visits";
/** The state entity holding the persistent data as it was when the story began, for replays. */
const PERSISTENT_ID = "$persistent";
const AT_BEGIN_FIELD = "atBegin";
/** The state entity holding the action log: `length`, then one field per action by index. */
const ACTIONS_ID = "$actions";
const LENGTH_FIELD = "length";

/**
 * Creates the passage runtime.
 * @throws {@link StateError} if two passages share an ID or the start passage doesn't exist.
 */
export function createStory(
  store: StateStore,
  record: EventRecord,
  passages: readonly Passage[],
  options: StoryOptions,
): Story {
  const byId = new Map<PassageId, Passage>();
  for (const p of passages) {
    if (byId.has(p.id)) {
      throw new StateError(`passages: two passages are named ${JSON.stringify(p.id)}.`);
    }
    byId.set(p.id, p);
  }
  const lookup = (id: PassageId, where: string): Passage => {
    const p = byId.get(id);
    if (!p) throw new StateError(`${where}: there's no passage named ${JSON.stringify(id)}.`);
    return p;
  };
  lookup(options.start, "start");
  const defaultMode = options.guardMode ?? "hidden";
  /** A passage's tags, which every event recorded while the player is in it carries (#261). */
  const tagsOf = (id: PassageId | undefined): readonly string[] =>
    id === undefined ? [] : (byId.get(id)?.tags ?? []);
  /** Records events as being in `passage`, with its tags first. */
  const emitIn =
    (passage: PassageId | undefined): EventRecord["emit"] =>
    <K extends EventKind>(kind: K, fields: EventKinds[K], tags: readonly string[] = []) =>
      record.emit(kind, fields, [...tagsOf(passage), ...tags]);
  // Objects defined with object() read and write this story's store (ADR 0006),
  // and core's emit() records in this story's record, in the passage the player is in.
  bindObjects(store, (kind, fields, tags) => emitIn(current())(kind, fields, tags));

  const reader: StateReader = {
    get: (id, key) => store.get(id, key),
    has: (id, key) => store.has(id, key),
    entity: (id) => store.entity(id),
    ids: () => store.ids(),
  };
  // A replay swaps in its own copy, so it never touches the player's real data.
  let persistent = options.persistent ?? createPersistent();
  const persistentReader = (): StateReader => ({
    get: (id, key) => persistent.get(id, key),
    has: (id, key) => persistent.has(id, key),
    entity: (id) => persistent.entity(id),
    ids: () => persistent.ids(),
  });

  const current = (): PassageId | undefined => {
    const id = store.get(STORY_ID, CURRENT_FIELD);
    return typeof id === "string" ? id : undefined;
  };

  const totalVisits = (id: PassageId): number => {
    const n = store.get(VISITS_ID, id);
    return typeof n === "number" ? n : 0;
  };
  const visits = (id: PassageId): number => visitMemory()?.count(id) ?? totalVisits(id);

  const stepIn = (): number => {
    const n = store.get(STORY_ID, STEP_FIELD);
    return typeof n === "number" ? n : 0;
  };

  /**
   * Renders a passage as the player sees it after `step` beats, or with
   * `part`, only the part the last of those beats revealed.
   */
  const renderPassage = (passage: Passage, step = 0, part = false): RenderedPassage => {
    // A body only gets a read-only view, but it could still reach the store some
    // other way. Catch that when we can: a clean store must stay clean.
    const wasClean = !store.dirty;
    const count = visits(passage.id);
    const nodes = Object.freeze([
      ...renderingObjects(`passage ${JSON.stringify(passage.id)}`, () =>
        passage.body({
          state: reader,
          persistent: persistentReader(),
          passage: passage.id,
          visits: count,
          firstVisit: count === 1,
          visited: (id) => visits(id) > 0,
        }),
      ),
    ]);
    if (wasClean && store.dirty) {
      store.rollback();
      throw new StateError(
        `passage ${JSON.stringify(passage.id)}: rendering changed state. Rendering must be pure; change state in an effect phase such as {on enter: …} instead.`,
      );
    }
    // Beats divide the passage into parts; the player sees those up to `step`,
    // from the last page break before it.
    const beats = nodes.flatMap((n, i) => (n.type === "beat" ? [i] : []));
    const reached = Math.min(step, beats.length);
    let from = 0;
    for (let b = 0; b < reached; b++) {
      const at = beats[b] as number;
      if (part || (nodes[at] as BeatNode).page) from = at + 1;
    }
    const to = reached < beats.length ? (beats[reached] as number) : nodes.length;
    const beat = reached < beats.length ? (nodes[to] as BeatNode) : undefined;
    const shown: RenderedNode[] = [];
    const choices: Choice[] = [];
    const unavailable: UnavailableLink[] = [];
    /** Records a link as a choice or unavailable, and returns how it shows, if it does. */
    const place = (link: LinkNode): RenderedLink | undefined => {
      const guard = link.guard;
      if (!guard || guard.open) {
        choices.push(link);
        return { ...link, available: true };
      }
      const mode = guard.mode ?? defaultMode;
      unavailable.push(Object.freeze({ link, mode, condition: guard.condition }));
      if (mode === "hidden") return undefined;
      const reason = mode === "disabled-with-reason" ? guard.reason : undefined;
      return { ...link, available: false, ...(reason !== undefined && { reason }) };
    };
    for (const node of nodes.slice(from, to)) {
      if (node.type === "beat") continue;
      if (node.type === "text") {
        if (node.styles) checkStyles(passage.id, node);
        if (node.links) checkInlineLinks(passage.id, node);
        const { links, ...rest } = node;
        // A hidden inline link drops out of `links`; its label stays as plain text.
        const visible = (links ?? []).flatMap((l): RenderedInlineLink[] => {
          const shownLink = place(l);
          return shownLink ? [Object.freeze({ ...shownLink, start: l.start, end: l.end })] : [];
        });
        shown.push(
          Object.freeze(visible.length > 0 ? { ...rest, links: Object.freeze(visible) } : rest),
        );
      } else if (node.type === "continue") {
        shown.push(node);
        choices.push(node);
      } else if (node.type === "effect" || node.type === "notices") {
        shown.push(Object.freeze(node));
      } else {
        const link = place(node);
        if (link) shown.push(Object.freeze(link));
      }
    }
    return Object.freeze({
      passage,
      step: reached,
      ...(beat !== undefined && { beat: Object.freeze(beat) }),
      nodes: Object.freeze(shown),
      choices: Object.freeze(choices),
      unavailable: Object.freeze(unavailable),
    });
  };

  const contextFor = (passage: PassageId): EffectContext => {
    const count = visits(passage);
    return {
      state: { ...reader, set: store.set, delete: store.delete },
      persistent: {
        ...persistentReader(),
        set: (id, key, value) => {
          persistent.set(id, key, value);
        },
        delete: (id, key) => {
          persistent.delete(id, key);
        },
      },
      emit: emitIn(passage),
      passage,
      visits: count,
      firstVisit: count === 1,
      visited: (id) => visits(id) > 0,
    };
  };

  const hookContext = () => {
    const { state, persistent, emit } = contextFor(current() ?? options.start);
    return { state, persistent, emit };
  };

  /** Runs one effect phase, written after beat number `beat` when it's given. */
  const runEffect = (
    passage: Passage,
    phase: EffectPhase,
    effect: ((context: EffectContext) => void) | undefined,
    beat?: number,
  ): void => {
    if (!effect) return;
    emitIn(passage.id)("phase", {
      passage: passage.id,
      phase,
      ...(beat !== undefined && { beat }),
    });
    try {
      effect(contextFor(passage.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const where = beat === undefined ? "" : ` after beat ${String(beat)}`;
      throw new StateError(
        `passage ${JSON.stringify(passage.id)} ${phase} effect${where}: ${message}`,
        { cause: error },
      );
    }
  };
  const runPhase = (passage: Passage, phase: EffectPhase): void => {
    runEffect(passage, phase, passage.effects?.[phase]);
  };

  /** Records a passage's prose as the player reads it. */
  const recordProse = (passage: PassageId, nodes: readonly RenderedNode[]): void => {
    for (const node of nodes) {
      if (node.type !== "text") continue;
      emitIn(passage)("narrative", {
        text: node.text,
        ...(node.styles !== undefined && node.styles.length > 0 && { styles: node.styles }),
        ...(node.line !== undefined && { line: node.line }),
      });
    }
  };

  let navigating = false;

  const logLength = (): number => {
    const n = store.get(ACTIONS_ID, LENGTH_FIELD);
    return typeof n === "number" ? n : 0;
  };
  const log = (action: StoryAction): void => {
    const n = logLength();
    store.set(ACTIONS_ID, String(n), action);
    store.set(ACTIONS_ID, LENGTH_FIELD, n + 1);
  };

  /**
   * Moves to a passage: `start` when the story begins, `turn` for a player
   * action. `move` names the move for streams that reroll on undo (ADR 0014).
   */
  /** Runs `fn` as one move: all of it happens, or, when we can tell what it changed, none. */
  const transaction = (fn: () => void): void => {
    const wasClean = !store.dirty;
    // Persistent writes made by this move are undone with it if it fails.
    const kept = persistentState(persistent);
    kept.commit();
    navigating = true;
    try {
      fn();
    } catch (error) {
      // Leave no half-made move behind, when we can tell what the move changed.
      if (wasClean) store.rollback();
      kept.rollback();
      throw error;
    } finally {
      navigating = false;
    }
  };

  const enter = (to: Passage, why: "start" | "turn", move: string): void => {
    if (navigating) {
      throw new StateError(
        `can't move to ${JSON.stringify(to.id)} while an effect phase is running; effects change state, and links and continue points move between passages.`,
      );
    }
    transaction(() => {
      store.set(RANDOM_ID, MOVE_FIELD, move);
      const from = current();
      const leaving = from === undefined ? undefined : byId.get(from);
      if (why === "start") {
        hook("gameStart").run(hookContext());
      }
      if (leaving) {
        runPhase(leaving, "leave");
        hook("passageLeave").run(contextFor(leaving.id));
      }
      emitIn(to.id)("navigation", { ...(from !== undefined && { from }), to: to.id });
      store.set(STORY_ID, CURRENT_FIELD, to.id);
      if (store.has(STORY_ID, STEP_FIELD)) store.delete(STORY_ID, STEP_FIELD);
      store.set(VISITS_ID, to.id, totalVisits(to.id) + 1);
      visitMemory()?.record(to.id);
      if (visits(to.id) === 1) runPhase(to, "firstVisit");
      runPhase(to, "enter");
      hook("passageEnter").run(contextFor(to.id));
      recordProse(to.id, renderPassage(to).nodes);
      if (why === "turn") {
        hook("turnEnd").run(contextFor(to.id));
      }
    });
  };

  /** Moves past the current passage's next beat (see {@link Story.advance}). */
  const advance = (replayed?: number): void => {
    const id = current();
    if (id === undefined) throw new StateError("advance: call begin() first.");
    if (navigating) {
      throw new StateError(
        "can't advance while an effect phase is running; effects change state, and the page moves past beats.",
      );
    }
    const passage = lookup(id, "advance");
    const step = stepIn();
    const beat = renderPassage(passage, step).beat;
    if (!beat) {
      throw new StateError(
        `advance: passage ${JSON.stringify(id)} has no beat left to move past; follow one of its choices instead.`,
      );
    }
    const n = logLength();
    const tried = store.get(ATTEMPTS_ID, String(n));
    const attempt = replayed ?? (typeof tried === "number" ? tried : 0);
    transaction(() => {
      store.set(RANDOM_ID, MOVE_FIELD, `${String(n)}.${String(attempt)}`);
      store.set(STORY_ID, STEP_FIELD, step + 1);
      emitIn(id)("beat", { passage: id, step: step + 1, ...(beat.page && { page: true }) });
      const effects = passage.beats?.[step];
      if (visits(id) === 1) runEffect(passage, "firstVisit", effects?.firstVisit, step + 1);
      runEffect(passage, "enter", effects?.enter, step + 1);
      recordProse(id, renderPassage(passage, step + 1, true).nodes);
    });
    store.set(ATTEMPTS_ID, String(n), attempt + 1);
    log({ type: "advance", ...(attempt > 0 && { attempt }) });
  };

  /**
   * Takes a player action and logs it. A replayed action brings its attempt;
   * otherwise it's counted from the undo-proof tally of tries here (ADR 0014).
   */
  const act = (to: Passage, action: StoryAction, replayed?: number): void => {
    const n = logLength();
    const tried = store.get(ATTEMPTS_ID, String(n));
    const attempt = replayed ?? (typeof tried === "number" ? tried : 0);
    enter(to, "turn", `${String(n)}.${String(attempt)}`);
    store.set(ATTEMPTS_ID, String(n), attempt + 1);
    log({ ...action, ...(attempt > 0 && { attempt }) });
  };

  /**
   * Takes an action from a link's `{act …}`, through the action pipeline,
   * staying on the passage, and logs it (ADR 0044).
   */
  const takeAction = (logged: LoggedCall, label: string | undefined, replayed?: number): void => {
    const id = current();
    if (id === undefined) throw new StateError("an action: call begin() first.");
    if (navigating) {
      throw new StateError(
        "can't take an action while an effect phase is running; perform() it in the effect instead.",
      );
    }
    const call = callOf(logged);
    const n = logLength();
    const tried = store.get(ATTEMPTS_ID, String(n));
    const attempt = replayed ?? (typeof tried === "number" ? tried : 0);
    transaction(() => {
      store.set(RANDOM_ID, MOVE_FIELD, `${String(n)}.${String(attempt)}`);
      emitIn(id)("action", { action: logged.action, ...(label !== undefined && { label }) });
      perform(call);
      hook("turnEnd").run(contextFor(id));
    });
    store.set(ATTEMPTS_ID, String(n), attempt + 1);
    log({
      type: "act",
      action: logged.action,
      args: logged.args,
      ...(label !== undefined && { label }),
      ...(attempt > 0 && { attempt }),
    });
  };

  const follow = (choice: Choice, attempt?: number): void => {
    const page = story.render();
    const same = (c: Choice): boolean =>
      c.type === choice.type && c.target === choice.target && c.label === choice.label;
    const chosen = page.choices.find(same);
    if (chosen?.type === "link" && chosen.guard?.menu !== undefined) {
      throw new StateError(
        `follow: ${JSON.stringify(chosen.label)} opens a menu for ${JSON.stringify(chosen.guard.menu)}; take one of its actions with act() instead.`,
      );
    }
    if (chosen?.type === "link" && chosen.guard?.act) {
      takeAction(chosen.guard.act, chosen.label, attempt);
      return;
    }
    if (!page.choices.some(same)) {
      const closed = page.unavailable.find((u) => same(u.link));
      const name = JSON.stringify(choice.label ?? choice.target);
      const where = `passage ${JSON.stringify(current())}`;
      throw new StateError(
        closed
          ? `follow: ${name} in ${where} is unavailable because its condition \`${closed.condition}\` doesn't hold.`
          : `follow: ${name} isn't a choice in ${where}.`,
      );
    }
    act(
      lookup(choice.target, `follow from ${JSON.stringify(current())}`),
      { type: "follow", choice: choiceRef(choice) },
      attempt,
    );
  };

  const story: Story = {
    get current() {
      return current();
    },
    passage: (id) => byId.get(id),
    visits,
    visited: (id) => visits(id) > 0,
    totalVisits,
    begin() {
      if (current() !== undefined) return;
      const start = lookup(options.start, "begin");
      const wasClean = !store.dirty;
      try {
        // Before the start passage's effects, which may draw from streams.
        if (!store.has(RANDOM_ID, SEED_FIELD))
          store.set(RANDOM_ID, SEED_FIELD, options.seed ?? "0");
        // Effects may read persistent data, so replays need it as it was now (ADR 0011).
        store.set(PERSISTENT_ID, AT_BEGIN_FIELD, persistent.snapshot());
        enter(start, "start", "begin");
      } catch (error) {
        if (wasClean) store.rollback();
        throw error;
      }
    },
    render() {
      const id = current();
      if (id === undefined) throw new StateError("render: call begin() first.");
      return renderPassage(lookup(id, "render"), stepIn());
    },
    follow: (choice) => {
      follow(choice);
    },
    advance: () => {
      advance();
    },
    goTo: (id) => {
      act(lookup(id, "goTo"), { type: "goTo", passage: id });
    },
    get actions() {
      const out: StoryAction[] = [];
      for (let i = 0; i < logLength(); i++) {
        out.push(store.get(ACTIONS_ID, String(i)) as unknown as StoryAction);
      }
      return out;
    },
    act(call) {
      const status = statusOf(call);
      const why = status.hidden ?? status.disabled;
      if (why !== undefined) {
        throw new StateError(`act: ${JSON.stringify(status.label)} can't be taken now: ${why}`);
      }
      takeAction(logCall(call), status.label);
    },
    perform(action) {
      if (action.type === "follow") follow(action.choice, action.attempt);
      else if (action.type === "advance") advance(action.attempt);
      else if (action.type === "act") {
        takeAction({ action: action.action, args: action.args }, action.label, action.attempt);
      } else
        act(
          lookup(action.passage, "goTo"),
          { type: "goTo", passage: action.passage },
          action.attempt,
        );
    },
    toReplay(game) {
      const seed = store.get(RANDOM_ID, SEED_FIELD);
      if (current() === undefined || typeof seed !== "string") {
        throw new StateError("toReplay: call begin() first.");
      }
      const atBegin = store.get(PERSISTENT_ID, AT_BEGIN_FIELD) as StateSnapshot | undefined;
      return {
        format: REPLAY_FORMAT,
        version: REPLAY_VERSION,
        ...(game !== undefined && { game: { id: game.id, version: game.version } }),
        engine: ENGINE_VERSION,
        seed,
        ...(atBegin !== undefined && { persistent: atBegin }),
        actions: story.actions,
      };
    },
    playReplay(replay, game) {
      if (current() !== undefined) {
        throw new StateError(
          "playReplay: the story has already begun; play a replay on a fresh store.",
        );
      }
      const made = replay.game;
      if (made !== undefined && game !== undefined && made.id !== game.id) {
        throw new StateError(
          `playReplay: this replay is from the game ${JSON.stringify(made.id)}, not ${JSON.stringify(game.id)}.`,
        );
      }
      const check: ReplayCheck = {
        ...(made !== undefined &&
          game !== undefined && { sameGameVersion: made.version === game.version }),
        ...(replay.engine !== undefined && { sameEngineVersion: replay.engine === ENGINE_VERSION }),
      };
      // When a replay diverges, a version difference is the likeliest reason.
      const versions = [
        check.sameGameVersion === false &&
          `version ${made?.version ?? ""} of the game; this is ${game?.version ?? ""}`,
        check.sameEngineVersion === false &&
          `engine ${replay.engine ?? ""}; this is ${ENGINE_VERSION}`,
      ].filter((v): v is string => v !== false);
      const note =
        versions.length === 0 ? "" : ` The replay was made with ${versions.join(", and ")}.`;
      if (!store.has(RANDOM_ID, SEED_FIELD)) store.set(RANDOM_ID, SEED_FIELD, replay.seed);
      // The persistent data the replay began with, in memory: the player's own is never touched.
      persistent = createPersistent(replay.persistent ?? {});
      story.begin();
      replay.actions.forEach((action, i) => {
        try {
          story.perform(action);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new StateError(
            `replay action ${String(i + 1)} of ${String(replay.actions.length)} (${describe(action)}): ${message}${note}`,
            { cause: error },
          );
        }
      });
      return check;
    },
  };
  return story;
}

/** An action as a reader would say it, for replay errors. */
function describe(action: StoryAction): string {
  if (action.type === "goTo") return `go to ${JSON.stringify(action.passage)}`;
  if (action.type === "advance") return "move past a beat";
  if (action.type === "act")
    return `take the action ${JSON.stringify(action.label ?? action.action)}`;
  const { type, label, target } = action.choice;
  const verb = type === "link" ? "follow" : "continue";
  const name = label === undefined ? "" : ` ${JSON.stringify(label)}`;
  return `${verb}${name} to ${JSON.stringify(target)}`;
}
