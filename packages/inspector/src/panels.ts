/**
 * The inspector's panel registry (#45, #188): each tab in the inspector is a
 * registered panel. The inspector's own panels are registered the same way an
 * optional package, such as the world model, registers its views, so the
 * inspector never depends on those packages.
 */
import { registry, type Registry } from "@loominate-if/core";
import type { Player } from "@loominate-if/presentation";

/** What a panel is given to show. */
export interface PanelContext {
  /** The game being inspected. Its `story`, `store`, and `page` change when a game starts or loads. */
  readonly player: Player;
}

/** A mounted panel. */
export interface PanelView {
  /** Shows the game as it is now. Called when the game changes while the panel is showing, and when it's shown again. */
  update(): void;
  /** Cleans up when the inspector is removed. */
  destroy?(): void;
}

/** A tab in the inspector. */
export interface InspectorPanel {
  /** The tab's label. */
  readonly title: string;
  /**
   * Draws the panel into `element` the first time its tab is shown. The
   * element is inside the inspector's shadow root, so the game's styles
   * don't reach it; put any styles the panel needs inside it.
   */
  mount(element: HTMLElement, context: PanelContext): PanelView;
}

/**
 * The inspector's panels, as tabs, in registration order. Register a panel
 * to add a tab:
 *
 * @example
 * ```ts
 * panels.register("clock", clockPanel, { source: "@my-scope/clock" });
 * ```
 */
export const panels: Registry<InspectorPanel> = registry<InspectorPanel>("inspector panels");
