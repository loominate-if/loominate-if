/**
 * The archive build target and `loominate validate` (#151, ADR 0132): the
 * static site, packed into `dist/<game id>.loom` with its manifest and
 * Treaty of Babel record, and checking an archive someone has.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { validateArchive, writeArchive, type ArchiveFile } from "@loominate-if/archive";
import { build as viteBuild, mergeConfig, type InlineConfig } from "vite";
import { CONFIG_FILE, type ResolvedConfig } from "./config/config.js";

/** The version of Loominate IF building the game: this package's, which the others share. */
function engineVersion(): string {
  return (createRequire(import.meta.url)("../package.json") as { version: string }).version;
}

/** Every file under `dir`, by its path from it, with `/` between folders. */
function filesIn(dir: string): ArchiveFile[] {
  const out: ArchiveFile[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        out.push({
          path: path.relative(dir, full).split(path.sep).join("/"),
          data: readFileSync(full),
        });
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * Builds the static site in a folder of its own, then packs it into
 * `dist/<game id>.loom`, leaving anything else in `dist/` alone.
 * @returns The archive's path.
 * @throws Error if the config has no IFID, or the game has errors.
 */
export async function buildArchive(config: ResolvedConfig, base: InlineConfig): Promise<string> {
  const ifid = config.game.ifid;
  if (ifid === undefined) {
    throw new Error(
      `An archive needs the game's IFID, which identifies it to IF archives and catalogs. Add one to \`game\` in ${CONFIG_FILE}, like \`ifid: "${randomUUID().toUpperCase()}"\`, a new one, and keep it for every version of the game.`,
    );
  }
  const site = mkdtempSync(path.join(os.tmpdir(), "loominate-archive-"));
  try {
    await viteBuild(mergeConfig(base, { build: { outDir: site, emptyOutDir: true } }));
    const bytes = await writeArchive(
      {
        ifid,
        title: config.title ?? config.game.id,
        ...(config.author !== undefined && { author: config.author }),
        game: { id: config.game.id, version: config.game.version },
        engine: engineVersion(),
        entry: "index.html",
      },
      filesIn(site),
    );
    const out = path.join(config.root, "dist", `${config.game.id}.loom`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    return out;
  } finally {
    rmSync(site, { recursive: true, force: true });
  }
}

/**
 * What's wrong with the `.loom` archive at `file`: its layout, manifest,
 * iFiction record, and each file against the manifest. Empty if nothing is.
 * @throws Error if the file can't be read.
 */
export async function validate(file: string): Promise<string[]> {
  return validateArchive(readFileSync(file));
}
