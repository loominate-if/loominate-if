/**
 * The theme tokens (#40, ADR 0018). Plain data with no DOM types, so the
 * repository's docs check can read it too.
 */

/** A theme token: a CSS custom property the default styles read. */
export type ThemeToken = {
  /** The property's name, such as `--loominate-color-text`. */
  readonly name: `--loominate-${string}`;
  /** Its default value. Colors use `light-dark()` so they follow the player's preference. */
  readonly value: string;
  /** What it styles. */
  readonly description: string;
};

/**
 * The theme tokens, with their defaults. Override them in a theme file:
 *
 * @example
 * ```css
 * :root {
 *   --loominate-font-body: "Iowan Old Style", Georgia, serif;
 *   --loominate-color-accent: light-dark(#8a3b12, #f0a46e);
 * }
 * ```
 */
export const themeTokens: readonly ThemeToken[] = [
  {
    name: "--loominate-font-body",
    value: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
    description: "The typeface for prose.",
  },
  {
    name: "--loominate-font-ui",
    value: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    description: "The typeface for widgets, such as the status line, and the drawer's label.",
  },
  { name: "--loominate-font-size", value: "1.125rem", description: "The prose's size." },
  { name: "--loominate-line-height", value: "1.6", description: "The prose's line height." },
  {
    name: "--loominate-measure",
    value: "38rem",
    description: "The maximum width of the page without sidebars, which keeps lines readable.",
  },
  {
    name: "--loominate-sidebar-width",
    value: "14rem",
    description: "The width of each sidebar beside main, which widens the page by as much.",
  },
  {
    name: "--loominate-space",
    value: "1rem",
    description: "The base spacing; paddings and gaps are multiples of it.",
  },
  {
    name: "--loominate-radius",
    value: "0.375rem",
    description: "The corner radius of buttons and panels.",
  },
  {
    name: "--loominate-color-text",
    value: "light-dark(#1f1d1a, #ece8e1)",
    description: "Prose and other text.",
  },
  {
    name: "--loominate-color-background",
    value: "light-dark(#fbfaf7, #17161a)",
    description: "The page's background.",
  },
  {
    name: "--loominate-color-surface",
    value: "light-dark(#f0ede6, #232228)",
    description: "The background of regions other than main, and of continue buttons.",
  },
  {
    name: "--loominate-color-border",
    value: "light-dark(#d6d1c7, #3d3b43)",
    description: "Borders around regions, buttons, and the drawer.",
  },
  {
    name: "--loominate-color-muted",
    value: "light-dark(#5f5a52, #a9a398)",
    description: "Secondary text: reasons, the drawer, and links that can't be followed.",
  },
  {
    name: "--loominate-color-accent",
    value: "light-dark(#1d5fa8, #8cb9f0)",
    description: "Links and choices.",
  },
  {
    name: "--loominate-color-focus",
    value: "light-dark(#1d5fa8, #8cb9f0)",
    description: "The focus ring on keyboard focus.",
  },
];
