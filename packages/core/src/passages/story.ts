/**
 * The passage runtime: plays compiled passages.
 *
 * A compiled passage is an ID, tags, and a pure `body` function that turns the
 * current state into text, links, and continue points. Rendering can happen any
 * number of times without changing anything; state changes only when the
 * player follows a link, which moves to the next passage and records it in the
 * event record.
 */
import type { EventRecord, LineId } from "../events/record.js";
import type { StateId, StateStore } from "../state/store.js";
import { StateError } from "../state/value.js";

/** A passage's ID: its name from `:: Name`. */
export type PassageId = StateId;

/** A run of prose in a rendered passage. */
export type TextNode = {
  /** Node type. */
  readonly type: "text";
  /** The prose. */
  readonly text: string;
  /** The authored line it came from, when it came from one. */
  readonly line?: LineId;
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

/** One piece of a rendered passage, in reading order. */
export type PassageNode = TextNode | LinkNode | ContinueNode;

/** A way out of the current passage: a link or a continue point. */
export type Choice = LinkNode | ContinueNode;

/** One piece of a rendered passage. Hidden links are left out; disabled ones stay in. */
export type RenderedNode = TextNode | RenderedLink | ContinueNode;

/** Read-only access to state, which is all a passage body gets. */
export type StateReader = Pick<StateStore, "get" | "has" | "entity" | "ids">;

/** What a passage body can see while rendering. */
export interface RenderContext {
  /** The game state, read-only. */
  readonly state: StateReader;
  /** The passage being rendered. */
  readonly passage: PassageId;
  /** How many times the player has entered this passage, counting the current visit. */
  readonly visits: number;
  /** Whether this is the player's first visit to this passage. */
  readonly firstVisit: boolean;
  /** Whether the player has ever entered `passage`. */
  visited(passage: PassageId): boolean;
}

/** Read and write access to state, which effect phases get. */
export type StateWriter = StateReader & Pick<StateStore, "set" | "delete">;

/** The effect phases a passage can declare. */
export type EffectPhase = "firstVisit" | "enter" | "leave";

/** What an effect phase can see and do. */
export interface EffectContext extends Omit<RenderContext, "state"> {
  /** The game state. Changes are recorded for undo, save, and replay. */
  readonly state: StateWriter;
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
}

/** A rendered passage. */
export interface RenderedPassage {
  /** The passage rendered. */
  readonly passage: Passage;
  /** What the player sees, in reading order: text, links (hidden ones left out), and continue points. */
  readonly nodes: readonly RenderedNode[];
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
}

/** Plays a set of compiled passages over a state store and event record. */
export interface Story {
  /** The current passage's ID, or `undefined` before {@link Story.begin}. */
  readonly current: PassageId | undefined;
  /** Looks up a passage by ID. */
  passage(id: PassageId): Passage | undefined;
  /** How many times the player has entered a passage. Following a link back to the same passage counts. */
  visits(id: PassageId): number;
  /** Whether the player has ever entered a passage. */
  visited(id: PassageId): boolean;
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
   * counts the visit, runs the target's `firstVisit` (on its first visit) and
   * `enter` effects, then records the target's prose. If an effect throws on a
   * store with no uncommitted changes, the whole move is rolled back.
   * @throws {@link StateError} if `choice` isn't one of the current choices, or if an
   * effect throws or tries to navigate.
   */
  follow(choice: Choice): void;
  /**
   * Moves straight to a passage, as author code does. Records the same events as
   * {@link Story.follow}.
   * @throws {@link StateError} if there's no passage with that ID.
   */
  goTo(id: PassageId): void;
}

/** The state entity holding story progress. IDs starting with `$` are reserved for core. */
const STORY_ID = "$story";
const CURRENT_FIELD = "current";
/** The state entity holding visit counts, one field per visited passage. */
const VISITS_ID = "$visits";

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

  const reader: StateReader = {
    get: (id, key) => store.get(id, key),
    has: (id, key) => store.has(id, key),
    entity: (id) => store.entity(id),
    ids: () => store.ids(),
  };

  const current = (): PassageId | undefined => {
    const id = store.get(STORY_ID, CURRENT_FIELD);
    return typeof id === "string" ? id : undefined;
  };

  const visits = (id: PassageId): number => {
    const n = store.get(VISITS_ID, id);
    return typeof n === "number" ? n : 0;
  };

  const renderPassage = (passage: Passage): RenderedPassage => {
    // A body only gets a read-only view, but it could still reach the store some
    // other way. Catch that when we can: a clean store must stay clean.
    const wasClean = !store.dirty;
    const count = visits(passage.id);
    const nodes = Object.freeze([
      ...passage.body({
        state: reader,
        passage: passage.id,
        visits: count,
        firstVisit: count === 1,
        visited: (id) => visits(id) > 0,
      }),
    ]);
    if (wasClean && store.dirty) {
      store.rollback();
      throw new StateError(
        `passage ${JSON.stringify(passage.id)}: rendering changed state. Rendering must be pure; change state in an effect phase such as {on enter: …} instead.`,
      );
    }
    const shown: RenderedNode[] = [];
    const choices: Choice[] = [];
    const unavailable: UnavailableLink[] = [];
    for (const node of nodes) {
      if (node.type !== "link") {
        shown.push(node);
        if (node.type === "continue") choices.push(node);
        continue;
      }
      const guard = node.guard;
      if (!guard || guard.open) {
        shown.push(Object.freeze({ ...node, available: true }));
        choices.push(node);
        continue;
      }
      const mode = guard.mode ?? defaultMode;
      unavailable.push(Object.freeze({ link: node, mode, condition: guard.condition }));
      if (mode === "hidden") continue;
      const reason = mode === "disabled-with-reason" ? guard.reason : undefined;
      shown.push(
        Object.freeze({ ...node, available: false, ...(reason !== undefined && { reason }) }),
      );
    }
    return Object.freeze({
      passage,
      nodes: Object.freeze(shown),
      choices: Object.freeze(choices),
      unavailable: Object.freeze(unavailable),
    });
  };

  const contextFor = (passage: PassageId): EffectContext => {
    const count = visits(passage);
    return {
      state: { ...reader, set: store.set, delete: store.delete },
      emit: record.emit,
      passage,
      visits: count,
      firstVisit: count === 1,
      visited: (id) => visits(id) > 0,
    };
  };

  const runPhase = (passage: Passage, phase: EffectPhase): void => {
    const effect = passage.effects?.[phase];
    if (!effect) return;
    record.emit("phase", { passage: passage.id, phase });
    try {
      effect(contextFor(passage.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new StateError(`passage ${JSON.stringify(passage.id)} ${phase} effect: ${message}`, {
        cause: error,
      });
    }
  };

  let navigating = false;

  const enter = (to: Passage): void => {
    if (navigating) {
      throw new StateError(
        `can't move to ${JSON.stringify(to.id)} while an effect phase is running; effects change state, and links and continue points move between passages.`,
      );
    }
    const wasClean = !store.dirty;
    navigating = true;
    try {
      const from = current();
      const leaving = from === undefined ? undefined : byId.get(from);
      if (leaving) runPhase(leaving, "leave");
      record.emit("navigation", { ...(from !== undefined && { from }), to: to.id });
      store.set(STORY_ID, CURRENT_FIELD, to.id);
      store.set(VISITS_ID, to.id, visits(to.id) + 1);
      if (visits(to.id) === 1) runPhase(to, "firstVisit");
      runPhase(to, "enter");
    } catch (error) {
      // Leave no half-made move behind, when we can tell what the move changed.
      if (wasClean) store.rollback();
      throw error;
    } finally {
      navigating = false;
    }
    for (const node of renderPassage(to).nodes) {
      if (node.type !== "text") continue;
      record.emit("narrative", {
        text: node.text,
        ...(node.line !== undefined && { line: node.line }),
      });
    }
  };

  const story: Story = {
    get current() {
      return current();
    },
    passage: (id) => byId.get(id),
    visits,
    visited: (id) => visits(id) > 0,
    begin() {
      if (current() === undefined) enter(lookup(options.start, "begin"));
    },
    render() {
      const id = current();
      if (id === undefined) throw new StateError("render: call begin() first.");
      return renderPassage(lookup(id, "render"));
    },
    follow(choice) {
      const page = story.render();
      const same = (c: Choice): boolean =>
        c.type === choice.type && c.target === choice.target && c.label === choice.label;
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
      enter(lookup(choice.target, `follow from ${JSON.stringify(current())}`));
    },
    goTo(id) {
      enter(lookup(id, "goTo"));
    },
  };
  return story;
}
