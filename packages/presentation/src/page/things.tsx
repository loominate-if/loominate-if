/**
 * A widget listing things, each a button that opens its menu (#77, ADR
 * 0046): the world model's inventory is one. It's generic, so the package
 * that knows which things to list supplies them, and needs no DOM itself.
 */
import { message } from "@loominate-if/core";
import "../messages.js";
import { Fragment } from "preact";
import { widget, type WidgetDefinition } from "./layout.js";
import type { MenuChoice } from "./menus.js";
import { componentView, MenuButton, type ViewProps } from "./view.js";

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
    view: componentView(ThingsView),
  });
}

function ThingsView({
  data,
  host,
}: ViewProps<{ readonly title: string; readonly things: readonly ListedThing[] }>) {
  const { title, things } = data.value;
  return (
    <div className="loominate-things">
      <span className="loominate-things-title">{`${title}: `}</span>
      {things.length === 0
        ? message("things.nothing")
        : things.map((t, i) => (
            <Fragment key={t.id}>
              {i > 0 && ", "}
              <span className="loominate-has-menu">
                <MenuButton host={host} source={t.id} className="loominate-link loominate-inline">
                  {t.label}
                </MenuButton>
              </span>
            </Fragment>
          ))}
    </div>
  );
}

/** How {@link menuWidget} shows its button and its menu. */
export type MenuWidgetOptions = {
  /** The button's label, such as "Wait". */
  readonly label: () => string;
  /** The choices its menu lists, worked out each time it opens. */
  readonly choices: () => readonly MenuChoice[];
};

/**
 * A widget that's a button opening a menu of actions, as a thing's name
 * does, but of the choices it's given: the world model's Wait menu is one.
 * Choices whose action verify hides aren't listed, and those check
 * disables are, with why.
 */
export function menuWidget(options: MenuWidgetOptions): WidgetDefinition<{
  readonly label: string;
}> {
  return widget({
    data: () => ({ label: options.label() }),
    view: componentView<{ readonly label: string }>(({ data, host }) => (
      <span className="loominate-has-menu loominate-menu-widget">
        <MenuButton host={host} source={options.choices}>
          {data.value.label}
        </MenuButton>
      </span>
    )),
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
