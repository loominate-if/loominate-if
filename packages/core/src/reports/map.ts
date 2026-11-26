/**
 * Views a package adds to the story map (#426, ADR 0124), read from the
 * begun game, as the world model's rooms. The dev server's map page and
 * `loominate map` begin the game once, as coverage does, and draw every
 * view registered here beside the compiler's Passages view.
 */
import { registry, type Registry } from "../rules/registry.js";
import type { CoverageGame } from "./coverage.js";

/** A place in a view, as a room. */
export type MapViewNode = {
  /** Its id within the view, as an object's ID. */
  readonly id: string;
  /** What it's called on the map, as a room's name. */
  readonly label: string;
  /** Notes beside it, as `passage: Hall`. */
  readonly tags?: readonly string[];
  /** True for where the game starts. */
  readonly start?: true;
  /** Where to draw it on a grid, in cells: x to the right, y down. Without it, the map lays it out. */
  readonly cell?: { readonly x: number; readonly y: number };
};

/** A way from one place to another, as an exit. */
export type MapViewEdge = {
  readonly from: string;
  readonly to: string;
  /** What kind of way it is, as an exit's direction: `north`. */
  readonly kind: string;
  /** How to say it, as "North" or "North, through the gate". */
  readonly label?: string;
  /** True if something can stand in the way, as a door. */
  readonly guarded?: true;
  /** True if it doesn't fit the grid, as `up`, or a clash, so it's drawn bent. */
  readonly bent?: true;
};

/** A view as a package gives it. */
export type MapViewContent = {
  readonly nodes: readonly MapViewNode[];
  readonly edges: readonly MapViewEdge[];
};

/** A view of the story map that a package adds. */
export type MapViewSource = {
  /** What the view is called, as `Rooms`. */
  readonly title: string;
  /** The view, read from the begun game. */
  readonly view: (game: CoverageGame) => MapViewContent;
};

/**
 * The views packages add to the story map, by name. The world model adds
 * `rooms`.
 *
 * @example
 * ```ts
 * mapViews.register("regions", {
 *   title: "Regions",
 *   view: () => ({
 *     nodes: regions.map((r) => ({ id: r.id, label: r.name })),
 *     edges: [],
 *   }),
 * });
 * ```
 */
export const mapViews: Registry<MapViewSource> = registry<MapViewSource>("mapViews");
