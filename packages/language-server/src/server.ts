/**
 * The language server (#148, ADR 0118), for any editor that speaks LSP:
 * the compiler's diagnostics for passage files, and TypeScript's
 * completion, hover, and go-to-definition inside their inline code, through
 * Volar.js. Each game is found by its `loominate.config.ts` and loaded with
 * the CLI's `loadConfig`, so its extensions are the ones it builds with.
 */
import { fileURLToPath } from "node:url";
import type { LanguageServicePlugin } from "@volar/language-server";
import {
  createConnection,
  createServer,
  createTypeScriptProject,
} from "@volar/language-server/node.js";
import ts from "typescript";
import {
  createConnection as connectionOver,
  ProposedFeatures,
} from "vscode-languageserver/node.js";
import { create as createTypeScriptServices } from "volar-service-typescript";
import { URI } from "vscode-uri";
import { compilerDiagnostics } from "./diagnostics.js";
import { findGameRoot, loadGame, type Game } from "./game.js";
import { weftLanguagePlugin } from "./language.js";
import { passageFeatures } from "./passages.js";

/**
 * Names the compiler's generated modules declare for themselves: its
 * `$`-prefixed helpers and the module's own `passages`. They're not the
 * author's to write, so TypeScript's completions leave them out (#410).
 */
const INTERNAL = /^(\$|passages$)/;

/** A TypeScript service plugin whose completions leave out the generated modules' internals. */
function withoutInternals(plugin: LanguageServicePlugin): LanguageServicePlugin {
  return {
    ...plugin,
    create(context) {
      const instance = plugin.create(context);
      const provide = instance.provideCompletionItems?.bind(instance);
      if (!provide) return instance;
      return {
        ...instance,
        async provideCompletionItems(document, position, completion, token) {
          const list = await provide(document, position, completion, token);
          if (!list || !document.uri.startsWith("volar-embedded-content:")) return list;
          return { ...list, items: list.items.filter((i) => !INTERNAL.test(i.label)) };
        },
      };
    },
  };
}

/** Options for {@link startLanguageServer}. */
export type LanguageServerOptions = {
  /** Package export conditions for loading games' configs and extensions, as `source` in this repository's tests. */
  readonly conditions?: readonly string[];
  /**
   * Streams to talk over, in place of stdin and stdout, as for running the
   * server in the same process as a test.
   */
  readonly streams?: {
    readonly input: NodeJS.ReadableStream;
    readonly output: NodeJS.WritableStream;
  };
};

/**
 * Starts the language server on the process's stdin and stdout, as
 * `loominate-language-server --stdio` does, for an editor to talk to.
 */
export function startLanguageServer(options: LanguageServerOptions = {}): void {
  const connection = options.streams
    ? connectionOver(ProposedFeatures.all, options.streams.input, options.streams.output)
    : createConnection();
  const server = createServer(connection);
  /** Loaded games, by root. */
  const games = new Map<string, Game>();
  const gameFor = (file: string): Game | undefined => {
    const root = findGameRoot(file);
    return root === undefined ? undefined : games.get(root);
  };
  const fileOf = (uri: URI): string =>
    uri.scheme === "file" ? fileURLToPath(uri.toString()) : uri.path;

  connection.onInitialize((params) =>
    server.initialize(
      params,
      createTypeScriptProject(ts, undefined, async (context) => {
        // The game this project's files belong to, loaded before any of them is read.
        const from = context.configFileName ?? server.workspaceFolders.all[0]?.fsPath;
        const root = from === undefined ? undefined : findGameRoot(from);
        if (root !== undefined && !games.has(root)) {
          try {
            games.set(
              root,
              await loadGame(root, options.conditions ? { conditions: options.conditions } : {}),
            );
          } catch (error) {
            connection.console.error(
              `loominate: couldn't load the game at ${root}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        return { languagePlugins: [weftLanguagePlugin(gameFor, fileOf)] };
      }),
      [
        ...createTypeScriptServices(ts).map(withoutInternals),
        compilerDiagnostics(gameFor, fileOf, (u) => URI.parse(u)),
        passageFeatures(gameFor, fileOf, (u) => URI.parse(u)),
      ],
    ),
  );
  connection.onInitialized(() => {
    server.initialized();
  });
  connection.onShutdown(() => {
    server.shutdown();
  });
  connection.listen();
}
