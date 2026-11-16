/**
 * The mechanism shared by all three syntax prototypes: objects whose data
 * lives in the state store.
 *
 * An object is a handle with an ID. Its data properties are accessors that
 * read and write the store under `(id, property)`, and its functions are
 * behavior. The store holds only values that differ from the definition, so
 * saves stay small and a changed default reaches old saves.
 *
 * Objects created during play come from templates. Their IDs are derived from
 * the object that created them (`gen:matchbox:match-1`), with a per-origin
 * sequence kept in the store, so undo and replay produce the same IDs.
 *
 * This would live in core if the design is adopted. Here it binds to one
 * store at a time through `bindStore`.
 */
import {
  createInstances,
  type Instances,
  type StateStore,
  type StateValue,
  type Template,
} from "@loominate-if/core";

/** An object handle: the definition's type, plus its ID. */
export type Handle<T> = T & { readonly id: string };

/** A template for objects created during play. */
export type ObjectTemplate<T> = {
  /** The template's name, stored with each instance. */
  readonly name: string;
  /** The core template registered with the store's instances. */
  readonly core: Template;
  /** Makes an unbound object with this template's behavior and default data. */
  readonly make: () => object;
  /** Phantom field carrying the instance type. */
  readonly __type?: T;
};

type Data = Record<string, StateValue>;

let store: StateStore | undefined;
let instances: Instances | undefined;
const statics = new Set<string>();
const templates = new Map<string, ObjectTemplate<unknown>>();
const live = new Map<string, object>();

/** Binds every object to `target`. Call it before a story begins or after loading a save. */
export function bindStore(target: StateStore): void {
  store = target;
  instances = createInstances(
    target,
    [...templates.values()].map((t) => t.core),
  );
  live.clear();
}

function active(): StateStore {
  if (!store) throw new Error("No story is running. Call bindStore(store) first.");
  return store;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Turns `target`'s own data properties into store accessors under `id`.
 * Functions and accessors stay as they are: they're behavior.
 */
function bind<T extends object>(target: T, id: string): Handle<T> {
  const defaults: Data = {};
  for (const [key, d] of Object.entries(Object.getOwnPropertyDescriptors(target))) {
    if (!("value" in d) || typeof d.value === "function") continue;
    defaults[key] = freeze(structuredClone(d.value as StateValue));
  }
  for (const [key, initial] of Object.entries(defaults)) {
    Object.defineProperty(target, key, {
      enumerable: true,
      configurable: false,
      get: () => {
        const s = active();
        return s.has(id, key) ? s.get(id, key) : initial;
      },
      set: (value: StateValue) => {
        const s = active();
        if (same(value, initial)) {
          if (s.has(id, key)) s.delete(id, key);
        } else {
          s.set(id, key, value);
        }
      },
    });
  }
  Object.defineProperty(target, "id", { value: id, enumerable: false });
  return target as Handle<T>;
}

/**
 * Defines an object written in the source, with an explicit, stable ID.
 * @throws Error if the ID is reserved for runtime objects or already used.
 */
export function defineStatic<T extends object>(id: string, target: T): Handle<T> {
  if (id.startsWith("gen:")) {
    throw new Error(
      `object "${id}": IDs starting with "gen:" are for objects created during play.`,
    );
  }
  if (statics.has(id)) throw new Error(`object "${id}" is defined twice. IDs must be unique.`);
  statics.add(id);
  return bind(target, id);
}

/** Defines a template. `make` returns a fresh, unbound object each time. */
export function defineTemplate<T extends object>(name: string, make: () => T): ObjectTemplate<T> {
  if (templates.has(name)) throw new Error(`template "${name}" is defined twice.`);
  const template: ObjectTemplate<T> = { name, core: { name }, make };
  templates.set(name, template);
  return template;
}

function handleFor<T>(template: ObjectTemplate<T>, id: string): Handle<T> {
  let handle = live.get(id);
  if (!handle) {
    handle = bind(template.make(), id);
    live.set(id, handle);
  }
  return handle as Handle<T>;
}

/**
 * Creates an object from `template` during play. Its ID is derived from
 * `origin`: `gen:<origin>:<template>-<n>`, or `gen:<origin>:<key>` with a key.
 */
export function spawn<T>(
  template: ObjectTemplate<T>,
  origin: { readonly id: string },
  key?: string,
): Handle<T> {
  const s = active();
  if (!instances) throw new Error("No story is running. Call bindStore(store) first.");
  let chosen = key;
  if (chosen === undefined) {
    const field = `$spawned:${template.name}`;
    const n = ((s.get(origin.id, field) as number | undefined) ?? 0) + 1;
    s.set(origin.id, field, n);
    chosen = `${template.name}-${String(n)}`;
  }
  const ref = instances.create(template.core, origin.id, chosen, null);
  return handleFor(template, ref.id);
}

/** Every object created from `template`, sorted by ID. */
export function instancesOf<T>(template: ObjectTemplate<T>): Handle<T>[] {
  if (!instances) throw new Error("No story is running. Call bindStore(store) first.");
  return instances.find(template.core).map((ref) => handleFor(template, ref.id));
}
