/**
 * Templates and runtime instances (the "templates and instances" data-model rule).
 *
 * An instance is stored entirely in the state store: its template's name, the
 * parameters it was created with, and its mutable fields. Behavior comes from
 * the template, looked up by name, so instances survive save, undo, and replay
 * like any other state. Instance IDs derive from where the instance came from,
 * never from counters or random UUIDs, so the same seed and actions always
 * produce the same IDs.
 */
import type { StateId, StateStore } from "./store.js";
import { freezeValue, StateError, type StateValue } from "./value.js";

/** Field holding an instance's template name. Fields starting with `$` are reserved for core. */
const TEMPLATE_FIELD = "$template";
/** Field holding an instance's creation parameters. */
const PARAMS_FIELD = "$params";
const PREFIX = "gen:";

/**
 * A template that runtime instances are created from.
 *
 * @remarks
 * Packages that build on core, such as the world model, extend this interface
 * with behavior. That behavior lives on the template, never on the instance.
 */
export interface Template<P extends StateValue = StateValue> {
  /** Unique name, stored with each instance so a loaded save finds its template again. */
  readonly name: string;
  /** Returns an instance's initial mutable fields from its parameters. */
  readonly init?: (params: P) => { readonly [key: string]: StateValue };
}

/** The parameter type of a template. */
export type TemplateParams<T> = T extends Template<infer P> ? P : never;

/** A runtime instance: its ID, its template, and the parameters it was created with. */
export interface InstanceRef<T extends Template<never> = Template<never>> {
  /** The instance's ID in the state store; its mutable fields live under this ID. */
  readonly id: StateId;
  /** The template the instance was created from. */
  readonly template: T;
  /** The parameters the instance was created with. Frozen. */
  readonly params: TemplateParams<T>;
}

/** Creates and finds runtime instances in a state store. */
export interface Instances {
  /**
   * Creates an instance of `template` with ID {@link instanceId}(origin, key) and
   * stores its parameters and initial fields.
   * @throws {@link StateError} if the template isn't registered, the ID is taken,
   * or the parameters or initial fields aren't valid state.
   */
  create<T extends Template<never>>(
    template: T,
    origin: StateId,
    key: string,
    params: TemplateParams<T>,
  ): InstanceRef<T>;
  /**
   * Returns the instance with this ID, or `undefined` if there isn't one.
   * @throws {@link StateError} if the instance's template isn't registered.
   */
  get(id: StateId): InstanceRef | undefined;
  /** Every instance of `template`, sorted by ID. */
  find<T extends Template<never>>(template: T): InstanceRef<T>[];
  /** Every instance of any template, sorted by ID. */
  find(): InstanceRef[];
  /**
   * Removes an instance and all its fields, for example once it's gone for good.
   * @throws {@link StateError} if `id` isn't an instance.
   */
  remove(id: StateId): void;
}

function checkSegment(what: string, value: string, where: string): void {
  if (value.length === 0 || value.includes(":")) {
    throw new StateError(
      `${where}: the ${what} must be a non-empty string without ":", but was ${JSON.stringify(value)}.`,
    );
  }
}

/**
 * Derives an instance ID from its origin and a key that's unique within that
 * origin: `instanceId("crypt-3", "room-7")` is `"gen:crypt-3:room-7"`, and an
 * instance created from that one gets `"gen:crypt-3:room-7:chest"`.
 *
 * @param origin - the ID of whatever created the instance: a static object, or another instance.
 * @param key - unique within `origin`, e.g. `room-7`. Must not contain `:`.
 * @throws {@link StateError} if `origin` is empty or `key` is empty or contains `:`.
 */
export function instanceId(origin: StateId, key: string): StateId {
  if (origin.length === 0) throw new StateError("instanceId: the origin must be a non-empty ID.");
  checkSegment("key", key, `instanceId(${JSON.stringify(origin)})`);
  return origin.startsWith(PREFIX) ? `${origin}:${key}` : `${PREFIX}${origin}:${key}`;
}

/**
 * Creates the instance API over `store`, with the templates instances may use.
 * @throws {@link StateError} if two templates share a name.
 */
export function createInstances(
  store: StateStore,
  templates: readonly Template<never>[],
): Instances {
  const byName = new Map<string, Template<never>>();
  for (const template of templates) {
    if (template.name.length === 0) throw new StateError("templates: a template has no name.");
    if (byName.has(template.name)) {
      throw new StateError(
        `templates: two templates are named ${JSON.stringify(template.name)}; template names must be unique.`,
      );
    }
    byName.set(template.name, template);
  }

  const refAt = (id: StateId): InstanceRef | undefined => {
    const name = store.get(id, TEMPLATE_FIELD);
    if (typeof name !== "string") return undefined;
    const template = byName.get(name);
    if (!template) {
      throw new StateError(
        `instance ${JSON.stringify(id)} uses template ${JSON.stringify(name)}, which isn't registered. Pass it to createInstances.`,
      );
    }
    return Object.freeze({ id, template, params: store.get(id, PARAMS_FIELD) as never });
  };

  // One implementation serves both overloads of Instances.find.
  const find = ((template?: Template<never>): InstanceRef[] => {
    const out: InstanceRef[] = [];
    for (const id of store.ids()) {
      if (!id.startsWith(PREFIX)) continue;
      if (template && store.get(id, TEMPLATE_FIELD) !== template.name) continue;
      const ref = refAt(id);
      if (ref) out.push(ref);
    }
    return out;
  }) as Instances["find"];

  return {
    create(template, origin, key, params) {
      const id = instanceId(origin, key);
      const where = `create ${JSON.stringify(id)}`;
      if (byName.get(template.name) !== template) {
        throw new StateError(
          `${where}: template ${JSON.stringify(template.name)} isn't registered. Pass it to createInstances.`,
        );
      }
      if (store.entity(id) !== undefined) {
        throw new StateError(
          `${where}: an entity with this ID already exists. Give each instance a key that's unique within its origin.`,
        );
      }
      const frozen = freezeValue(params, `${where} params`);
      const init = template.init as
        ((params: StateValue) => Record<string, StateValue>) | undefined;
      const fields = Object.entries(init?.(frozen) ?? {});
      const bad = fields.find(([name]) => name.startsWith("$"));
      if (bad) {
        throw new StateError(
          `${where}: init returned field ${JSON.stringify(bad[0])}; fields starting with "$" are reserved.`,
        );
      }
      // Validate everything before writing, so a bad field leaves no half-made instance.
      const checked = fields.map(
        ([name, value]) => [name, freezeValue(value, `${where}.${name}`)] as const,
      );
      store.set(id, TEMPLATE_FIELD, template.name);
      store.set(id, PARAMS_FIELD, frozen);
      for (const [name, value] of checked) store.set(id, name, value);
      return Object.freeze({ id, template, params: frozen as never });
    },
    get: refAt,
    find,
    remove(id) {
      if (store.get(id, TEMPLATE_FIELD) === undefined) {
        throw new StateError(
          `remove: ${JSON.stringify(id)} isn't a runtime instance; only instances can be removed.`,
        );
      }
      for (const key of Object.keys(store.entity(id) ?? {})) store.delete(id, key);
    },
  };
}
