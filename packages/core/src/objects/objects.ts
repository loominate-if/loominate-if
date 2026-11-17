/**
 * Objects whose data lives in the state store (ADR 0006).
 *
 * An object is a handle with a stable ID. Its data properties are accessors
 * that read and write the store under `(id, property)`, its methods are
 * behavior, and its getters are derived values. The store holds a field only
 * while it differs from the definition, so saves stay small and a changed
 * default reaches old saves.
 *
 * Handles are created when modules load, before any store exists, so they
 * reach the store through whichever story is running: `createStory` binds them.
 */
import { createInstances, type Instances, type Template } from "../state/instances.js";
import type { StateId, StateStore } from "../state/store.js";
import { freezeValue, StateError, valuesEqual, type StateValue } from "../state/value.js";

/** A reference to an object: anything with a stable ID, such as a {@link Handle}. */
export interface ObjectRef {
  /** The object's ID in the state store. */
  readonly id: StateId;
}

/**
 * A value an object's data property can hold: state values, references to
 * other objects, and arrays and plain objects of those.
 *
 * @remarks
 * There's no `undefined`: use `null` for "nothing", as in `location: null as Room | null`.
 * Describe object-shaped data with a `type` alias rather than an `interface`, as for {@link StateValue}.
 */
export type ObjectData =
  | null
  | boolean
  | number
  | string
  | ObjectRef
  | readonly ObjectData[]
  | { readonly [key: string]: ObjectData };

/**
 * Checks a definition: every property is either a function (behavior) or
 * {@link ObjectData} (state). Getters are checked by the type they return.
 */
export type ObjectDefinition<D> = {
  [K in keyof D]: D[K] extends (...args: never[]) => unknown ? D[K] : ObjectData;
};

/**
 * An object: the definition's type, plus its ID. Data properties read and write the state store.
 *
 * @remarks
 * For objects defined with {@link object}, `Id` is the ID as a string literal type,
 * so the compiler can name the object in error messages. Write `Handle<D>` to accept any object.
 */
export type Handle<D, Id extends StateId = StateId> = D & { readonly id: Id };

/** A template for objects created during play with {@link spawn}. */
export interface ObjectTemplate<D> {
  /** The template's name, stored with each object created from it. */
  readonly name: string;
  /** The definition each object created from this template starts from. */
  readonly definition: Readonly<D>;
}

/** Where a ref is stored in a plain object: `{ "$ref": id }`. */
const REF_KEY = "$ref";
const GENERATED = "gen:";

interface Binding {
  readonly store: StateStore;
  /** Created on first use, so templates defined after binding are included. */
  instances: Instances | undefined;
  instancesFor: number;
  /** Handles of objects created during play, one per ID. */
  readonly spawned: Map<StateId, object>;
  /** The passage being rendered, while one is. */
  rendering: string | undefined;
}

interface Shape {
  /** Each data property's default, as stored: refs encoded, frozen. */
  readonly defaults: ReadonlyMap<string, StateValue>;
}

let binding: Binding | undefined;
const statics = new Map<StateId, object>();
const templates = new Map<string, ObjectTemplate<object>>();
const coreTemplates = new Map<string, Template>();
/** Every handle, so stored values can tell a reference from a plain object. */
const handles = new WeakMap<object, StateId>();
/** Live views, so `===` works on a field read twice: ID → field → path → view. */
const views = new Map<string, object>();

interface Location {
  readonly id: StateId;
  readonly key: string;
  readonly path: readonly (string | number)[];
}

const describe = (id: StateId, key: string, path: readonly (string | number)[] = []): string =>
  `${id === "" ? "" : JSON.stringify(id)}.${key}${path.map((p) => (typeof p === "number" ? `[${String(p)}]` : `.${p}`)).join("")}`;

/** Binds every object to `store`. Called by `createStory`. */
export function bindObjects(store: StateStore): void {
  binding = {
    store,
    instances: undefined,
    instancesFor: -1,
    spawned: new Map(),
    rendering: undefined,
  };
  views.clear();
}

/** Runs `render` with object writes refused, because rendering must be pure. */
export function renderingObjects<T>(passage: string, render: () => T): T {
  const b = binding;
  if (!b) return render();
  const outer = b.rendering;
  b.rendering = passage;
  try {
    return render();
  } finally {
    b.rendering = outer;
  }
}

/** Forgets every object and template. Tests only. */
export function resetObjects(): void {
  binding = undefined;
  statics.clear();
  shapes.clear();
  templates.clear();
  coreTemplates.clear();
  views.clear();
}

function active(where: string): Binding {
  if (!binding) {
    throw new StateError(
      `${where}: no story is running. Objects keep their state in a story's state store, so create one with createStory first.`,
    );
  }
  return binding;
}

function writable(where: string): StateStore {
  const b = active(where);
  if (b.rendering !== undefined) {
    throw new StateError(
      `passage ${JSON.stringify(b.rendering)}: rendering tried to change ${where}. Rendering must be pure; change state in an effect phase such as {on enter: …} instead.`,
    );
  }
  return b.store;
}

function instancesOfBinding(b: Binding): Instances {
  if (!b.instances || b.instancesFor !== coreTemplates.size) {
    b.instances = createInstances(b.store, [...coreTemplates.values()]);
    b.instancesFor = coreTemplates.size;
  }
  return b.instances;
}

function isPlain(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Converts author data to stored data: handles become refs. The store validates the rest. */
function encode(value: unknown, where: string): StateValue {
  if (typeof value !== "object" || value === null) return value as StateValue;
  const ref = handles.get(value);
  if (ref !== undefined) return { [REF_KEY]: ref };
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v, i) => encode(v, `${where}[${String(i)}]`));
  }
  if (!isPlain(value)) return value as StateValue; // the store explains what's wrong
  if (Object.hasOwn(value, REF_KEY)) {
    throw new StateError(
      `${where}: "${REF_KEY}" is reserved for references between objects; rename the key.`,
    );
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v, `${where}.${k}`)]));
}

function refIn(value: StateValue): StateId | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  const id = (value as { readonly [key: string]: StateValue })[REF_KEY];
  return keys.length === 1 && typeof id === "string" ? id : undefined;
}

/** Returns the handle for `id`, a static object or one created during play. */
function handleFor(id: StateId, where: string): object {
  const found = statics.get(id);
  if (found) return found;
  const b = active(where);
  let handle = b.spawned.get(id);
  if (handle) return handle;
  const ref = instancesOfBinding(b).get(id);
  const template = ref && templates.get(ref.template.name);
  if (!template) {
    throw new StateError(`${where} refers to object ${JSON.stringify(id)}, which doesn't exist.`);
  }
  handle = build(id, template.definition);
  b.spawned.set(id, handle);
  return handle;
}

/** Converts stored data to what authors see: refs become handles, collections become views. */
function decode(raw: StateValue, at: Location): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const ref = refIn(raw);
  if (ref !== undefined) return handleFor(ref, describe(at.id, at.key, at.path));
  return view(at, Array.isArray(raw));
}

/** The stored value of a field, or its default. */
function fieldValue(id: StateId, key: string, shape: Shape): StateValue {
  const store = active(describe(id, key)).store;
  if (store.has(id, key)) return store.get(id, key) as StateValue;
  return shape.defaults.get(key) as StateValue;
}

function writeField(id: StateId, key: string, shape: Shape, value: StateValue): void {
  const store = writable(describe(id, key));
  if (valuesEqual(value, shape.defaults.get(key))) store.delete(id, key);
  else store.set(id, key, value);
}

/** Every object's shape, so views can find their field's default. */
const shapes = new Map<StateId, Shape>();

function shapeOf(id: StateId): Shape {
  const shape = shapes.get(id);
  if (!shape) throw new StateError(`object ${JSON.stringify(id)} isn't defined.`);
  return shape;
}

function valueAt(at: Location): StateValue {
  let node = fieldValue(at.id, at.key, shapeOf(at.id));
  for (const step of at.path) {
    if (typeof node !== "object" || node === null || !Object.hasOwn(node, step)) {
      throw new StateError(
        `${describe(at.id, at.key, at.path)} no longer exists, so a view of it can't be used.`,
      );
    }
    node = (node as Record<string | number, StateValue>)[step] as StateValue;
  }
  return node;
}

/** Writes `next` at `at`, copying each level above it. */
function writeAt(at: Location, next: StateValue): void {
  const replace = (node: StateValue, depth: number): StateValue => {
    if (depth === at.path.length) return next;
    const step = at.path[depth] as string | number;
    if (Array.isArray(node)) {
      const copy = [...(node as StateValue[])];
      copy[step as number] = replace(copy[step as number] as StateValue, depth + 1);
      return copy;
    }
    const obj = node as { readonly [key: string]: StateValue };
    return { ...obj, [step]: replace(obj[step] as StateValue, depth + 1) };
  };
  const shape = shapeOf(at.id);
  writeField(at.id, at.key, shape, replace(fieldValue(at.id, at.key, shape), 0));
}

function view(at: Location, array: boolean): object {
  const cacheKey = JSON.stringify([at.id, at.key, at.path, array]);
  const cached = views.get(cacheKey);
  if (cached) return cached;

  const where = (prop?: string): string =>
    describe(at.id, at.key, prop === undefined ? at.path : [...at.path, prop]);
  const current = (): Record<string, StateValue> => {
    const value = valueAt(at);
    if (typeof value !== "object" || value === null || Array.isArray(value) !== array) {
      throw new StateError(
        `${where()} is no longer ${array ? "an array" : "an object"}, so a view of it can't be used.`,
      );
    }
    return value as Record<string, StateValue>;
  };
  const step = (prop: string): string | number =>
    array && prop !== "length" ? Number(prop) : prop;
  const reserved = (prop: string): void => {
    if (!array && prop === REF_KEY) {
      throw new StateError(
        `${where(prop)}: "${REF_KEY}" is reserved for references between objects; rename the key.`,
      );
    }
  };
  const change = (mutate: (copy: Record<string, StateValue>) => void): void => {
    const cur = current();
    const copy = (array ? [...(cur as unknown as StateValue[])] : { ...cur }) as Record<
      string,
      StateValue
    >;
    mutate(copy);
    writeAt(at, copy as unknown as StateValue);
  };

  const proxy = new Proxy(array ? [] : {}, {
    get(target, prop, receiver) {
      if (typeof prop === "string") {
        const cur = current();
        if (Object.hasOwn(cur, prop)) {
          const v = cur[prop] as StateValue;
          return prop === "length" && array
            ? v
            : decode(v, { ...at, path: [...at.path, step(prop)] });
        }
      }
      return Reflect.get(Object.getPrototypeOf(target) as object, prop, receiver);
    },
    set(_target, prop, value) {
      if (typeof prop !== "string") return false;
      reserved(prop);
      const stored = encode(value, where(prop));
      change((copy) => {
        copy[prop] = stored;
      });
      return true;
    },
    deleteProperty(_target, prop) {
      if (typeof prop !== "string") return false;
      if (array) {
        // pop and splice remove elements from the end, which leaves no hole.
        const items = current() as unknown as StateValue[];
        if (Number(prop) === items.length - 1) {
          writeAt(at, items.slice(0, -1));
          return true;
        }
        throw new StateError(
          `${where(prop)}: deleting an array element would leave a hole; use splice to remove it.`,
        );
      }
      change((copy) => {
        Reflect.deleteProperty(copy, prop);
      });
      return true;
    },
    has(target, prop) {
      return (
        (typeof prop === "string" && Object.hasOwn(current(), prop)) ||
        prop in Object.getPrototypeOf(target)
      );
    },
    ownKeys() {
      return Reflect.ownKeys(current());
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const cur = current();
      if (!Object.hasOwn(cur, prop)) return undefined;
      if (array && prop === "length") {
        // Matches the target's own `length`, which a proxy has to report faithfully.
        return { value: cur[prop], writable: true, enumerable: false, configurable: false };
      }
      return {
        value: decode(cur[prop] as StateValue, { ...at, path: [...at.path, step(prop)] }),
        writable: true,
        enumerable: true,
        configurable: true,
      };
    },
    defineProperty(_target, prop, descriptor) {
      if (typeof prop !== "string" || !("value" in descriptor)) return false;
      reserved(prop);
      const stored = encode(descriptor.value, where(prop));
      change((copy) => {
        copy[prop] = stored;
      });
      return true;
    },
    preventExtensions: () => false,
    setPrototypeOf: () => false,
  });
  views.set(cacheKey, proxy);
  return proxy;
}

/** Builds a handle for `id` from a definition. */
function build(id: StateId, definition: object): object {
  const handle = {};
  const defaults = new Map<string, StateValue>();
  const descriptors = Object.getOwnPropertyDescriptors(definition);
  for (const [key, d] of Object.entries(descriptors)) {
    if (key === "id") {
      throw new StateError(
        `object ${JSON.stringify(id)}: "id" is the object's ID; give the property another name.`,
      );
    }
    if (key.startsWith("$")) {
      throw new StateError(
        `object ${JSON.stringify(id)}: property "${key}" starts with "$", which is reserved for core; rename it.`,
      );
    }
    if (!("value" in d) || typeof d.value === "function") {
      Object.defineProperty(handle, key, { ...d, configurable: false });
      continue;
    }
    // Validate and freeze now, so a bad default fails where the object is defined.
    const where = `object ${describe(id, key)}`;
    defaults.set(key, freezeValue(encode(d.value, where), where));
  }
  const shape: Shape = { defaults };
  shapes.set(id, shape);
  for (const key of defaults.keys()) {
    Object.defineProperty(handle, key, {
      enumerable: true,
      configurable: false,
      get: () => decode(fieldValue(id, key, shape), { id, key, path: [] }),
      set: (value: unknown) => {
        writeField(id, key, shape, encode(value, describe(id, key)));
      },
    });
  }
  Object.defineProperty(handle, "id", { value: id, enumerable: false });
  Object.preventExtensions(handle);
  handles.set(handle, id);
  return handle;
}

function checkId(id: unknown, where: string): asserts id is StateId {
  if (typeof id !== "string" || id.length === 0) {
    throw new StateError(`${where}: the ID must be a non-empty string.`);
  }
}

/**
 * Defines an object with a stable ID.
 *
 * @remarks
 * Data properties are state: their values in `definition` are defaults, and
 * changes are stored in the running story's state store under `(id, property)`.
 * Only values that differ from the default are stored. Methods are behavior,
 * with `this` typed as the object. Getters are derived values, never stored.
 * Arrays and plain objects read as live views, so `player.inventory.push(lantern)`
 * changes state. Other objects stored in properties are stored by ID.
 *
 * @example
 * ```ts
 * export const lantern = object("lantern", {
 *   name: "brass lantern",
 *   isLit: false,
 *   light() {
 *     this.isLit = true;
 *   },
 * });
 * ```
 *
 * @param id - the object's stable ID, used by saves, undo, and the inspector.
 * Keep it when renaming the variable.
 * @throws {@link StateError} if the ID is empty, already used, starts with `gen:`
 * or `$`, or a data property isn't valid state.
 */
export function object<Id extends StateId, D extends ObjectDefinition<D>>(
  id: Id,
  definition: D & ThisType<Handle<D, Id>>,
): Handle<D, Id> {
  checkId(id, "object");
  if (id.startsWith(GENERATED) || id.startsWith("$")) {
    throw new StateError(
      `object ${JSON.stringify(id)}: IDs starting with "${id.startsWith("$") ? "$" : GENERATED}" are reserved${id.startsWith("$") ? " for core" : " for objects created during play"}; choose another ID.`,
    );
  }
  if (statics.has(id)) {
    throw new StateError(
      `object ${JSON.stringify(id)} is defined twice; object IDs must be unique.`,
    );
  }
  const handle = build(id, definition);
  statics.set(id, handle);
  return handle as Handle<D, Id>;
}

/**
 * Defines a mixin: properties and behavior to spread into object definitions,
 * as in `object("cellar door", { ...lockable, name: "cellar door" })`.
 *
 * @remarks
 * Returns `definition` unchanged. Inside it, `this` is typed from the mixin's
 * own properties, so its methods need no `this:` annotation.
 */
export function mixin<M extends ObjectDefinition<M>>(definition: M & ThisType<Handle<M>>): M {
  return definition;
}

/**
 * Defines a template for objects created during play with {@link spawn}.
 * Takes the same kind of definition as {@link object}.
 *
 * @param name - unique among templates, stored with each object created from it.
 * Must not contain `:`.
 * @throws {@link StateError} if the name is empty, contains `:`, or is already used.
 */
export function template<D extends ObjectDefinition<D>>(
  name: string,
  definition: D & ThisType<Handle<D>>,
): ObjectTemplate<D> {
  checkId(name, "template");
  if (name.includes(":")) {
    throw new StateError(
      `template ${JSON.stringify(name)}: names can't contain ":", which separates ID parts.`,
    );
  }
  if (templates.has(name)) {
    throw new StateError(
      `template ${JSON.stringify(name)} is defined twice; template names must be unique.`,
    );
  }
  const made: ObjectTemplate<D> = Object.freeze({
    name,
    // Copy descriptors, not values, so getters stay getters.
    definition: Object.freeze(
      Object.defineProperties({}, Object.getOwnPropertyDescriptors(definition)) as D,
    ),
  });
  // Check the definition now, so mistakes surface where it's written.
  build(`${GENERATED}template:${name}`, made.definition);
  shapes.delete(`${GENERATED}template:${name}`);
  templates.set(name, made as ObjectTemplate<object>);
  coreTemplates.set(name, { name });
  return made;
}

/**
 * Creates an object from `template` during play.
 *
 * @remarks
 * Its ID derives from `origin`: `gen:<origin>:<template>-<n>`, where `n` counts
 * the objects `origin` has made from this template, or `gen:<origin>:<key>` when
 * a key is given. The count is kept in the store, so undo, replay, and loading
 * a save give the same IDs.
 *
 * @example
 * ```ts
 * const lit = spawn(match, matchbox); // gen:matchbox:match-1
 * ```
 *
 * @param origin - the object creating this one.
 * @param key - optional, unique within `origin`. Must not contain `:`.
 * @throws {@link StateError} while rendering, with no story running, or if the ID is taken.
 */
export function spawn<D>(template: ObjectTemplate<D>, origin: ObjectRef, key?: string): Handle<D> {
  const where = `spawn ${JSON.stringify(template.name)} from ${JSON.stringify(origin.id)}`;
  const store = writable(where);
  if (templates.get(template.name) !== template) {
    throw new StateError(`${where}: the template isn't defined with template().`);
  }
  let chosen = key;
  if (chosen === undefined) {
    const field = `$spawned:${template.name}`;
    const n = ((store.get(origin.id, field) as number | undefined) ?? 0) + 1;
    store.set(origin.id, field, n);
    chosen = `${template.name}-${String(n)}`;
  }
  const b = active(where);
  const ref = instancesOfBinding(b).create(
    coreTemplates.get(template.name) as Template,
    origin.id,
    chosen,
    null,
  );
  return handleFor(ref.id, where) as Handle<D>;
}

/**
 * Every object created from `template` in the running story, sorted by ID.
 * @throws {@link StateError} with no story running.
 */
export function instancesOf<D>(template: ObjectTemplate<D>): Handle<D>[] {
  const where = `instancesOf ${JSON.stringify(template.name)}`;
  const b = active(where);
  const core = coreTemplates.get(template.name);
  if (!core) return [];
  return instancesOfBinding(b)
    .find(core)
    .map((ref) => handleFor(ref.id, where) as Handle<D>);
}
