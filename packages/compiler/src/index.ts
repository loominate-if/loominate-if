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
  CompilerExtension,
  DirectiveDefinition,
  ExtensionCheck,
  ExtensionDiagnostic,
  LineFormDefinition,
  RuntimeExport,
  TagRoleDefinition,
} from "./extensions/extension.js";
export { parsePassageFile, type ParseOptions } from "./passages/parse.js";
export type * from "./passages/syntax.js";
export {
  generatePassageModule,
  type GenerateOptions,
  type GeneratedModule,
} from "./modules/generate.js";
export { toSource, type Mapping, type SourceMap } from "./modules/source-map.js";
export {
  compileProject,
  PASSAGE_EXTENSION,
  type CompiledProject,
  type ProjectDiagnostic,
  type ProjectFile,
  type ProjectOptions,
} from "./modules/project.js";
