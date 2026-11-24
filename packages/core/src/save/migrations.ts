/**
 * Save migrations (#100, ADR 0076): steps a game declares in `story.ts`,
 * each bringing a save from one game version to the next, so saves from
 * 1.0 load in 1.2. A step changes the saved state as data, by object ID
 * and field, before anything loads. Stable IDs make most migrations
 * unnecessary, and a property a new version adds needs none: a save keeps
 * only values that differ from their defaults.
 */
import type { StateSnapshot } from "../state/store.js";
import { StateError, type StateValue } from "../state/value.js";

/** The saved state as a migration step changes it. */
export interface MigratingSave {
  /** The game version the save is at now, as the steps run. */
  readonly version: string;
  /** Every object and engine entry in the save, by ID. */
  ids(): readonly string[];
  /** Whether the save has `id`. */
  has(id: string): boolean;
  /** A field's saved value, or `undefined` if it isn't saved, as when it's at its default. */
  get(id: string, field: string): StateValue | undefined;
  /** Sets a field's value. */
  set(id: string, field: string, value: StateValue): void;
  /** Removes a field, so it's at its default again. */
  unset(id: string, field: string): void;
  /** An object's ID changed: moves its fields, and points every reference to it at the new ID. */
  rename(from: string, to: string): void;
  /** A field's name changed, and with `convert`, its value too. */
  renameField(
    id: string,
    from: string,
    to: string,
    convert?: (value: StateValue) => StateValue,
  ): void;
  /** Removes an object, and sets every reference to it to `null`. */
  remove(id: string): void;
}

type Step = {
  readonly from: string;
  readonly to: string;
  readonly run: (save: MigratingSave) => void;
};

const steps = new Map<string, Step>();

/**
 * Declares a migration step, in `story.ts`: how a save from game version
 * `from` becomes one for version `to`. Loading a save runs the steps from
 * its version, one after another, up to the running version. Versions are
 * matched exactly.
 *
 * @example
 * ```ts
 * migrate({ from: "1.0.0", to: "1.1.0" }, (save) => {
 *   save.rename("oldLamp", "lamp");
 *   save.renameField("door", "shut", "isOpen", (shut) => !shut);
 * });
 * ```
 *
 * @throws StateError if a step from that version is already declared, or
 * `from` and `to` are the same or empty.
 */
export function migrate(
  versions: { readonly from: string; readonly to: string },
  step: (save: MigratingSave) => void,
): void {
  const { from, to } = versions;
  const where = `migrate ${JSON.stringify(from)} to ${JSON.stringify(to)}`;
  if (from.trim() === "" || to.trim() === "") throw new StateError(`${where}: give both versions.`);
  if (from === to) throw new StateError(`${where}: it goes from a version to itself.`);
  const known = steps.get(from);
  if (known) {
    throw new StateError(
      `${where}: there's already a step from ${JSON.stringify(from)}, to ${JSON.stringify(known.to)}. Each version has one step onward.`,
    );
  }
  steps.set(from, { from, to, run: step });
}

/** Whether `value` is a reference to `id`, as the store keeps references. */
const isRef = (value: unknown, id: string): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (value as { $ref?: unknown }).$ref === id;

/** `value` with every reference to `from` replaced by `to`, wherever it's nested. */
function replaceRefs(value: StateValue, from: string, to: StateValue): StateValue {
  if (isRef(value, from)) return to;
  if (Array.isArray(value)) return value.map((v) => replaceRefs(v as StateValue, from, to));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceRefs(v as StateValue, from, to)]),
    ) as StateValue;
  }
  return value;
}

/**
 * Runs the migration steps that bring a save from version `from` to `to`,
 * on a copy of its state. With no steps declared, or the same version, the
 * state is returned as it is.
 *
 * @throws StateError if steps are declared and none leads from `from` to
 * `to`, or a step fails.
 * @internal
 */
export function _migrateSave(
  state: StateSnapshot,
  from: string,
  to: string,
): { readonly state: StateSnapshot; readonly through: readonly string[] } {
  if (from === to || steps.size === 0) return { state, through: [] };
  let data: Record<string, Record<string, StateValue>> = JSON.parse(
    JSON.stringify(state),
  ) as Record<string, Record<string, StateValue>>;
  let version = from;
  /** `record` without `key`. */
  const without = <T>(record: Record<string, T>, key: string): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
  /** Removes an entity from the save. */
  const drop = (id: string): void => {
    data = without(data, id);
  };
  const save: MigratingSave = {
    get version() {
      return version;
    },
    ids: () => Object.keys(data).sort(),
    has: (id) => Object.hasOwn(data, id),
    get: (id, field) => data[id]?.[field],
    set(id, field, value) {
      data[id] = { ...data[id], [field]: value };
    },
    unset(id, field) {
      const entity = data[id];
      if (entity) data[id] = without(entity, field);
    },
    rename(old, now) {
      if (!Object.hasOwn(data, old)) return;
      if (Object.hasOwn(data, now)) {
        throw new StateError(
          `rename ${JSON.stringify(old)} to ${JSON.stringify(now)}: the save already has ${JSON.stringify(now)}.`,
        );
      }
      data[now] = data[old] ?? {};
      drop(old);
      for (const [id, fields] of Object.entries(data)) {
        data[id] = Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, replaceRefs(v, old, { $ref: now })]),
        );
      }
    },
    renameField(id, old, now, convert) {
      const entity = data[id];
      if (!entity || !Object.hasOwn(entity, old)) return;
      const value = entity[old] as StateValue;
      data[id] = { ...without(entity, old), [now]: convert ? convert(value) : value };
    },
    remove(id) {
      drop(id);
      for (const [other, fields] of Object.entries(data)) {
        data[other] = Object.fromEntries(
          Object.entries(fields).map(([k, v]) => [k, replaceRefs(v, id, null)]),
        );
      }
    },
  };
  const through = [from];
  while (version !== to) {
    const step = steps.get(version);
    if (!step) {
      const starts = [...steps.keys()].sort().join(", ");
      throw new StateError(
        version === from
          ? `save: this save is from version ${from} of the game, and no migration leads from it to ${to}, the version running. The game's migrations start from ${starts}.`
          : `save: migrating this save from version ${from}, the steps reach ${version}, and none leads on from there to ${to}.`,
      );
    }
    if (through.includes(step.to)) {
      throw new StateError(
        `save: the migrations from ${from} go round in a loop, back to ${step.to}.`,
      );
    }
    try {
      step.run(save);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new StateError(
        `save: the migration from ${step.from} to ${step.to} failed: ${reason}`,
        { cause: error },
      );
    }
    version = step.to;
    through.push(version);
  }
  return { state: data as StateSnapshot, through };
}

/** Forgets every migration step. Tests only. @internal */
export function _resetMigrations(): void {
  steps.clear();
}
