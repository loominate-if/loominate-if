/**
 * A widget listing things, each a button that opens its menu (#77, ADR
 * 0046): the world model's inventory is one. It's generic, so the package
 * that knows which things to list supplies them, and needs no DOM itself.
 */
import { message } from "@loominate-if/core";
import "../messages.js";
import { widget, type WidgetDefinition } from "./layout.js";

/** One thing a things widget lists: its ID, and how it's named, such as "an iron key". */
export type ListedThing = { readonly id: string; readonly label: string };

/** How {@link thingsWidget} lists things. */
export type ThingsWidgetOptions = {
  /** The things to list now. */
  readonly things: () => readonly ListedThing[];
  /** The widget's heading, such as "You carry". */
  readonly title: () => string;
};

/**
 * A widget listing things, each a button that opens the thing's menu, as a
 * name in the text does. It shows "nothing" when there's nothing to list.
 */
export function thingsWidget(options: ThingsWidgetOptions): WidgetDefinition<{
  readonly title: string;
  readonly things: readonly ListedThing[];
}> {
  return widget({
    data: () => ({ title: options.title(), things: options.things() }),
    view: {
      mount(element, data, host) {
        const doc = element.ownerDocument;
        const box = doc.createElement("div");
        box.className = "loominate-things";
        element.append(box);
        const show = (d: { readonly title: string; readonly things: readonly ListedThing[] }) => {
          box.replaceChildren();
          const title = doc.createElement("span");
          title.className = "loominate-things-title";
          title.textContent = `${d.title}: `;
          box.append(title);
          if (d.things.length === 0) {
            box.append(message("things.nothing"));
            return;
          }
          for (const [i, t] of d.things.entries()) {
            if (i > 0) box.append(", ");
            const holder = doc.createElement("span");
            holder.className = "loominate-has-menu";
            const b = doc.createElement("button");
            b.type = "button";
            b.className = "loominate-link loominate-inline";
            b.textContent = t.label;
            holder.append(b);
            host.menu(b, t.id);
            box.append(holder);
          }
        };
        show(data);
        return {
          update: show,
          unmount: () => {
            box.remove();
          },
        };
      },
    },
  });
}

/** Widgets packages add to the default page's header, after the game menu. */
const header: string[] = [];

/**
 * Adds a registered widget to the default page's header, after the game
 * menu, as the world model does with its inventory. A game that replaces the
 * `page` layout places widgets itself.
 */
export function addToHeader(name: string): void {
  if (!header.includes(name)) header.push(name);
}

/** The widgets packages added to the header. @internal */
export function headerWidgets(): readonly string[] {
  return header;
}
