/** Style B: a builder chain. */
import {
  defineStatic,
  defineTemplate,
  type Handle,
  type ObjectTemplate,
} from "../runtime/objects.js";

export { spawn } from "../runtime/objects.js";

/** Accumulates data and behavior, then becomes an object or a template. */
export class Builder<S extends object, M extends object> {
  constructor(
    private readonly data: object = {},
    private readonly behavior: object = {},
  ) {}

  /** Adds data properties, which are state. */
  state<S2 extends object>(data: S2): Builder<S & S2, M> {
    return new Builder({ ...this.data, ...data }, this.behavior);
  }

  /** Adds behavior. `this` sees all data and behavior so far. */
  does<M2 extends object>(behavior: M2 & ThisType<Handle<S & M & M2>>): Builder<S, M & M2> {
    return new Builder(
      this.data,
      Object.defineProperties(
        {},
        {
          ...Object.getOwnPropertyDescriptors(this.behavior),
          ...Object.getOwnPropertyDescriptors(behavior),
        },
      ),
    );
  }

  /** Mixes in another builder's data and behavior. */
  with<S2 extends object, M2 extends object>(other: Builder<S2, M2>): Builder<S & S2, M & M2> {
    return new Builder({ ...this.data, ...other.data }, { ...this.behavior, ...other.behavior });
  }

  /** Makes the object this builder describes. */
  make(): S & M {
    const target = Object.defineProperties({}, Object.getOwnPropertyDescriptors(this.behavior));
    return Object.assign(target, structuredClone(this.data)) as S & M;
  }
}

/** Starts a mixin. */
export const mixin = (): Builder<object, object> => new Builder();

/** A builder that ends in `.done()` for an object. */
export type Chain<S extends object, M extends object> = {
  state<S2 extends object>(data: S2): Chain<S & S2, M>;
  does<M2 extends object>(behavior: M2 & ThisType<Handle<S & M & M2>>): Chain<S, M & M2>;
  with<S2 extends object, M2 extends object>(other: Builder<S2, M2>): Chain<S & S2, M & M2>;
  done(): Handle<S & M>;
};

/** Starts an object definition. */
export function define(id: string): Chain<object, object> {
  const wrap = <S extends object, M extends object>(b: Builder<S, M>): Chain<S, M> => ({
    state: (data) => wrap(b.state(data)),
    does: (behavior) => wrap(b.does(behavior)),
    with: (other) => wrap(b.with(other)),
    done: () => defineStatic(id, b.make()),
  });
  return wrap(new Builder());
}

/** Starts a template definition. */
export function template(name: string) {
  const wrap = <S extends object, M extends object>(b: Builder<S, M>) => ({
    state: <S2 extends object>(data: S2) => wrap(b.state(data)),
    does: <M2 extends object>(behavior: M2 & ThisType<Handle<S & M & M2>>) =>
      wrap(b.does(behavior)),
    done: (): ObjectTemplate<S & M> => defineTemplate(name, () => b.make()),
  });
  return wrap(new Builder());
}
