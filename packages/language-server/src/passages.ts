/**
 * Passage-aware features (#410, ADR 0118): in passage files, completion of
 * passage names after `[[` and `->`, of directives after `{`, and of tag
 * roles in a passage's header; go-to-definition and find-references for
 * passage names, across the game's passage files.
 */
import { passageTargets, type NameSyntax } from "@loominate-if/compiler";
import type { LanguageServicePlugin } from "@volar/language-server";
import { pathToFileURL } from "node:url";
import type { URI } from "vscode-uri";
import type { Game } from "./game.js";

/** LSP's completion item kinds used here. */
const KIND = { reference: 18, keyword: 14, property: 10 } as const;

/** Where a passage name is: its file, and its span there. */
type Place = { readonly file: string; readonly name: NameSyntax };

/** Every passage's header and every link to one, across the game's passage files. */
function passagesOf(game: Game): { readonly headers: Place[]; readonly targets: Place[] } {
  const headers: Place[] = [];
  const targets: Place[] = [];
  for (const file of game.session.modules().keys()) {
    const parsed = game.session.parsed(file);
    if (!parsed) continue;
    for (const p of parsed.passages) {
      if (p.name.name !== "") headers.push({ file, name: p.name });
      for (const t of passageTargets(p.content)) targets.push({ file, name: t });
    }
  }
  return { headers, targets };
}

/** The passage name at `offset` in `file`, a header's or a link's, if there is one. */
function nameAt(game: Game, file: string, offset: number): string | undefined {
  const { headers, targets } = passagesOf(game);
  return [...headers, ...targets].find(
    (p) => p.file === file && p.name.span.start <= offset && offset <= p.name.span.end,
  )?.name.name;
}

/** The plugin giving passage files passage-aware completion and navigation. */
export function passageFeatures(
  gameFor: (file: string) => Game | undefined,
  fileOf: (uri: URI) => string,
  parse: (uri: string) => URI,
): LanguageServicePlugin {
  return {
    name: "loominate-passages",
    capabilities: {
      completionProvider: { triggerCharacters: ["[", ">", "{", " "] },
      definitionProvider: true,
      referencesProvider: true,
    },
    create(context) {
      const where = (documentUri: string) => {
        const uri = parse(documentUri);
        const file = fileOf(context.decodeEmbeddedDocumentUri(uri)?.[0] ?? uri);
        return { file, game: gameFor(file) };
      };
      return {
        provideCompletionItems(document, position) {
          if (document.languageId !== "weft") return undefined;
          const { game } = where(document.uri);
          if (!game) return undefined;
          const line = document.getText({
            start: { line: position.line, character: 0 },
            end: position,
          });
          const range = (typed: string) => ({
            start: { line: position.line, character: position.character - typed.length },
            end: position,
          });
          // After `->`, or right after `[[`: a passage name.
          const target = /(?:->\s*|\[\[)([^\]|{}]*)$/.exec(line);
          if (target) {
            const typed = target[1] ?? "";
            const names = [...new Set(passagesOf(game).headers.map((h) => h.name.name))].sort();
            return {
              isIncomplete: false,
              items: names.map((name) => ({
                label: name,
                kind: KIND.reference,
                detail: "passage",
                textEdit: { range: range(typed.trimStart()), newText: name },
              })),
            };
          }
          // In a header's tags: a tag role.
          const header = /^::[^[]*\[([^\]]*)$/.exec(line);
          if (header) {
            const typed = /([\w-]*)$/.exec(header[1] ?? "")?.[1] ?? "";
            return {
              isIncomplete: false,
              items: game.session.syntax().tagRoles.map((r) => ({
                label: r.name,
                kind: KIND.property,
                detail: `tag role, from ${r.from}`,
                textEdit: { range: range(typed), newText: `${r.name}: ` },
              })),
            };
          }
          // Right after `{`, before anything but words: a directive.
          const directive = /\{([a-z][a-z ]*)?$/.exec(line);
          if (directive) {
            const typed = directive[1] ?? "";
            const seen = new Set<string>();
            const items = game.session.syntax().directives.flatMap((d) => {
              if (seen.has(d.name)) return [];
              seen.add(d.name);
              return [
                {
                  label: d.name,
                  kind: KIND.keyword,
                  detail: `${d.kind} directive, from ${d.from}`,
                  ...(d.example !== undefined && {
                    documentation: { kind: "markdown" as const, value: `\`${d.example}\`` },
                  }),
                  textEdit: { range: range(typed), newText: d.name },
                },
              ];
            });
            return { isIncomplete: false, items };
          }
          return undefined;
        },
        provideDefinition(document, position) {
          if (document.languageId !== "weft") return undefined;
          const { file, game } = where(document.uri);
          if (!game) return undefined;
          const name = nameAt(game, file, document.offsetAt(position));
          if (name === undefined) return undefined;
          return passagesOf(game)
            .headers.filter((h) => h.name.name === name)
            .map((h) => toLink(game, h));
        },
        provideReferences(document, position) {
          if (document.languageId !== "weft") return undefined;
          const { file, game } = where(document.uri);
          if (!game) return undefined;
          const name = nameAt(game, file, document.offsetAt(position));
          if (name === undefined) return undefined;
          const { headers, targets } = passagesOf(game);
          return [...headers, ...targets]
            .filter((p) => p.name.name === name)
            .map((p) => {
              const l = toLink(game, p);
              return { uri: l.targetUri, range: l.targetRange };
            });
        },
      };
    },
  };
}

/** A location link to `place`, in its file, with its range in lines and characters. */
function toLink(game: Game, place: Place) {
  const text = game.text(place.file);
  const span = place.name.span;
  const position = (offset: number) => {
    const before = text.slice(0, offset).split("\n");
    return { line: before.length - 1, character: (before.at(-1) ?? "").length };
  };
  const range = { start: position(span.start), end: position(span.end) };
  return {
    targetUri: pathToFileURL(place.file).href,
    targetRange: range,
    targetSelectionRange: range,
  };
}
