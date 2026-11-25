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
  type PassagePlacement,
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
export type { SeedSetting } from "./saves/seed.js";
export {
  addToHeader,
  menuWidget,
  thingsWidget,
  type ListedThing,
  type MenuWidgetOptions,
  type ThingsWidgetOptions,
} from "./page/things.js";
export { type MenuChoice, type MenuSource } from "./page/menus.js";
export { textWidget, type TextWidgetOptions } from "./page/text.js";
export {
  compassWidget,
  type CompassData,
  type CompassOptions,
  type CompassWay,
} from "./page/compass.js";
export {
  _actionListOf,
  actionListWidget,
  castWidget,
  type ActionListData,
  type ActionListItem,
  type ActionListOptions,
  type CastData,
  type CastMember,
  type CastOptions,
} from "./page/conversation.js";
export {
  nameSpeakers,
  storyLog,
  transcript,
  transcriptText,
  type LogEntry,
  type TranscriptLine,
} from "./page/log.js";
export {
  exportStoryLog,
  type ExportedFile,
  type ExportFormat,
  type ExportOptions,
} from "./page/export.js";
export {
  commandSources,
  matchCommands,
  type Command,
  type CommandMatch,
  type CommandSource,
} from "./page/command.js";
