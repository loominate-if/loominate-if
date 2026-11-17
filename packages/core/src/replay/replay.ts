/**
 * Action logs and replay files (#25, ADR 0009).
 *
 * A seed plus the list of actions the player took reproduces a playthrough
 * exactly (design principle 4). The story keeps its action log in the state
 * store, beside the event record, so undo trims it and saves carry it. A replay
 * file is that seed and log as JSON, small enough to attach to a bug report.
 */
import type { PassageId } from "../passages/story.js";
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
export type StoryAction =
  | { readonly type: "follow"; readonly choice: ChoiceRef }
  | { readonly type: "goTo"; readonly passage: PassageId };

/** The `format` field of every replay file. */
export const REPLAY_FORMAT = "loominate-replay";
/** The replay file version this engine reads and writes. */
export const REPLAY_VERSION = 1;

/** A replay file: the master seed and every action since the story began. */
export type Replay = {
  /** Always {@link REPLAY_FORMAT}, so a replay can't be mistaken for another JSON file. */
  readonly format: typeof REPLAY_FORMAT;
  /** The file's version, {@link REPLAY_VERSION}. */
  readonly version: typeof REPLAY_VERSION;
  /** The master seed the story began with (ADR 0008). */
  readonly seed: string;
  /** The actions, in the order they were taken. */
  readonly actions: readonly StoryAction[];
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
    `  "seed": ${JSON.stringify(replay.seed)},`,
    actions.length === 0 ? `  "actions": []` : `  "actions": [\n${actions.join(",\n")}\n  ]`,
    "}",
    "",
  ].join("\n");
}

/** An action with its fields in a fixed order, so the same replay always writes the same text. */
function canonical(action: StoryAction): StoryAction {
  if (action.type === "goTo") return { type: "goTo", passage: action.passage };
  return { type: "follow", choice: choiceRef(action.choice) };
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
  if (data.version !== REPLAY_VERSION) {
    throw new StateError(
      typeof data.version === "number" && data.version > REPLAY_VERSION
        ? `replay: the file is version ${String(data.version)}, made by a newer engine; this one reads version ${String(REPLAY_VERSION)}.`
        : `replay: "version" must be ${String(REPLAY_VERSION)}.`,
    );
  }
  onlyFields(data, ["format", "version", "seed", "actions"], "the file");
  if (typeof data.seed !== "string") throw new StateError(`replay: "seed" must be a string.`);
  if (!Array.isArray(data.actions)) throw new StateError(`replay: "actions" must be a list.`);
  const actions = (data.actions as unknown[]).map(readAction);
  return { format: REPLAY_FORMAT, version: REPLAY_VERSION, seed: data.seed, actions };
}

function readAction(value: unknown, index: number): StoryAction {
  const where = `action ${String(index + 1)}`;
  const bad = (what: string): StateError => new StateError(`replay: ${where} ${what}.`);
  if (!isRecord(value)) throw bad("must be an object");
  if (value.type === "goTo") {
    onlyFields(value, ["type", "passage"], where);
    if (!isName(value.passage)) throw bad(`needs a "passage" name`);
    return { type: "goTo", passage: value.passage };
  }
  if (value.type === "follow") {
    onlyFields(value, ["type", "choice"], where);
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
      };
    }
    const label = choice.label;
    return {
      type: "follow",
      choice: { type: "continue", target: choice.target, ...(label !== undefined && { label }) },
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
