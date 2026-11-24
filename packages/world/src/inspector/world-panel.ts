/**
 * The World tab (#82, ADR 0073): the world as a tree, places with what's in
 * them, nested, then what's out of the world and minds with no body. It's
 * an ARIA tree: the arrow keys move and open, Enter or Space chooses, and
 * choosing a node shows beside the tree where it is, its properties, its
 * mind or body, and who knows what, both ways. It starts open on the
 * player and keeps what's been opened as the game moves.
 */
import { describeObjects, type StateValue } from "@loominate-if/core";
import type { InspectorPanel } from "@loominate-if/inspector";
import {
  _playerPath,
  _worldDetails,
  _worldTree,
  type _Details,
  type _TreeNode,
} from "@loominate-if/world";

const NOWHERE = "$nowhere";
const BODILESS = "$bodiless";

const STYLES = `
.world { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; }
.world-tree { flex: 1 1 14rem; min-width: 0; }
.world-details { flex: 1 1 14rem; min-width: 0; }
.world [role=tree], .world [role=group] { list-style: none; margin: 0; padding: 0; }
.world [role=group] { padding-inline-start: 1.1rem; }
.world [role=treeitem] > .row { display: block; padding: 0.1rem 0.25rem; border-radius: 3px; cursor: pointer; }
.world [role=treeitem] > .row::before { display: inline-block; width: 1em; content: ""; }
.world [role=treeitem][aria-expanded=false] > .row::before { content: "▸"; }
.world [role=treeitem][aria-expanded=true] > .row::before { content: "▾"; }
.world [role=treeitem][aria-selected=true] > .row { background: var(--selected, rgba(127, 127, 127, 0.25)); }
.world [role=treeitem]:focus { outline: none; }
.world [role=treeitem]:focus-visible > .row { outline: 2px solid currentColor; }
.world [role=treeitem][aria-expanded=false] > [role=group] { display: none; }
.world code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.world .note { color: var(--muted, inherit); }
.world .jump { font: inherit; padding: 0; border: 0; background: none; color: inherit; text-decoration: underline; cursor: pointer; }
.world dl { margin: 0.25rem 0; display: grid; grid-template-columns: max-content 1fr; gap: 0.1rem 0.75rem; }
.world dt { font-weight: 600; }
.world dd { margin: 0; }
.world ul.facts { margin: 0.25rem 0; padding-inline-start: 1.1rem; }
.world h3 { margin: 0.5rem 0 0.25rem; font-size: 1em; }
.world h4 { margin: 0.5rem 0 0.15rem; font-size: 1em; }
`;

/** A property's value as the tab shows it: a reference to another object as its ID, with an arrow. */
const shown = (value: StateValue): string => {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && "$ref" in value) {
    return `→ ${String((value as { $ref: unknown }).$ref)}`;
  }
  return JSON.stringify(value);
};

/** The panel showing the world as a tree, with a node's details beside it. */
export const worldPanel: InspectorPanel = {
  title: "World",
  mount(element, context) {
    const doc = element.ownerDocument;
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
    element.append(el("style", undefined, STYLES));
    const root = el("div", "world");
    const treeSide = el("div", "world-tree");
    const showPlayer = el("button", "jump", "Show the player");
    showPlayer.type = "button";
    const tree = el("ul");
    tree.setAttribute("role", "tree");
    tree.setAttribute("aria-label", "World");
    treeSide.append(el("p", undefined), tree);
    treeSide.firstElementChild?.append(showPlayer);
    const details = el("section", "world-details");
    details.setAttribute("aria-label", "Details");
    root.append(treeSide, details);
    element.append(root);

    const expanded = new Set<string>();
    let selected: string | undefined;
    let focused: string | undefined;
    let opened = false;
    /** Each node's parent, from the last drawing, for opening the way to one. */
    let parents = new Map<string, string>();

    const items = (): HTMLElement[] =>
      [...tree.querySelectorAll<HTMLElement>("[role=treeitem]")].filter(
        (item) => !item.parentElement?.closest("[role=treeitem][aria-expanded=false]"),
      );
    const itemFor = (id: string): HTMLElement | undefined =>
      [...tree.querySelectorAll<HTMLElement>("[role=treeitem]")].find((i) => i.dataset.id === id);

    /** Opens the way to `id`, chooses it, and focuses it. */
    const reveal = (id: string, focus = true): void => {
      const target = itemFor(id) ? id : (_worldDetails(id)?.body ?? id);
      for (let at = parents.get(target); at !== undefined; at = parents.get(at)) expanded.add(at);
      selected = target;
      focused = target;
      update();
      if (focus) itemFor(target)?.focus();
    };

    const drawNode = (
      n: Pick<_TreeNode, "id" | "name" | "kind" | "mind" | "count"> & {
        readonly children: readonly (
          _TreeNode | Pick<_TreeNode, "id" | "name" | "kind" | "children">
        )[];
      },
      level: number,
      parent: string | undefined,
    ): HTMLElement => {
      if (parent !== undefined) parents.set(n.id, parent);
      const li = el("li");
      li.setAttribute("role", "treeitem");
      li.dataset.id = n.id;
      li.setAttribute("aria-level", String(level));
      li.tabIndex = -1;
      const row = el("span", "row");
      const group = n.id === NOWHERE || n.id === BODILESS;
      row.append(n.name);
      if (!group) row.append(" ", el("code", "note", n.id));
      if (n.mind !== undefined) row.append(" ", el("span", "note", `(mind: ${n.mind})`));
      if (n.count !== undefined) row.append(" ", el("span", "note", `×${String(n.count)}`));
      li.append(row);
      if (n.children.length > 0) {
        li.setAttribute("aria-expanded", String(expanded.has(n.id)));
        const ul = el("ul");
        ul.setAttribute("role", "group");
        for (const c of n.children) ul.append(drawNode(c, level + 1, n.id));
        li.append(ul);
      }
      if (!group) li.setAttribute("aria-selected", String(selected === n.id));
      return li;
    };

    const jump = (id: string): HTMLButtonElement => {
      const b = el("button", "jump", id);
      b.type = "button";
      b.addEventListener("click", () => {
        reveal(id);
      });
      return b;
    };
    const ids = (list: readonly string[]): (HTMLElement | string)[] =>
      list.length === 0
        ? ["none"]
        : list.flatMap((id, i) => (i === 0 ? [jump(id)] : [", ", jump(id)]));

    const drawDetails = (d: _Details | undefined): void => {
      details.replaceChildren();
      if (!d) {
        details.append(el("p", "note", "Choose something in the tree to see its details."));
        return;
      }
      const heading = el("h3");
      heading.append(d.name, " ", el("code", "note", d.id));
      details.append(heading, el("p", "note", d.kind === "body" ? "a body" : `a ${d.kind}`));
      const facts = el("dl");
      const row = (term: string, ...value: (Node | string)[]) => {
        const dd = el("dd");
        dd.append(...value);
        facts.append(el("dt", undefined, term), dd);
      };
      if (d.kind !== "mind") row("In", ...(d.within.length === 0 ? ["nowhere"] : ids(d.within)));
      if (d.kind === "body") row("Mind", ...(d.mind === undefined ? ["none"] : [d.mind]));
      if (d.kind === "mind") row("Body", ...(d.body === undefined ? ["none"] : [jump(d.body)]));
      if (d.seenBy) row("Seen by", ...(d.seenBy.length === 0 ? ["no one"] : d.seenBy));
      if (d.knownOfBy && d.knownOfBy.length > 0) row("Known of by", d.knownOfBy.join(", "));
      details.append(facts);
      const k = d.knowledge;
      if (k) {
        details.append(el("h4", undefined, `What ${k.mind} knows`));
        if (k.facts.length === 0) details.append(el("p", "note", "No facts."));
        else {
          const list = el("ul", "facts");
          for (const f of k.facts) {
            const li = el("li");
            li.append(f.text, " ", el("code", "note", f.id));
            if (f.from !== undefined) li.append(", from ", jump(f.from));
            if (f.passage !== undefined) li.append(", in ", el("code", undefined, f.passage));
            list.append(li);
          }
          details.append(list);
        }
        const seen = el("dl");
        const put = (term: string, list: readonly string[]) => {
          const dd = el("dd");
          dd.append(...ids(list));
          seen.append(el("dt", undefined, term), dd);
        };
        put("Has seen", k.seen);
        put("Knows of", k.knownOf);
        details.append(seen);
      }
      const store = context.player.store;
      const object = store && describeObjects(store).find((o) => o.id === d.id);
      if (object && object.properties.length > 0) {
        details.append(el("h4", undefined, "Properties"));
        const props = el("dl");
        for (const p of object.properties) {
          props.append(el("dt", undefined, p.key), el("dd", undefined, shown(p.value)));
        }
        details.append(props);
      }
    };

    const update = (): void => {
      const world = _worldTree();
      if (!opened) {
        // The first time, open the way to the player.
        const path = _playerPath();
        for (const id of path.slice(0, -1)) expanded.add(id);
        opened = path.length > 0;
      }
      const hadFocus = tree.contains(doc.activeElement);
      parents = new Map();
      const top = [
        ...world.places.map((p) => drawNode(p, 1, undefined)),
        ...(world.nowhere.length > 0
          ? [
              drawNode(
                {
                  id: NOWHERE,
                  name: `Out of the world (${String(world.nowhere.length)})`,
                  kind: "thing",
                  children: world.nowhere,
                },
                1,
                undefined,
              ),
            ]
          : []),
        ...(world.bodiless.length > 0
          ? [
              drawNode(
                {
                  id: BODILESS,
                  name: `Minds with no body (${String(world.bodiless.length)})`,
                  kind: "mind",
                  children: world.bodiless,
                },
                1,
                undefined,
              ),
            ]
          : []),
      ];
      tree.replaceChildren(...top);
      if (top.length === 0) tree.append(el("li", "note", "The world has nothing in it yet."));
      // One item takes Tab: the focused one, the chosen one, or the first.
      const all = items();
      const current =
        all.find((i) => i.dataset.id === focused) ??
        all.find((i) => i.dataset.id === selected) ??
        all[0];
      if (current) current.tabIndex = 0;
      if (hadFocus) current?.focus();
      drawDetails(selected === undefined ? undefined : _worldDetails(selected));
    };

    const toggle = (item: HTMLElement): void => {
      const id = item.dataset.id;
      if (id === undefined || !item.hasAttribute("aria-expanded")) return;
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      focused = id;
      update();
      itemFor(id)?.focus();
    };
    const choose = (item: HTMLElement): void => {
      const id = item.dataset.id;
      if (id === undefined) return;
      if (id === NOWHERE || id === BODILESS) {
        toggle(item);
        return;
      }
      selected = id;
      focused = id;
      update();
      itemFor(id)?.focus();
    };

    tree.addEventListener("click", (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>("[role=treeitem]");
      if (!item) return;
      // Choosing what's chosen opens or closes it.
      if (item.dataset.id === selected) toggle(item);
      else choose(item);
    });
    tree.addEventListener("keydown", (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>("[role=treeitem]");
      if (!item) return;
      const all = items();
      const at = all.indexOf(item);
      const go = (to: HTMLElement | undefined) => {
        if (!to) return;
        for (const i of all) i.tabIndex = -1;
        to.tabIndex = 0;
        focused = to.dataset.id;
        to.focus();
      };
      const open = item.getAttribute("aria-expanded");
      let handled = true;
      if (event.key === "ArrowDown") go(all[at + 1]);
      else if (event.key === "ArrowUp") go(all[at - 1]);
      else if (event.key === "Home") go(all[0]);
      else if (event.key === "End") go(all.at(-1));
      else if (event.key === "ArrowRight") {
        if (open === "false") toggle(item);
        else if (open === "true")
          go(item.querySelector<HTMLElement>("[role=treeitem]") ?? undefined);
      } else if (event.key === "ArrowLeft") {
        if (open === "true") toggle(item);
        else go(item.parentElement?.closest<HTMLElement>("[role=treeitem]") ?? undefined);
      } else if (event.key === "Enter" || event.key === " ") choose(item);
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    });
    showPlayer.addEventListener("click", () => {
      const path = _playerPath();
      const body = path.at(-1);
      if (body !== undefined) reveal(body);
    });

    update();
    return { update };
  },
};
