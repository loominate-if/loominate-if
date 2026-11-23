/**
 * The inventory (#77, ADR 0046): what the player carries, each thing's name
 * opening its menu, in the page's header.
 */
import { message, messages, t } from "@loominate-if/core";
import { addToHeader, thingsWidget, widgets } from "@loominate-if/presentation";
import { currentPlayerBody } from "./actors.js";
import { contents } from "./things.js";

declare module "@loominate-if/core" {
  interface Messages {
    /** The inventory's heading. */
    "inventory.title": Record<never, never>;
  }
}

messages.register("inventory.title", "You carry", { source: "@loominate-if/world" });

/** The inventory widget: the things the player's body holds, each opening its menu. */
export const inventory = thingsWidget({
  title: () => message("inventory.title"),
  things: () => {
    const body = currentPlayerBody();
    return body ? contents(body).map((c) => ({ id: c.id, label: t`{a ${c}}`() })) : [];
  },
});

widgets.register("inventory", inventory, { source: "@loominate-if/world" });
addToHeader("inventory");
