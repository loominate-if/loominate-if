/**
 * @packageDocumentation
 * Presentation: layouts, regions, widgets, themes, beats, effects, audio, accessibility.
 */
export { mountPage, type Page, type PageGame, type PageOptions } from "./page/page.js";
export {
  display,
  layouts,
  statusLine,
  statusLineView,
  widgets,
  type LayoutDefinition,
  type MountedWidget,
  type StatusLineData,
  type StatusLineOptions,
  type WidgetDefinition,
  type WidgetHost,
  type WidgetView,
} from "./page/layout.js";
export { themeTokens, type ThemeToken } from "./page/tokens.js";
