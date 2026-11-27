/**
 * The `.loom` archive (#151, ADR 0132): a zip whose first entry is its
 * manifest, `manifest.json`, then its Treaty of Babel record,
 * `ifiction.xml`, then the game's files, as a static build writes them.
 */
import { entryData, readZip, writeZip, ZipError, type ZipEntry, type ZipInput } from "./zip.js";

/** What a manifest's `format` says: this is a Loominate IF archive. */
export const ARCHIVE_FORMAT = "loominate-archive";
/** The version of the archive format this package writes and reads. */
export const ARCHIVE_FORMAT_VERSION = 1;
/** The manifest's path, the archive's first entry. */
export const MANIFEST_PATH = "manifest.json";
/** The Treaty of Babel iFiction record's path, the archive's second entry. */
export const IFICTION_PATH = "ifiction.xml";

/** A file in an archive, as its manifest lists it. */
export type ArchiveFileInfo = {
  /** Its path, with `/` between folders, as the game's page names it. */
  readonly path: string;
  /** Its size in bytes. */
  readonly size: number;
  /** Its SHA-256, in lowercase hex. */
  readonly sha256: string;
};

/** What an archive says about its game, given to {@link writeArchive}. */
export type ArchiveDetails = {
  /** The game's IFID, a UUID, which identifies the work across every version of it. */
  readonly ifid: string;
  /** The game's title. */
  readonly title: string;
  /** Who wrote it. */
  readonly author?: string;
  /** The game's ID and version, as its config gives them. */
  readonly game: { readonly id: string; readonly version: string };
  /** The version of Loominate IF it was built with. */
  readonly engine: string;
  /** The page that starts the game, as `index.html`. */
  readonly entry: string;
};

/** An archive's manifest, its first entry. */
export type ArchiveManifest = ArchiveDetails & {
  readonly format: typeof ARCHIVE_FORMAT;
  readonly formatVersion: number;
  /** Every file of the game, in the order stored. */
  readonly files: readonly ArchiveFileInfo[];
};

/** A file to put in an archive. */
export type ArchiveFile = {
  /** Its path, with `/` between folders, as the game's page names it. */
  readonly path: string;
  /** Its contents. */
  readonly data: Uint8Array;
};

/** An archive, opened by {@link readArchive}. */
export type Archive = {
  readonly manifest: ArchiveManifest;
  /** A file's contents, or `undefined` if the archive doesn't have it. */
  read(path: string): Promise<Uint8Array | undefined>;
};

/** Something wrong with an archive: what, for whoever made or opened it. */
export class ArchiveError extends Error {
  /** `"ArchiveError"`. */
  override name = "ArchiveError";
  /** Each problem found, as a sentence: one, unless the manifest has several. */
  readonly problems: readonly string[];
  constructor(problems: string | readonly string[]) {
    const list = typeof problems === "string" ? [problems] : problems;
    super(list.join(" "));
    this.problems = list;
  }
}

const IFID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

/** Whether `text` is an IFID this format takes: a UUID, as `0B3A7F64-8E2C-4D1A-9F6B-2C5E8A1D3F70`. */
export function isIfid(text: string): boolean {
  return IFID.test(text);
}

/** Files whose kinds compress well: text. Media is stored as it is, as the design says. */
const TEXT = /\.(html?|m?js|css|json|map|svg|xml|txt|md|webmanifest)$/i;

/** Why `path` can't be a game file's path, or `undefined` if it can. */
function badPath(path: string): string | undefined {
  if (path === "") return "is empty";
  if (path.startsWith("/")) return "starts with /";
  if (path.includes("\\")) return "has a backslash";
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return "has an empty, `.`, or `..` folder";
  }
  if (path === MANIFEST_PATH || path === IFICTION_PATH) return "is the archive's own";
  return undefined;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A file's SHA-256, in lowercase hex. */
export async function sha256(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const escapeXml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The game's Treaty of Babel iFiction record: its IFID, its format, and
 * its title and author ("Anonymous" if none is given, as the treaty says),
 * for IF archives and catalogs. It has no colophon, whose required
 * `originated` date would make each day's build differ; the manifest says
 * which engine built it.
 */
export function ifictionRecord(details: ArchiveDetails): string {
  const author = details.author ?? "Anonymous";
  return `<?xml version="1.0" encoding="UTF-8"?>
<ifindex version="1.0" xmlns="http://babel.ifarchive.org/protocol/iFiction/">
  <story>
    <identification>
      <ifid>${details.ifid.toUpperCase()}</ifid>
      <format>html</format>
    </identification>
    <bibliographic>
      <title>${escapeXml(details.title)}</title>
      <author>${escapeXml(author)}</author>
    </bibliographic>
  </story>
</ifindex>
`;
}

/**
 * Writes an archive of the game's `files`, as a static build writes them,
 * with its manifest and iFiction record. The same details and files always
 * make the same bytes.
 * @throws ArchiveError if the IFID isn't a UUID, a path can't be used, two
 * files share a path, or there's no entry page.
 */
export async function writeArchive(
  details: ArchiveDetails,
  files: readonly ArchiveFile[],
): Promise<Uint8Array> {
  if (!isIfid(details.ifid)) {
    throw new ArchiveError(`The IFID ${JSON.stringify(details.ifid)} isn't a UUID.`);
  }
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const seen = new Set<string>();
  for (const f of sorted) {
    const bad = badPath(f.path);
    if (bad !== undefined) throw new ArchiveError(`The path ${JSON.stringify(f.path)} ${bad}.`);
    if (seen.has(f.path)) throw new ArchiveError(`Two files have the path ${f.path}.`);
    seen.add(f.path);
  }
  if (!seen.has(details.entry)) {
    throw new ArchiveError(`The entry page, ${details.entry}, isn't among the files.`);
  }
  const normalized: ArchiveDetails = { ...details, ifid: details.ifid.toUpperCase() };
  const manifest: ArchiveManifest = {
    format: ARCHIVE_FORMAT,
    formatVersion: ARCHIVE_FORMAT_VERSION,
    ...normalized,
    files: await Promise.all(
      sorted.map(async (f) => ({
        path: f.path,
        size: f.data.length,
        sha256: await sha256(f.data),
      })),
    ),
  };
  const entries: ZipInput[] = [
    // Stored, so a reader finds it at a known place without inflating anything.
    {
      path: MANIFEST_PATH,
      data: encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`),
      compress: false,
    },
    { path: IFICTION_PATH, data: encoder.encode(ifictionRecord(normalized)), compress: true },
    ...sorted.map((f) => ({ path: f.path, data: f.data, compress: TEXT.test(f.path) })),
  ];
  return writeZip(entries);
}

/** The manifest's problems, if it has any, or the manifest. */
function checkManifest(value: unknown): ArchiveManifest | string[] {
  const problems: string[] = [];
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  const text = (v: unknown): v is string => typeof v === "string" && v !== "";
  if (!isRecord(value)) return ["The manifest isn't a JSON object."];
  if (value.format !== ARCHIVE_FORMAT) {
    return [
      `The manifest's format isn't ${JSON.stringify(ARCHIVE_FORMAT)}: it isn't a Loominate IF archive.`,
    ];
  }
  if (value.formatVersion !== ARCHIVE_FORMAT_VERSION) {
    return [
      `The archive is format version ${JSON.stringify(value.formatVersion)}, and this version of Loominate IF reads version ${String(ARCHIVE_FORMAT_VERSION)}.`,
    ];
  }
  if (!text(value.ifid) || !isIfid(value.ifid)) problems.push("The manifest's ifid isn't a UUID.");
  if (!text(value.title)) problems.push("The manifest has no title.");
  if (value.author !== undefined && typeof value.author !== "string") {
    problems.push("The manifest's author isn't text.");
  }
  if (!isRecord(value.game) || !text(value.game.id) || !text(value.game.version)) {
    problems.push("The manifest's game needs an id and a version.");
  }
  if (!text(value.engine)) problems.push("The manifest doesn't say which engine version built it.");
  if (!text(value.entry)) problems.push("The manifest has no entry page.");
  const files = value.files;
  if (
    !Array.isArray(files) ||
    !files.every(
      (f) =>
        isRecord(f) &&
        text(f.path) &&
        Number.isInteger(f.size) &&
        typeof f.sha256 === "string" &&
        /^[0-9a-f]{64}$/.test(f.sha256),
    )
  ) {
    problems.push("The manifest's files must each have a path, a size, and a SHA-256.");
  }
  return problems.length > 0 ? problems : (value as ArchiveManifest);
}

/** The zip's entries and the manifest, or the archive's first problem. */
async function open(
  bytes: Uint8Array,
): Promise<{ entries: Map<string, ZipEntry>; order: ZipEntry[]; manifest: ArchiveManifest }> {
  let order: ZipEntry[];
  try {
    order = readZip(bytes);
  } catch (e) {
    if (e instanceof ZipError) throw new ArchiveError(`The archive is damaged: ${e.message}`);
    throw e;
  }
  const first = order[0];
  if (first?.path !== MANIFEST_PATH) {
    throw new ArchiveError(`The archive's first entry isn't ${MANIFEST_PATH}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(await entryData(bytes, first)));
  } catch (e) {
    if (e instanceof ZipError) throw new ArchiveError(`The archive is damaged: ${e.message}`);
    throw new ArchiveError(`The archive's ${MANIFEST_PATH} isn't JSON.`);
  }
  const manifest = checkManifest(parsed);
  if (Array.isArray(manifest)) throw new ArchiveError(manifest);
  const entries = new Map<string, ZipEntry>();
  for (const e of order) {
    if (entries.has(e.path)) throw new ArchiveError(`The archive has ${e.path} twice.`);
    entries.set(e.path, e);
  }
  return { entries, order, manifest };
}

/**
 * Opens an archive: its manifest, and its files, read as they're asked for.
 * @throws ArchiveError if it isn't an archive, or its manifest is invalid.
 */
export async function readArchive(bytes: Uint8Array): Promise<Archive> {
  const { entries, manifest } = await open(bytes);
  const listed = new Set(manifest.files.map((f) => f.path));
  return {
    manifest,
    async read(path) {
      const entry = listed.has(path) ? entries.get(path) : undefined;
      if (!entry) return undefined;
      try {
        return await entryData(bytes, entry);
      } catch (e) {
        if (e instanceof ZipError) throw new ArchiveError(`The archive is damaged: ${e.message}`);
        throw e;
      }
    },
  };
}

/**
 * Everything wrong with an archive, or nothing: its layout, manifest,
 * iFiction record, and every file against the manifest's size and SHA-256.
 */
export async function validateArchive(bytes: Uint8Array): Promise<string[]> {
  let opened: Awaited<ReturnType<typeof open>>;
  try {
    opened = await open(bytes);
  } catch (e) {
    // The archive can't be opened: its layout's problem, or every one of its manifest's.
    if (e instanceof ArchiveError) return [...e.problems];
    throw e;
  }
  const { entries, order, manifest } = opened;
  const problems: string[] = [];
  if (order[0]?.method !== 0) problems.push(`${MANIFEST_PATH} is compressed; it must be stored.`);
  // The iFiction record, second, naming the same IFID.
  const record = entries.get(IFICTION_PATH);
  if (order[1]?.path !== IFICTION_PATH || !record) {
    problems.push(`The archive's second entry isn't ${IFICTION_PATH}.`);
  }
  if (record) {
    try {
      const xml = decoder.decode(await entryData(bytes, record));
      const ifid = /<ifid>\s*([^<]*?)\s*<\/ifid>/.exec(xml)?.[1];
      if (ifid?.toUpperCase() !== manifest.ifid.toUpperCase()) {
        problems.push(`${IFICTION_PATH}'s IFID isn't the manifest's, ${manifest.ifid}.`);
      }
    } catch (e) {
      if (!(e instanceof ZipError)) throw e;
      problems.push(e.message);
    }
  }
  const listed = new Set<string>();
  for (const file of manifest.files) {
    const bad = badPath(file.path);
    if (bad !== undefined)
      problems.push(`The manifest lists ${JSON.stringify(file.path)}, which ${bad}.`);
    if (listed.has(file.path)) problems.push(`The manifest lists ${file.path} twice.`);
    listed.add(file.path);
    const entry = entries.get(file.path);
    if (!entry) {
      problems.push(`${file.path} is in the manifest but not in the archive.`);
      continue;
    }
    try {
      const data = await entryData(bytes, entry);
      if (data.length !== file.size || (await sha256(data)) !== file.sha256) {
        problems.push(`${file.path} doesn't match the manifest's size and SHA-256.`);
      }
    } catch (e) {
      if (!(e instanceof ZipError)) throw e;
      problems.push(e.message);
    }
  }
  if (!listed.has(manifest.entry)) {
    problems.push(`The entry page, ${manifest.entry}, isn't among the manifest's files.`);
  }
  for (const e of order) {
    if (e.path !== MANIFEST_PATH && e.path !== IFICTION_PATH && !listed.has(e.path)) {
      problems.push(`${e.path} is in the archive but not in the manifest.`);
    }
  }
  return problems;
}
