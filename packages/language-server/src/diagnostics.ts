/**
 * Diagnostics (#148): the compiler's own, for each passage file, at the
 * author's lines: parser, compiler, TypeScript, and packages' checks, as
 * the dev server reports them.
 */
import type { LanguageServicePlugin } from "@volar/language-server";
import type { URI } from "vscode-uri";
import type { Game } from "./game.js";

/** LSP's severities. */
const ERROR = 1;
const WARNING = 2;

/** The plugin giving passage files the compiler's diagnostics. */
export function compilerDiagnostics(
  gameFor: (file: string) => Game | undefined,
  fileOf: (uri: URI) => string,
  parse: (uri: string) => URI,
): LanguageServicePlugin {
  return {
    name: "loominate-diagnostics",
    capabilities: {
      diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: false },
    },
    create(context) {
      return {
        provideDiagnostics(document) {
          if (document.languageId !== "weft") return undefined;
          // The document is the passage file's root virtual code; its own URI is the file's.
          const uri = parse(document.uri);
          const file = fileOf(context.decodeEmbeddedDocumentUri(uri)?.[0] ?? uri);
          const game = gameFor(file);
          if (!game) return [];
          // TypeScript files edited elsewhere are read again as they're saved.
          game.refresh();
          return game.session
            .diagnostics()
            .filter((d) => d.file === file && d.followOn !== true)
            .map((d) => ({
              range: {
                start: document.positionAt(d.span.start),
                end: document.positionAt(Math.max(d.span.end, d.span.start + 1)),
              },
              severity: d.severity === "error" ? ERROR : WARNING,
              source: "loominate",
              message: d.message,
            }));
        },
      };
    },
  };
}
