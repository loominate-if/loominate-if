/**
 * Things' menus (#77, ADR 0046): what the player can do with a thing,
 * opened from its name in the text or from the inventory.
 *
 * It's the menu button pattern: the name is a button that opens a menu of
 * the thing's actions, which arrow keys move through, Enter or a click
 * takes, and Escape, Tab, or a click elsewhere closes, giving focus back.
 * Actions verify hides aren't listed; those check disables are, with why.
 */
import {
  actionsFor,
  message,
  statusOf,
  type ActionCall,
  type ActionStatus,
  type AskedNumber,
} from "@loominate-if/core";
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

  /** The menu or form on show: a function, so code after `open` sees the new one. */
  const current = () => shown;

  /**
   * Swaps the menu on show for a form asking for an action's numbers: a
   * labelled number field for each, and buttons to take it or go back.
   */
  const ask = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    call: ActionCall<any>,
    label: string,
    status: ActionStatus,
    back: () => void,
  ): void => {
    if (!shown) return;
    const { list, anchor } = shown;
    const id = `${list.id}-ask`;
    const form = doc.createElement("form");
    form.className = "loominate-menu loominate-menu-ask";
    form.id = id;
    form.setAttribute("aria-labelledby", `${id}-title`);
    form.noValidate = true;
    const title = doc.createElement("p");
    title.className = "loominate-menu-ask-title";
    title.id = `${id}-title`;
    title.textContent = label.replace(/…$/, "");
    form.append(title);
    const fields: { readonly asked: AskedNumber; readonly input: HTMLInputElement }[] = [];
    for (const asked of status.asks ?? []) {
      const row = doc.createElement("p");
      row.className = "loominate-menu-ask-field";
      const input = doc.createElement("input");
      input.type = "number";
      input.inputMode = "numeric";
      input.id = `${id}-${asked.name}`;
      input.min = String(asked.min);
      if (asked.max !== undefined) input.max = String(asked.max);
      input.step = "1";
      input.value = String(asked.start);
      const name = doc.createElement("label");
      name.htmlFor = input.id;
      name.textContent = asked.label;
      row.append(name, " ", input);
      if (asked.max !== undefined) {
        const of = doc.createElement("span");
        of.id = `${input.id}-of`;
        of.textContent = message("menu.ask.of", { max: asked.max });
        input.setAttribute("aria-describedby", of.id);
        row.append(" ", of);
      }
      form.append(row);
      fields.push({ asked, input });
    }
    const problem = doc.createElement("p");
    problem.className = "loominate-menu-reason";
    problem.setAttribute("role", "alert");
    const buttons = doc.createElement("p");
    buttons.className = "loominate-menu-ask-buttons";
    const confirm = doc.createElement("button");
    confirm.type = "submit";
    confirm.className = "loominate-link";
    confirm.textContent = status.confirm ?? message("menu.ask.confirm", {});
    const goBack = doc.createElement("button");
    goBack.type = "button";
    goBack.className = "loominate-link";
    goBack.textContent = message("menu.ask.back", {});
    buttons.append(confirm, " ", goBack);
    form.append(problem, buttons);
    const returnToMenu = () => {
      form.remove();
      shown = undefined;
      back();
    };
    goBack.addEventListener("click", returnToMenu);
    form.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      returnToMenu();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const args: Record<string, number> = {};
      for (const { asked, input } of fields) {
        const n = Number(input.value);
        if (
          input.value.trim() === "" ||
          !Number.isInteger(n) ||
          n < asked.min ||
          (asked.max !== undefined && n > asked.max)
        ) {
          problem.textContent = message("menu.ask.problem", {
            min: asked.min,
            ...(asked.max !== undefined && { max: asked.max }),
          });
          input.setAttribute("aria-invalid", "true");
          input.focus();
          return;
        }
        args[asked.name] = n;
      }
      form.remove();
      shown = undefined;
      anchor.setAttribute("aria-expanded", "false");
      host.act({ ...call, args: { ...(call.args as object), ...args } }, label);
    });
    list.replaceWith(form);
    // The form stands where the menu did, so clicks inside it keep it open.
    shown = { list: form, anchor };
    fields[0]?.input.select();
    fields[0]?.input.focus();
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
      } else if (status.asks !== undefined) {
        // It needs numbers first: the menu gives way to a form asking for them.
        const at = items.length;
        item.addEventListener("click", () => {
          ask(call, shown, status, () => {
            // Back to the menu, on the choice that asked.
            open(source, anchor);
            current()?.list.querySelectorAll<HTMLElement>("[role=menuitem]")[at]?.focus();
          });
        });
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
    // A click on something it just took away, such as the menu choice that gave way to a form.
    if (target && !target.isConnected) return;
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
