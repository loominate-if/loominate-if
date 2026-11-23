/**
 * Things' menus (#77, ADR 0046): what the player can do with a thing,
 * opened from its name in the text or from the inventory.
 *
 * It's the menu button pattern: the name is a button that opens a menu of
 * the thing's actions, which arrow keys move through, Enter or a click
 * takes, and Escape, Tab, or a click elsewhere closes, giving focus back.
 * Actions verify hides aren't listed; those check disables are, with why.
 */
import { actionsFor, message, statusOf, type ActionCall } from "@loominate-if/core";
import "../messages.js";

/** What the menus need from the page. */
export type MenuHost = {
  readonly doc: Document;
  /** Takes the chosen action, and redraws the page. */
  readonly act: (call: ActionCall, label: string) => void;
};

/** One choice in a menu that isn't a thing's: an action, and what to call it, if not its own label. */
export type MenuChoice = {
  // A call of any action: an action's type is invariant in its arguments, so no narrower type takes them all.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly call: ActionCall<any>;
  readonly label?: string;
};

/**
 * What a menu lists: the actions for the thing with this ID, or, from a
 * function, the choices it gives when the menu opens.
 */
export type MenuSource = string | (() => readonly MenuChoice[]);

/** Opens and closes things' menus. */
export type Menus = {
  /** Opens the menu for `source`, under `anchor`, which it gives focus back to. */
  open(source: MenuSource, anchor: HTMLElement): void;
  /** Closes the menu on show, if any. */
  close(): void;
  /** Makes `anchor` a button that opens the menu for `source`. */
  trigger(anchor: HTMLElement, source: MenuSource): void;
};

let menus = 0;

/** Creates the menus for a page. */
export function createMenus(host: MenuHost): Menus {
  const { doc } = host;
  let shown: { readonly list: HTMLElement; readonly anchor: HTMLElement } | undefined;

  const close = (focusAnchor = false): void => {
    if (!shown) return;
    const { list, anchor } = shown;
    shown = undefined;
    list.remove();
    anchor.setAttribute("aria-expanded", "false");
    if (focusAnchor) anchor.focus();
  };

  const open = (source: MenuSource, anchor: HTMLElement): void => {
    close();
    const id = `loominate-menu-${String(++menus)}`;
    if (!anchor.id) anchor.id = `${id}-button`;
    const list = doc.createElement("ul");
    list.className = "loominate-menu";
    list.id = id;
    list.setAttribute("role", "menu");
    list.setAttribute("aria-labelledby", anchor.id);
    const items: HTMLElement[] = [];
    const choices: readonly MenuChoice[] =
      typeof source === "string" ? actionsFor({ id: source }).map((call) => ({ call })) : source();
    for (const { call, label } of choices) {
      const status = statusOf(call);
      if (status.hidden !== undefined) continue;
      const shown = label ?? status.label;
      const li = doc.createElement("li");
      li.setAttribute("role", "none");
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "loominate-menu-item";
      item.setAttribute("role", "menuitem");
      item.tabIndex = -1;
      item.textContent = shown;
      li.append(item);
      if (status.disabled !== undefined) {
        item.setAttribute("aria-disabled", "true");
        const why = doc.createElement("span");
        why.className = "loominate-menu-reason";
        why.id = `${id}-why-${String(items.length)}`;
        why.textContent = status.disabled;
        item.setAttribute("aria-describedby", why.id);
        li.append(why);
      } else {
        item.addEventListener("click", () => {
          close();
          host.act(call, shown);
        });
      }
      items.push(item);
      list.append(li);
    }
    if (items.length === 0) {
      const li = doc.createElement("li");
      li.setAttribute("role", "none");
      const item = doc.createElement("span");
      item.setAttribute("role", "menuitem");
      item.setAttribute("aria-disabled", "true");
      item.tabIndex = -1;
      item.className = "loominate-menu-item";
      item.textContent = message("menu.nothing");
      li.append(item);
      list.append(li);
      items.push(item);
    }
    list.addEventListener("keydown", (event) => {
      const at = items.indexOf(doc.activeElement as HTMLElement);
      const to = (i: number) => {
        items[(i + items.length) % items.length]?.focus();
        event.preventDefault();
      };
      if (event.key === "ArrowDown") to(at + 1);
      else if (event.key === "ArrowUp") to(at - 1);
      else if (event.key === "Home") to(0);
      else if (event.key === "End") to(items.length - 1);
      else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === "Tab") close();
    });
    anchor.insertAdjacentElement("afterend", list);
    anchor.setAttribute("aria-expanded", "true");
    shown = { list, anchor };
    items[0]?.focus();
  };

  // A click anywhere but the menu and its button closes it.
  doc.addEventListener("click", (event) => {
    if (!shown) return;
    const target = event.target as Node | null;
    if (target && (shown.list.contains(target) || shown.anchor.contains(target))) return;
    close();
  });

  const trigger = (anchor: HTMLElement, source: MenuSource): void => {
    anchor.classList.add("loominate-menu-link");
    anchor.setAttribute("aria-haspopup", "menu");
    anchor.setAttribute("aria-expanded", "false");
    anchor.addEventListener("click", () => {
      if (shown?.anchor === anchor) close();
      else open(source, anchor);
    });
    // The arrow keys open it too, as a menu button's do.
    anchor.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      open(source, anchor);
    });
  };

  return { open, close: () => close(), trigger };
}
