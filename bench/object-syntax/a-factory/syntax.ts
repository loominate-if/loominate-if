/** Style A: a factory function taking an object literal. */
import {
  defineStatic,
  defineTemplate,
  type Handle,
  type ObjectTemplate,
} from "../runtime/objects.js";

export { spawn } from "../runtime/objects.js";

/** Defines an object. Data properties are state; functions are behavior. */
export function object<D extends object>(
  id: string,
  definition: D & ThisType<Handle<D>>,
): Handle<D> {
  return defineStatic(id, copy(definition));
}

/** Defines a template for objects created during play. */
export function template<D extends object>(
  name: string,
  definition: D & ThisType<Handle<D>>,
): ObjectTemplate<D> {
  return defineTemplate(name, () => copy(definition));
}

const copy = <D extends object>(definition: D): D =>
  Object.defineProperties({}, Object.getOwnPropertyDescriptors(definition)) as D;
