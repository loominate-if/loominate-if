/**
 * Action logs and replay files (#25, ADR 0009).
 *
 * A seed plus the list of actions the player took reproduces a playthrough
 * exactly (design principle 4). The story keeps its action log in the state
 * store, beside the event record, so undo trims it and saves carry it. A replay
 * file is that seed and log as JSON, small enough to attach to a bug report.
 */
import type { PassageId } from "../passages/story.js";
import type { GameInfo } from "../save/save.js";
import { createStore, type StateSnapshot } from "../state/store.js";
import { StateError } from "../state/value.js";

/**
 * Which choice the player followed: the fields {@link Story.follow} matches a
 * choice by. A guard isn't part of it, since that's worked out again on replay.
 */
export type ChoiceRef =
  | {
      /** A link. */
      readonly type: "link";
      /** The passage it leads to. */
      readonly target: PassageId;
      /** Its label. */
      readonly label: string;
    }
  | {
      /** A continue point. */
      readonly type: "continue";
      /** The passage it leads to. */
      readonly target: PassageId;
      /** Its label, when it has one. */
      readonly label?: string;
    };

/**
 * One thing the player did, as logged and replayed: following one of the
 * current passage's choices ({@link Story.follow}), or moving straight to a
 * passage ({@link Story.goTo}).
 */
export type StoryAction = (
  | { readonly type: "follow"; readonly choice: ChoiceRef }
  | { readonly type: "goTo"; readonly passage: PassageId }
) & {
  /**
   * How many times an action was taken here before and then undone, when it
   * was. Streams that reroll on undo draw from it (ADR 0014).
   */
  readonly attempt?: number;
};

/** The `format` field of every replay file. */
export const REPLAY_FORMAT = "loominate-replay";
/**
 * The replay file version this engine writes. It also reads version 1 files,
 * which don't record the game or engine, version 2 files, which don't record
 * persistent data, and version 3 files, which don't record attempts.
 */
export const REPLAY_VERSION = 4;

/** A replay file: the master seed and every action since the story began. */
export type Replay = {
  /** Always {@link REPLAY_FORMAT}, so a replay can't be mistaken for another JSON file. */
  readonly format: typeof REPLAY_FORMAT;
  /** The file's version, {@link REPLAY_VERSION}. Older files read as this version. */
  readonly version: typeof REPLAY_VERSION;
  /** The game that made the replay, when the host said. */
  readonly game?: GameInfo;
  /** The `ENGINE_VERSION` that made the replay. Missing only from version 1 files. */
  readonly engine?: string;
  /** The master seed the story began with (ADR 0008). */
  readonly seed: string;
  /**
   * The persistent data when the story began (ADR 0011), which a replay plays
   * against. Missing from older files, which play against none.
   */
  readonly persistent?: StateSnapshot;
  /** The actions, in the order they were taken. */
  readonly actions: readonly StoryAction[];
};

/**
 * How a replay compares with the game playing it, from {@link Story.playReplay}.
 * A field is missing when the replay or the caller didn't say, for example for
 * a version 1 file.
 */
export type ReplayCheck = {
  /** Whether the replay was made by the same version of the game. */
  readonly sameGameVersion?: boolean;
  /** Whether the replay was made by the same engine version. */
  readonly sameEngineVersion?: boolean;
};

/**
 * Writes a replay file: JSON, with one action per line so replays diff well.
 */
export function writeReplay(replay: Replay): string {
  const actions = replay.actions.map((a) => `    ${JSON.stringify(canonical(a))}`);
  return [
    "{",
    `  "format": ${JSON.stringify(REPLAY_FORMAT)},`,
    `  "version": ${String(REPLAY_VERSION)},`,
    ...(replay.game === undefined
      ? []
      : [`  "game": ${JSON.stringify({ id: replay.game.id, version: replay.game.version })},`]),
    ...(replay.engine === undefined ? [] : [`  "engine": ${JSON.stringify(replay.engine)},`]),
    `  "seed": ${JSON.stringify(replay.seed)},`,
    ...(replay.persistent === undefined
      ? []
      : [`  "persistent": ${JSON.stringify(replay.persistent)},`]),
    actions.length === 0 ? `  "actions": []` : `  "actions": [\n${actions.join(",\n")}\n  ]`,
    "}",
    "",
  ].join("\n");
}

/** An action with its fields in a fixed order, so the same replay always writes the same text. */
function canonical(action: StoryAction): StoryAction {
  const attempt = action.attempt ? { attempt: action.attempt } : {};
  if (action.type === "goTo") return { type: "goTo", passage: action.passage, ...attempt };
  return { type: "follow", choice: choiceRef(action.choice), ...attempt };
}

/** The fields of a choice that identify it, in a fixed order. */
export function choiceRef(choice: ChoiceRef): ChoiceRef {
  const { type, target, label } = choice;
  return type === "link"
    ? { type, target, label }
    : { type, target, ...(label !== undefined && { label }) };
}

/**
 * Reads a replay file written by {@link writeReplay}.
 * @throws {@link StateError} if `text` isn't a replay file this engine can read, saying what's wrong.
 */
export function readReplay(text: string): Replay {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new StateError(`replay: the file isn't valid JSON (${reason}).`, { cause: error });
  }
  if (!isRecord(data) || data.format !== REPLAY_FORMAT) {
    throw new StateError(
      `replay: this isn't a replay file; it needs "format": "${REPLAY_FORMAT}".`,
    );
  }
  if (data.version !== 1 && data.version !== 2 && data.version !== 3 && data.version !== 4) {
    throw new StateError(
      typeof data.version === "number" && data.version > REPLAY_VERSION
        ? `replay: the file is version ${String(data.version)}, made by a newer engine; this one reads versions 1 to ${String(REPLAY_VERSION)}.`
        : `replay: "version" must be 1, 2, 3, or ${String(REPLAY_VERSION)}.`,
    );
  }
  onlyFields(data, FIELDS[data.version], "the file");
  let game: GameInfo | undefined;
  if (data.game !== undefined) {
    const g = data.game;
    if (!isRecord(g) || !isName(g.id) || !isName(g.version)) {
      throw new StateError(`replay: "game" needs a non-empty "id" and "version".`);
    }
    onlyFields(g, ["id", "version"], `"game"`);
    game = { id: g.id, version: g.version };
  }
  if (data.version !== 1 && !isName(data.engine)) {
    throw new StateError(`replay: "engine" must be a version string.`);
  }
  const engine = data.engine as string | undefined;
  if (typeof data.seed !== "string") throw new StateError(`replay: "seed" must be a string.`);
  if (!Array.isArray(data.actions)) throw new StateError(`replay: "actions" must be a list.`);
  let persistent: StateSnapshot | undefined;
  if (data.persistent !== undefined) {
    if (!isRecord(data.persistent)) {
      throw new StateError(`replay: "persistent" must be an object of entities.`);
    }
    // The store checks every ID and value, as it does for any snapshot.
    persistent = createStore(data.persistent as StateSnapshot).snapshot();
  }
  const attempts = data.version === 4;
  const actions = (data.actions as unknown[]).map((a, i) => readAction(a, i, attempts));
  return {
    format: REPLAY_FORMAT,
    version: REPLAY_VERSION,
    ...(game !== undefined && { game }),
    ...(engine !== undefined && { engine }),
    seed: data.seed,
    ...(persistent !== undefined && { persistent }),
    actions,
  };
}

/** The fields each file version may have. */
const FIELDS = {
  1: ["format", "version", "seed", "actions"],
  2: ["format", "version", "game", "engine", "seed", "actions"],
  3: ["format", "version", "game", "engine", "seed", "persistent", "actions"],
  4: ["format", "version", "game", "engine", "seed", "persistent", "actions"],
} as const;

function readAction(value: unknown, index: number, attempts: boolean): StoryAction {
  const where = `action ${String(index + 1)}`;
  const bad = (what: string): StateError => new StateError(`replay: ${where} ${what}.`);
  if (!isRecord(value)) throw bad("must be an object");
  // Version 4 added "attempt", left out when it's 0.
  const extra = attempts ? ["attempt"] : [];
  const attempt = value.attempt;
  if (attempt !== undefined && !(Number.isSafeInteger(attempt) && (attempt as number) > 0)) {
    throw bad(`has an "attempt" that isn't a whole number above 0`);
  }
  const tried = attempt === undefined ? {} : { attempt: attempt as number };
  if (value.type === "goTo") {
    onlyFields(value, ["type", "passage", ...extra], where);
    if (!isName(value.passage)) throw bad(`needs a "passage" name`);
    return { type: "goTo", passage: value.passage, ...tried };
  }
  if (value.type === "follow") {
    onlyFields(value, ["type", "choice", ...extra], where);
    const choice = value.choice;
    if (!isRecord(choice)) throw bad(`needs a "choice" object`);
    onlyFields(choice, ["type", "target", "label"], `${where}'s choice`);
    if (choice.type !== "link" && choice.type !== "continue") {
      throw bad(`has a choice whose "type" isn't "link" or "continue"`);
    }
    if (!isName(choice.target)) throw bad(`has a choice with no "target" passage`);
    if (choice.label !== undefined && typeof choice.label !== "string") {
      throw bad(`has a choice whose "label" isn't a string`);
    }
    if (choice.type === "link") {
      if (choice.label === undefined) throw bad(`has a link with no "label"`);
      return {
        type: "follow",
        choice: { type: "link", target: choice.target, label: choice.label },
        ...tried,
      };
    }
    const label = choice.label;
    return {
      type: "follow",
      choice: { type: "continue", target: choice.target, ...(label !== undefined && { label }) },
      ...tried,
    };
  }
  throw bad(`has an unknown "type"; actions are "follow" or "goTo"`);
}

function onlyFields(value: Record<string, unknown>, allowed: readonly string[], where: string) {
  const extra = Object.keys(value).find((k) => !allowed.includes(k));
  if (extra !== undefined) {
    throw new StateError(
      `replay: ${where} has an unknown field ${JSON.stringify(extra)}; expected ${allowed.map((k) => JSON.stringify(k)).join(", ")}.`,
    );
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isName = (v: unknown): v is string => typeof v === "string" && v.length > 0;
