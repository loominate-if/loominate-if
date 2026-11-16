# 0006. Object definitions

- **Status:** Accepted, 2026-11-16
- **Issue:** [#4](https://github.com/loominate-if/loominate-if/issues/4)
- **Design:** [TypeScript modules](../DESIGN.md#typescript-modules), [Core runtime](../DESIGN.md#core-runtime), [Open questions](../DESIGN.md#open-questions)
- **Prototypes:** [`bench/object-syntax/`](../../bench/object-syntax/README.md)

## Context

Authors define objects in TypeScript modules, and passages use them in inline code: `{if lantern.isLit}`, `{on enter: player.fear += 1}`. The design sketched a factory function with an object literal, but left the style open. It also left open how an object's data reaches the state store, since design principle 2 says objects never hold mutable state themselves.

The prototypes in `bench/object-syntax/` wrote one scene three ways over one shared mechanism: a factory with an object literal, a builder chain, and a class per object. All three type-checked, played the scene with undo, save, load, and replay, and caught the same deliberate mistakes at the right lines.

- The factory was the shortest (38 lines against 42 and 53), and `this` is inferred in a definition with no annotations.
- The builder split every definition into state and behavior, and forgetting `.done()` gave an error far from the mistake.
- Classes named their types best in error messages, but took two declarations per object, needed `any[]` for mixins, and were the easiest to bind wrongly.

The prototypes also found three gaps that any style has to close:
- stored values are frozen, so `player.inventory.push(x)` throws;
- references between objects aren't covered;
- objects created during play need IDs the author can't choose in advance.

## Decision

### Objects are defined with a factory and an object literal

```ts
export const lantern = object("lantern", {
  name: "brass lantern",
  isLit: false,
  get theName() {
    return `the ${this.name}`;
  },
  light() {
    this.isLit = true;
  },
});
```

`object(id, definition)` returns a **handle**: an object with the definition's type, plus a read-only `id`. In a definition:

- **Data properties are state.** Every property whose value isn't a function is stored under `(id, property)`. Its value in the definition is the default.
- **Methods are behavior.** Inside a method, `this` is the handle, typed from the definition, with no annotation.
- **Getters are derived values**, computed from state on each read and never stored.
- Data must be state values (core's `StateValue`), handles, or arrays and plain objects of those. Anything else is a type error in the definition.

Core provides `object()`, because a plain story needs `player.fear` as much as a world-model game does. The world model's `thing()`, `place()`, and `actor()` build on it.

### IDs are explicit and stable

- Objects written in the source take an explicit ID as their first argument. IDs are what saves, diffs, the inspector, and line IDs refer to, so they mustn't change when a variable is renamed or a file is reorganized.
- Defining two objects with the same ID is an error. #33 makes it a compile error; until then it's a runtime error at load.
- IDs starting with `gen:` are reserved for objects created during play.
- Field names starting with `$` are reserved for core, as they already are in the state store.

### Only changes are stored

The store holds a field only while its value differs from the definition's default. Setting a field back to its default deletes it. This keeps saves small, and it means a changed default reaches existing saves for every field the player hasn't changed. Changing a default can therefore change a saved game, which is usually what the author wants. When it isn't, the save migration hooks handle it.

### Mixins are objects spread into a definition

```ts
const lockable = mixin({
  isLocked: true,
  unlock(key: Handle<{ taken: boolean }>): boolean {
    if (!key.taken) return false;
    this.isLocked = false;
    return true;
  },
});

export const cellarDoor = object("cellar door", { ...lockable, name: "cellar door" });
```

`mixin(definition)` returns its argument unchanged, but types `this` inside it from the mixin's own properties. That removes the explicit `this:` annotation the prototype needed. A definition can spread several mixins, and later properties override earlier ones, as TADS's multiple inheritance does.

### Collections can be changed in place

Reading an array or object field returns a **live view** of the stored value, not the frozen value itself.

```ts
player.inventory.push(lantern);
player.stats.strength += 1;
delete player.notes.draft;
```

- Every change through a view writes a new value for the whole field to the store, so undo, save, and replay see one ordinary change, and the stored value itself stays frozen.
- A view always reads the current stored value, so a view kept in a variable stays correct after undo or load.
- Views behave as arrays and plain objects: `Array.isArray`, iteration, spreading, `JSON.stringify`, and array methods all work. Methods that return a new array (`map`, `filter`, `slice`) return plain copies.
- Reading the same field twice returns the same view, so `===` works.
- The types stay mutable arrays and objects, as the author wrote them.

The prototype's alternative, reassigning (`player.inventory = [...player.inventory, x]`), still works.

### References between objects are stored as IDs

```ts
export const key = object("key", { location: kitchen as Room | null });

key.location = cellar;
player.inventory.push(key);
if (key.location === cellar) …
```

- A handle stored in a field, array, or plain object is stored as `{ "$ref": "<id>" }`, and read back as the handle.
- There is one handle per ID, so references compare with `===`.
- `$ref` is reserved as a key in stored plain objects.
- A reference to an object that no longer exists reads as an error naming the field and the missing ID.

### Templates create objects during play

```ts
export const match = template("match", {
  isLit: true,
  burnOut() {
    this.isLit = false;
  },
});

const lit = spawn(match, matchbox);         // gen:matchbox:match-1, then match-2
const named = spawn(match, matchbox, "spare"); // gen:matchbox:spare
```

- `template(name, definition)` takes the same kind of definition as `object()`, and returns a template rather than a handle. It builds on core's templates and instances.
- `spawn(template, origin, key?)` creates an object whose ID derives from its origin: `gen:<origin>:<template>-<n>`, or `gen:<origin>:<key>` with a key.
- `<n>` comes from a sequence per origin and template, kept in the store on the origin. Undo, replay, and loading a save give the same IDs, and the author never needs to know which IDs are taken.
- Spawned objects are reached through queries, such as `instancesOf(match)`, or through references stored in other objects, never through static names (the data-model rule on static and dynamic references).

### Objects read and write through the running story

Handles are created when modules load, before any story exists, so they reach the store through the running story:

- `createStory` binds every object to its store. One story runs at a time, and creating a second story rebinds them.
- **Rendering can't change state** (design principle 3). A write through a handle while a passage renders is a `StateError` naming the object and field, telling the author to move the change into an effect phase.
- Effect phases and actions write through the story's state access, so their changes are recorded like any other.
- Reading or writing an object when no story is running is a `StateError`.

## Consequences

- `object()`, `mixin()`, `template()`, `spawn()`, `instancesOf()`, and the `Handle` type become core's public API. [#211](https://github.com/loominate-if/loominate-if/issues/211) implements them.
- Inline code now changes real state: `{on enter: player.fear += 1}` is recorded for undo, save, and replay with no extra syntax.
- Error messages about objects name the whole inferred type, such as `Handle<{ name: string; isLit: boolean; … }>`. [#212](https://github.com/loominate-if/loominate-if/issues/212) shortens them to the object's ID. Until then, they're correct but long.
- Live views cost a proxy per collection field read. It only applies to fields that are arrays or objects, and views are cached per field.
- An object's ID and its variable name can differ. That's deliberate, since IDs must survive renames, but it means the inspector and saves show IDs, not variable names.
- Nothing stops a method from keeping state in a closure, which undo and save would miss. Documentation and the inspector have to make the rule clear, since the type system can't enforce it.
- The mechanism binds to one store at a time, which fits one game per page. Running two games on one page would need a different binding.
