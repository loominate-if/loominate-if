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
  widget,
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
export {
  effects,
  type EffectPlayContext,
  type EffectDefinition,
  type EffectFinish,
} from "./page/effects.js";
export { createBrowserStorage, type BrowserStorageOptions } from "./saves/storage.js";
export { playGame, type Player, type PlayHistory, type PlayOptions } from "./saves/play.js";
