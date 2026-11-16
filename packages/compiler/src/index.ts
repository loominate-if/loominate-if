/**
 * @packageDocumentation
 * Compiler: passage parser, virtual TypeScript modules, stable line IDs, diagnostics, extension API.
 */
export { coreDirectives, type DirectiveSpec } from "./passages/directives.js";
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
