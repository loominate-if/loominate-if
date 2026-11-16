/** Style C: a class per object. */
import {
  defineStatic,
  defineTemplate,
  type Handle,
  type ObjectTemplate,
} from "../runtime/objects.js";

export { spawn } from "../runtime/objects.js";

/** The base class of every object. Class fields are state; methods are behavior. */
export class GameObject {
  /** The object's ID, set by {@link define} or {@link spawn}. */
  declare readonly id: string;
}

/** A class whose instances are game objects. */
export type ObjectClass<T extends GameObject> = new () => T;

/** Defines the object an instance of `cls` describes, with an explicit ID. */
export function define<T extends GameObject>(cls: ObjectClass<T>, id: string): Handle<T> {
  return defineStatic(id, new cls());
}

/** Defines a template from a class. */
export function template<T extends GameObject>(
  name: string,
  cls: ObjectClass<T>,
): ObjectTemplate<T> {
  return defineTemplate(name, () => new cls());
}
