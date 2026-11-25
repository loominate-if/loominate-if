/**
 * A game, as the language server sees it (#148): its config, found by
 * walking up from a file to `loominate.config.ts`, and a compiler session
 * over its files, kept up to date as the author edits.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { CONFIG_FILE, gameFiles, loadConfig, type ResolvedConfig } from "@loominate-if/cli";
import { createCompilerSession, type CompilerSession } from "@loominate-if/compiler";

/** A game the server has loaded. */
export type Game = {
  /** Its root, where `loominate.config.ts` is. */
  readonly root: string;
  readonly config: ResolvedConfig;
  readonly session: CompilerSession;
  /** Updates a passage file from the editor, as it's edited. */
  update(file: string, text: string): void;
  /** A file's text, as the session last had it, or `""` if it isn't one of the game's. */
  text(file: string): string;
  /** Reads the game's TypeScript files again, those that changed on disk, as on save. */
  refresh(): void;
};

/** The folder holding `loominate.config.ts`, from `from` up, if there is one. */
export function findGameRoot(from: string): string | undefined {
  let dir = existsSync(from) && statSync(from).isDirectory() ? from : path.dirname(from);
  for (;;) {
    if (existsSync(path.join(dir, CONFIG_FILE))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
}

/** Loads the game at `root`: its config and extensions, and a compiler session over its files. */
export async function loadGame(
  root: string,
  options: { readonly conditions?: readonly string[] } = {},
): Promise<Game> {
  const config = await loadConfig(root, {
    ...(options.conditions && { conditions: options.conditions }),
  });
  const files = gameFiles(root);
  const session = createCompilerSession({
    root,
    files,
    start: config.start,
    extensions: config.loaded,
    ...(config.scope !== undefined && { scope: config.scope }),
    ...(options.conditions && {
      compilerOptions: { customConditions: [...options.conditions] },
    }),
    ambient: ["@loominate-if/presentation"],
  });
  const onDisk = new Map(files.map((f) => [f.path, f.text]));
  return {
    root,
    config,
    session,
    update(file, text) {
      if (onDisk.get(file) === text) return;
      onDisk.set(file, text);
      session.update(file, text);
    },
    text: (file) => onDisk.get(file) ?? "",
    refresh() {
      // Passage files come from the editor, as they're edited; TypeScript from disk, as it's saved.
      for (const file of [...onDisk.keys()].filter((f) => /\.(m|c)?tsx?$/.test(f))) {
        try {
          const text = readFileSync(file, "utf8");
          if (onDisk.get(file) === text) continue;
          onDisk.set(file, text);
          session.update(file, text);
        } catch {
          // Gone, or unreadable: the session keeps what it had.
        }
      }
    },
  };
}
