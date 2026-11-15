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

/** Read-only access to state, which is all a passage body gets. */
export type StateReader = Pick<StateStore, "get" | "has" | "entity" | "ids">;

/** What a passage body can see while rendering. */
export interface RenderContext {
  /** The game state, read-only. */
  readonly state: StateReader;
  /** The passage being rendered. */
  readonly passage: PassageId;
}

/** A compiled passage. The compiler produces these from `:: Name [tags]` blocks. */
export interface Passage {
  /** The passage's ID, from its name. */
  readonly id: PassageId;
  /** Tags from `[tags]`, which assign roles such as `scene`. */
  readonly tags: readonly string[];
  /** Renders the passage. Must be pure: it may read state but never change it. */
  readonly body: (context: RenderContext) => readonly PassageNode[];
}

/** A rendered passage. */
export interface RenderedPassage {
  /** The passage rendered. */
  readonly passage: Passage;
  /** Its text, links, and continue points, in reading order. */
  readonly nodes: readonly PassageNode[];
  /** Its links and continue points, in reading order. */
  readonly choices: readonly Choice[];
}

/** Options for {@link createStory}. */
export interface StoryOptions {
  /** The passage the story starts in. */
  readonly start: PassageId;
}

/** Plays a set of compiled passages over a state store and event record. */
export interface Story {
  /** The current passage's ID, or `undefined` before {@link Story.begin}. */
  readonly current: PassageId | undefined;
  /** Looks up a passage by ID. */
  passage(id: PassageId): Passage | undefined;
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
   * Follows one of the current passage's choices: records a navigation event,
   * moves to the target, and records the target's prose.
   * @throws {@link StateError} if `choice` isn't one of the current choices.
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

  const renderPassage = (passage: Passage): RenderedPassage => {
    // A body only gets a read-only view, but it could still reach the store some
    // other way. Catch that when we can: a clean store must stay clean.
    const wasClean = !store.dirty;
    const nodes = Object.freeze([...passage.body({ state: reader, passage: passage.id })]);
    if (wasClean && store.dirty) {
      store.rollback();
      throw new StateError(
        `passage ${JSON.stringify(passage.id)}: rendering changed state. Rendering must be pure; change state in an effect phase such as {on enter: …} instead.`,
      );
    }
    const choices = Object.freeze(
      nodes.filter((n): n is Choice => n.type === "link" || n.type === "continue"),
    );
    return Object.freeze({ passage, nodes, choices });
  };

  const enter = (to: Passage): void => {
    const from = current();
    record.emit("navigation", { ...(from !== undefined && { from }), to: to.id });
    store.set(STORY_ID, CURRENT_FIELD, to.id);
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
    begin() {
      if (current() === undefined) enter(lookup(options.start, "begin"));
    },
    render() {
      const id = current();
      if (id === undefined) throw new StateError("render: call begin() first.");
      return renderPassage(lookup(id, "render"));
    },
    follow(choice) {
      const offered = story
        .render()
        .choices.some(
          (c) => c.type === choice.type && c.target === choice.target && c.label === choice.label,
        );
      if (!offered) {
        throw new StateError(
          `follow: ${JSON.stringify(choice.label ?? choice.target)} isn't a choice in passage ${JSON.stringify(current())}.`,
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
