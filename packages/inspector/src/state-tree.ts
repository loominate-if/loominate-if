/**
 * The state tree panel (#45): every object in the game, with every property,
 * as an expandable tree, and then the engine's own state. Values still at
 * their defaults are dimmed, and what the last move changed is marked.
 * Read-only: the inspector shows the game, it doesn't change it.
 */
import { describeObjects, type StateStore, type StateValue } from "@loominate-if/core";
import type { InspectorPanel } from "./panels.js";

/** A node at the top of the tree: an object, or an entry in the engine's state. */
type Entry = {
  readonly id: string;
  readonly engine: boolean;
  readonly template?: string;
  readonly properties: readonly {
    readonly key: string;
    readonly value: StateValue;
    readonly isDefault: boolean;
  }[];
};

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The game's objects, with defaults filled in, then whatever else the store
 * holds: the engine's state, under IDs such as `$story`.
 */
function entries(store: StateStore): Entry[] {
  const objects = describeObjects(store);
  const described = new Set(objects.map((o) => o.id));
  const raw = (id: string) =>
    Object.entries(store.entity(id) ?? {}).map(([key, value]) => ({
      key,
      value,
      isDefault: false,
    }));
  return [
    ...objects.map((o) => {
      // Core's bookkeeping on an object, such as how many it has spawned, is stored state too.
      const known = new Set(o.properties.map((p) => p.key));
      const extra = raw(o.id).filter((p) => !known.has(p.key));
      return {
        id: o.id,
        engine: false,
        ...(o.template !== undefined && { template: o.template }),
        properties: [...o.properties, ...extra].sort((a, b) => byName(a.key, b.key)),
      };
    }),
    ...store
      .ids()
      .filter((id) => !described.has(id))
      .sort(byName)
      .map((id) => ({
        id,
        engine: true,
        properties: raw(id).sort((a, b) => byName(a.key, b.key)),
      })),
  ];
}

/** A stored reference to another object, `{ $ref: id }`. */
function refTo(value: StateValue): string | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const keys = Object.keys(value);
  const id = (value as { readonly [key: string]: StateValue }).$ref;
  return keys.length === 1 && typeof id === "string" ? id : undefined;
}

/** How a value reads in the tree: strings quoted, as in code, and references as arrows. */
function show(value: StateValue): string {
  const ref = refTo(value);
  if (ref !== undefined) return `→ ${ref}`;
  if (Array.isArray(value)) return `Array(${String(value.length)})`;
  if (value !== null && typeof value === "object") {
    return `{${String(Object.keys(value).length)}}`;
  }
  return JSON.stringify(value);
}

const nested = (
  value: StateValue,
): value is readonly StateValue[] | { [key: string]: StateValue } =>
  value !== null && typeof value === "object" && refTo(value) === undefined;

/** The panel showing the state store. */
export const stateTree: InspectorPanel = {
  title: "State",
  mount(element, { player }) {
    const doc = element.ownerDocument;
    /** Paths of the open nodes, kept as the tree is redrawn. */
    const open = new Set<string>();
    let previous = new Map<string, string>();
    let filter = "";

    const search = doc.createElement("input");
    search.type = "search";
    search.className = "filter";
    search.placeholder = "Filter by object ID";
    search.setAttribute("aria-label", "Filter by object ID");
    const tree = doc.createElement("div");
    tree.className = "tree";
    const empty = doc.createElement("p");
    empty.className = "empty";
    element.append(search, tree, empty);

    const el = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      className?: string,
      text?: string,
    ) => {
      const node = doc.createElement(tag);
      if (className !== undefined) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    /** A changed mark: highlighted, and spoken as "changed". */
    const mark = (node: HTMLElement) => {
      node.dataset.changed = "";
      node.append(el("span", "visually-hidden", " (changed)"));
    };

    /** An expandable node, remembering whether it's open. */
    const branch = (path: string, label: Node[], changed: boolean) => {
      const details = el("details");
      details.dataset.path = path;
      details.open = open.has(path);
      details.addEventListener("toggle", () => {
        if (details.open) open.add(path);
        else open.delete(path);
      });
      const summary = el("summary");
      summary.append(...label);
      if (changed) mark(summary);
      details.append(summary);
      return details;
    };

    /** A property and its value, nested values as branches. */
    const property = (
      path: string,
      key: string,
      value: StateValue,
      changed: boolean,
      isDefault = false,
    ): HTMLElement => {
      const name = el("span", "key", key);
      const shown = el("span", "value", show(value));
      shown.dataset.type =
        refTo(value) !== undefined
          ? "ref"
          : value === null
            ? "null"
            : Array.isArray(value)
              ? "array"
              : typeof value;
      if (isDefault) {
        shown.dataset.default = "";
        shown.title = "The default, from the object's definition";
      }
      if (!nested(value)) {
        const leaf = el("div", "leaf");
        leaf.append(name, ": ", shown);
        if (changed) mark(leaf);
        return leaf;
      }
      const node = branch(path, [name, doc.createTextNode(": "), shown], changed);
      const children = el("div", "children");
      // Arrays keep their order; objects' keys are sorted, as the store's are.
      const entries = Object.entries(value);
      if (!Array.isArray(value)) entries.sort(([a], [b]) => a.localeCompare(b));
      for (const [k, v] of entries) {
        children.append(property(`${path}.${k}`, k, v, false));
      }
      node.append(children);
      return node;
    };

    let changed = new Set<string>();
    let seen: unknown;
    let current: Entry[] = [];
    /** Notes what changed since the last update, by `id` and `id\u0000key`. */
    const refresh = () => {
      const store = player.store;
      current = store ? entries(store) : [];
      const now = new Map<string, string>();
      for (const entry of current) {
        for (const p of entry.properties) {
          now.set(`${entry.id}\u0000${p.key}`, JSON.stringify(p.value));
        }
      }
      // A new or loaded game is a fresh start, not a change.
      changed = new Set();
      if (store === seen) {
        for (const [at, value] of now) {
          if (previous.get(at) === value) continue;
          changed.add(at);
          changed.add(at.slice(0, at.indexOf("\u0000")));
        }
      }
      seen = store;
      previous = now;
      draw();
    };

    const draw = () => {
      tree.replaceChildren();
      if (!player.store) {
        empty.textContent = "No game has started yet.";
        return;
      }
      const shown = current.filter((e) => e.id.toLowerCase().includes(filter.toLowerCase()));
      let engineGroup: HTMLElement | undefined;
      for (const entry of shown) {
        const label: Node[] = [el("span", "id", entry.id)];
        if (entry.template !== undefined)
          label.push(el("span", "template", ` (${entry.template})`));
        const node = branch(entry.id, label, changed.has(entry.id));
        const children = el("div", "children");
        for (const p of entry.properties) {
          children.append(
            property(
              `${entry.id}/${p.key}`,
              p.key,
              p.value,
              changed.has(`${entry.id}\u0000${p.key}`),
              p.isDefault,
            ),
          );
        }
        node.append(children);
        if (entry.engine) {
          if (!engineGroup) {
            engineGroup = branch("$", [el("span", "group", "Engine state")], false);
            tree.append(engineGroup);
          }
          engineGroup.append(node);
        } else {
          tree.append(node);
        }
      }
      empty.textContent =
        shown.length === 0
          ? current.length === 0
            ? "The game has no state yet."
            : "No IDs match."
          : "";
    };

    search.addEventListener("input", () => {
      filter = search.value.trim();
      draw();
    });

    refresh();
    return { update: refresh };
  },
};
