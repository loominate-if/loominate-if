/**
 * @packageDocumentation
 * Compiler: passage parser, virtual TypeScript modules, stable line IDs, diagnostics, extension API.
 */
export type { DirectiveSpec, LineFormSpec } from "./passages/directives.js";
export { coreExtension } from "./extensions/core.js";
export type {
  ArgumentKind,
  ArgumentSpec,
  CheckContext,
  NameUse,
  CompilerExtension,
  DirectiveDefinition,
  ExtensionCheck,
  ExtensionDiagnostic,
  LineFormDefinition,
  MessageParameterDeclaration,
  RuntimeExport,
  TagRoleDefinition,
} from "./extensions/extension.js";
export { parsePassageFile, type ParseOptions } from "./passages/parse.js";
export { passageTargets } from "./modules/links.js";
export type {
  StoryMap,
  StoryMapEdge,
  StoryMapNode,
  StoryMapSource,
  StoryMapView,
} from "./map/story-map.js";
export type * from "./passages/syntax.js";
export {
  generatePassageModule,
  type GenerateOptions,
  type GeneratedModule,
} from "./modules/generate.js";
export { toSource, type Mapping, type SourceMap } from "./modules/source-map.js";
export {
  compileProject,
  shownDiagnostics,
  createCompilerSession,
  type CompilerSession,
  type SessionSyntax,
  type SessionChange,
  PASSAGE_EXTENSION,
  type CompiledProject,
  type ProjectDiagnostic,
  type ShownDiagnostics,
  type ProjectFile,
  type ProjectOptions,
} from "./modules/project.js";
