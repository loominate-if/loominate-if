/**
 * @packageDocumentation
 * Presentation: layouts, regions, widgets, themes, beats, effects, audio, accessibility.
 */
export {
  mountPage,
  type ActionMove,
  type Page,
  type PageGame,
  type PageOptions,
} from "./page/page.js";
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
export {
  playGame,
  type Player,
  type PlayedReplay,
  type PlayHistory,
  type PlayOptions,
} from "./saves/play.js";
export {
  addToHeader,
  thingsWidget,
  type ListedThing,
  type ThingsWidgetOptions,
} from "./page/things.js";
export { textWidget, type TextWidgetOptions } from "./page/text.js";
