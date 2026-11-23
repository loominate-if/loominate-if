/**
 * The event record: every piece of output, as structured, tagged data.
 *
 * Runtime logic never writes to the screen. It emits events, and the page, the
 * story log, and the full transcript are all views of this record. The record
 * lives in the state store, so undo trims it and saves carry it.
 */
import type { StateId, StateStore } from "../state/store.js";
import { freezeValue, StateError } from "../state/value.js";

/**
 * A stable ID for an authored line of prose or dialogue, assigned by the
 * compiler. The scheme is defined in #34.
 */
export type LineId = string;

/**
 * Formatting over part of a piece of prose, from `*emphasis*` or `**strong**`.
 *
 * @remarks
 * Offsets are UTF-16 positions in the prose's `text`: `start` inclusive, `end`
 * exclusive, never empty. Styles may nest but never partly overlap. Keeping
 * formatting beside the text, rather than in it, leaves `text` plain for
 * transcripts, search, and line IDs.
 */
export type TextStyle = {
  /** Offset of the first styled character. */
  readonly start: number;
  /** Offset just past the last styled character. */
  readonly end: number;
  /** How the range is styled. */
  readonly style: "emphasis" | "strong";
};

/** Fields shared by events that carry author prose. */
export type ProseFields = {
  /** The text as rendered. */
  readonly text: string;
  /** Formatting over parts of `text`, when it has any. */
  readonly styles?: readonly TextStyle[];
  /** The authored line this text came from, when it came from one. */
  readonly line?: LineId;
};

/**
 * The fields of each kind of event, by kind name.
 *
 * @remarks
 * Extend this interface to add event kinds, using declaration merging:
 *
 * ```ts
 * declare module "@loominate-if/core" {
 *   interface EventKinds {
 *     "combat-round": { readonly round: number; readonly text: string };
 *   }
 * }
 * ```
 *
 * Field types must be {@link StateValue}s, because events live in the state store.
 */
export interface EventKinds {
  /** Passage prose. */
  narrative: ProseFields;
  /** Text from a cut scene or beat sequence. */
  scene: ProseFields;
  /** A line spoken by a character. */
  dialogue: ProseFields & {
    /** Who is speaking, when known. */
    readonly speaker?: StateId;
  };
  /** A room's description. */
  "room-description": ProseFields & {
    /** The room described. */
    readonly room: StateId;
  };
  /** What happened as the result of an action. */
  "action-result": ProseFields;
  /**
   * Something the player noticed by sight or sound, such as "You hear a door
   * slam upstairs." The page shows a move's perception events above the
   * passage. The world model's perception layer records them.
   */
  perception: ProseFields & {
    /** How it was noticed. */
    readonly sense: "see" | "hear";
    /** The thing that was noticed, if any. */
    readonly source?: StateId;
  };
  /**
   * What a fuse or daemon said when it fired, such as "Somewhere behind
   * you, timber gives way." The page shows it with the move's notices.
   */
  scheduled: ProseFields & {
    /** The fuse or daemon's ID; for a sentence several joined, the first's. */
    readonly source: StateId;
    /**
     * Whether it stands out, in a paragraph of its own. Otherwise it's
     * atmosphere: a move's atmosphere runs together in one paragraph, so a
     * player can skim it.
     */
    readonly standsOut?: boolean;
  };
  /** The player took an action, such as from an `{act …}` link: a move that stays on the passage. */
  action: {
    /** The action's name. */
    readonly action: string;
    /** The label of the link it came from, if any. */
    readonly label?: string;
  };
  /** Moving between passages or locations. */
  navigation: {
    /** Where the move started, if anywhere. */
    readonly from?: StateId;
    /** Where the move ended. */
    readonly to: StateId;
  };
  /** A message from the system rather than the story, such as "Game saved." */
  system: ProseFields;
  /** An effect phase ran, such as `{on enter: …}`. Recorded for the inspector. */
  phase: {
    /** The passage whose effect ran. */
    readonly passage: StateId;
    /** Which phase ran. */
    readonly phase: "firstVisit" | "enter" | "leave";
    /** For phases written after a beat, which beat they follow, from 1. */
    readonly beat?: number;
  };
  /** The player moved past a beat in a passage, revealing its next part. */
  beat: {
    /** The passage. */
    readonly passage: StateId;
    /** How many beats the player has now moved past in this visit, from 1. */
    readonly step: number;
    /** True when the beat was a page break, so what came before left the screen. */
    readonly page?: boolean;
  };
}

/** The name of an event kind. */
export type EventKind = keyof EventKinds & string;

/** An event in the record. */
export type RecordedEvent<K extends EventKind = EventKind> = {
  [Kind in K]: EventKinds[Kind] & {
    /** Position in the record, from 0. When undo trims events, their positions are reused. */
    readonly seq: number;
    /** The event's kind. */
    readonly kind: Kind;
    /** Author and library tags, for filtering views such as the story log. */
    readonly tags: readonly string[];
  };
}[K];

/** Which events {@link EventRecord.events} returns. All given conditions must match. */
export type EventQuery<K extends EventKind = EventKind> = {
  /** Only events at or after this `seq`. */
  readonly since?: number;
  /** Only events of these kinds. */
  readonly kinds?: readonly K[];
  /** Only events with every one of these tags. */
  readonly tags?: readonly string[];
};

/** The record of everything the game has output. */
export interface EventRecord {
  /** The `seq` the next event will get, which is also the number of events recorded. */
  readonly length: number;
  /**
   * Records an event and returns it.
   * @throws {@link StateError} if the fields aren't valid state or a tag is empty.
   */
  emit<K extends EventKind>(
    kind: K,
    fields: EventKinds[K],
    tags?: readonly string[],
  ): RecordedEvent<K>;
  /** Returns recorded events in order, optionally filtered. */
  events<K extends EventKind = EventKind>(query?: EventQuery<K>): RecordedEvent<K>[];
}

/** The state store entity holding the record. IDs starting with `$` are reserved for core. */
const RECORD_ID = "$events";
/** Field holding the number of events, so appending and reading recent events stay cheap. */
const LENGTH_FIELD = "length";

const fieldFor = (seq: number): string => String(seq);

/** Creates the event record over `store`, continuing any events already in it. */
export function createEventRecord(store: StateStore): EventRecord {
  const length = (): number => (store.get(RECORD_ID, LENGTH_FIELD) as number | undefined) ?? 0;

  return {
    get length() {
      return length();
    },
    emit(kind, fields, tags = []) {
      if (typeof kind !== "string" || kind.length === 0) {
        throw new StateError("emit: the event kind must be a non-empty string.");
      }
      const bad = tags.find((t) => typeof t !== "string" || t.length === 0);
      if (bad !== undefined) throw new StateError(`emit ${kind}: tags must be non-empty strings.`);
      if ("seq" in fields || "kind" in fields || "tags" in fields) {
        throw new StateError(`emit ${kind}: "seq", "kind", and "tags" are set by the record.`);
      }
      const seq = length();
      const event = freezeValue(
        { ...(fields as Record<string, unknown>), seq, kind, tags: [...new Set(tags)] },
        `event ${kind}`,
      );
      store.set(RECORD_ID, fieldFor(seq), event);
      store.set(RECORD_ID, LENGTH_FIELD, seq + 1);
      return event as unknown as RecordedEvent<typeof kind>;
    },
    events<K extends EventKind>(query: EventQuery<K> = {}) {
      const { since = 0, kinds, tags } = query;
      const out: RecordedEvent<K>[] = [];
      for (let seq = Math.max(0, since); seq < length(); seq++) {
        const e = store.get(RECORD_ID, fieldFor(seq)) as unknown as RecordedEvent;
        if (kinds && !(kinds as readonly string[]).includes(e.kind)) continue;
        if (tags && !tags.every((t) => e.tags.includes(t))) continue;
        out.push(e as unknown as RecordedEvent<K>);
      }
      return out;
    },
  };
}

/**
 * Groups a move's notices into paragraphs, as the page shows them: each
 * notice is its own, except that `scheduled` events that don't stand out
 * are atmosphere, gathered into one paragraph where the first of them is,
 * so a player can skim it and catch what stands out.
 * @internal
 */
export function _noticeParagraphs<E extends { readonly kind: string }>(
  notices: readonly E[],
): E[][] {
  const out: E[][] = [];
  let atmosphere: E[] | undefined;
  for (const e of notices) {
    if (e.kind === "scheduled" && (e as { readonly standsOut?: boolean }).standsOut !== true) {
      if (atmosphere) {
        atmosphere.push(e);
        continue;
      }
      atmosphere = [];
      atmosphere.push(e);
      out.push(atmosphere);
    } else out.push([e]);
  }
  return out;
}
