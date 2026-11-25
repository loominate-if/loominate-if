/**
 * The language plugin (#148, ADR 0118): each passage file is a virtual
 * code whose embedded TypeScript is the compiler's generated module, mapped
 * back by the compiler's own mappings, so TypeScript's completion, hover,
 * and go-to-definition work inside inline code. TypeScript's own checks of
 * the generated code are off: the compiler reports every problem itself,
 * at the author's line.
 */
import type {
  CodeInformation,
  CodeMapping,
  LanguagePlugin,
  VirtualCode,
} from "@volar/language-server";
import type * as ts from "typescript";
// Its `typescript` options on language plugins.
import type {} from "@volar/typescript";
import type { URI } from "vscode-uri";
import type { Game } from "./game.js";

/** What passage files' mapped code supports: everything but TypeScript's own diagnostics. */
const MAPPED: CodeInformation = {
  completion: true,
  navigation: true,
  semantic: true,
  verification: false,
  structure: false,
  format: false,
};

/** A snapshot of text, for Volar. */
const snapshotOf = (text: string): ts.IScriptSnapshot => ({
  getText: (start, end) => text.slice(start, end),
  getLength: () => text.length,
  getChangeRange: () => undefined,
});

/** A passage file's virtual code: the file itself, and its generated module embedded as TypeScript. */
function virtualCode(
  snapshot: ts.IScriptSnapshot,
  game: Game | undefined,
  file: string,
): VirtualCode {
  const text = snapshot.getText(0, snapshot.getLength());
  const root: VirtualCode = {
    id: "root",
    languageId: "weft",
    snapshot,
    mappings: [
      {
        sourceOffsets: [0],
        generatedOffsets: [0],
        lengths: [text.length],
        data: { ...MAPPED, verification: true, structure: true, format: true },
      },
    ],
    embeddedCodes: [],
  };
  if (!game) return root;
  game.session.update(file, text);
  const module = game.session.module(file);
  if (!module) return root;
  const mappings: CodeMapping[] = module.mappings
    .filter((m) => m.length > 0)
    .map((m) => ({
      sourceOffsets: [m.source],
      generatedOffsets: [m.generated],
      lengths: [m.length],
      data: MAPPED,
    }));
  root.embeddedCodes = [
    { id: "ts", languageId: "typescript", snapshot: snapshotOf(module.code), mappings },
  ];
  return root;
}

/** The language plugin for passage files, for the game `gameFor` finds for a file, if any. */
export function weftLanguagePlugin(
  gameFor: (file: string) => Game | undefined,
  fileOf: (uri: URI) => string,
): LanguagePlugin<URI> {
  return {
    getLanguageId: (uri) => (uri.path.endsWith(".weft") ? "weft" : undefined),
    createVirtualCode: (uri, languageId, snapshot) =>
      languageId === "weft" ? virtualCode(snapshot, gameFor(fileOf(uri)), fileOf(uri)) : undefined,
    updateVirtualCode: (uri, _code, snapshot) =>
      virtualCode(snapshot, gameFor(fileOf(uri)), fileOf(uri)),
    typescript: {
      extraFileExtensions: [{ extension: "weft", isMixedContent: true, scriptKind: 7 }],
      getServiceScript(root) {
        const code = root.embeddedCodes?.find((c) => c.languageId === "typescript");
        return code ? { code, extension: ".ts", scriptKind: 3 } : undefined;
      },
      // The compiler's passage-names module isn't given: only the generated code's types use it,
      // and the compiler checks passage names itself.
    },
  };
}
