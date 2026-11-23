/**
 * Name-keyed registries (#26, ADR 0012): directions, effects, widgets,
 * layouts, and library classes are registered by name, so an extension can
 * substitute its own implementation.
 */
import { NameTaken, StateError } from "../state/value.js";
import { GAME_SOURCE } from "./rules.js";

/** A registry entry, as the inspector shows it. */
export interface RegistryEntry<T> {
  /** The entry's key. */
  readonly key: string;
  /** The registered value. */
  readonly value: T;
  /** The package that registered it, or that replaced it last. */
  readonly source: string;
}

/** Values registered by name. */
export interface Registry<T> {
  /** The registry's name. */
  readonly name: string;
  /**
   * Registers a value.
   * @throws {@link StateError} if the key is taken; use {@link Registry.replace} to substitute one.
   */
  register(key: string, value: T, options?: { readonly source?: string }): void;
  /**
   * Substitutes a registered value, keeping its place in the order.
   * @throws {@link StateError} if nothing is registered under the key.
   */
  replace(key: string, value: T, options?: { readonly source?: string }): void;
  /**
   * Removes an entry.
   * @throws {@link StateError} if nothing is registered under the key.
   */
  remove(key: string): void;
  /** The value under a key, or `undefined`. */
  get(key: string): T | undefined;
  /** Whether something is registered under a key. */
  has(key: string): boolean;
  /** Every entry, in registration order. */
  entries(): readonly RegistryEntry<T>[];
}

const names = new Set<string>();

/**
 * Creates a registry. Define each once, in a module.
 * @throws {@link StateError} if the name is empty or a registry with that name already exists.
 */
export function registry<T>(name: string): Registry<T> {
  const where = `registry ${JSON.stringify(name)}`;
  if (name.length === 0) throw new StateError("registry: the name must be non-empty.");
  if (names.has(name)) throw new NameTaken(`${where}: there's already one with that name.`);
  names.add(name);
  const entries = new Map<string, { value: T; source: string }>();
  const existing = (key: string, verb: string) => {
    const entry = entries.get(key);
    if (!entry) {
      throw new StateError(
        `${where}: can't ${verb} ${JSON.stringify(key)}; nothing is registered under it.`,
      );
    }
    return entry;
  };
  return Object.freeze({
    name,
    register(key: string, value: T, options: { readonly source?: string } = {}) {
      if (key.length === 0) throw new StateError(`${where}: a key must be non-empty.`);
      const taken = entries.get(key);
      if (taken) {
        throw new NameTaken(
          `${where}: ${JSON.stringify(key)} is already registered by ${taken.source}; use replace() to substitute it.`,
        );
      }
      entries.set(key, { value, source: options.source ?? GAME_SOURCE });
    },
    replace(key: string, value: T, options: { readonly source?: string } = {}) {
      const entry = existing(key, "replace");
      entry.value = value;
      entry.source = options.source ?? GAME_SOURCE;
    },
    remove(key: string) {
      existing(key, "remove");
      entries.delete(key);
    },
    get: (key: string) => entries.get(key)?.value,
    has: (key: string) => entries.has(key),
    entries: () => [...entries].map(([key, { value, source }]) => ({ key, value, source })),
  });
}
