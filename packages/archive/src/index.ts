/**
 * @packageDocumentation
 * The `.loom` archive format (ADR 0132): a game's static build in one zip,
 * with a manifest first and a Treaty of Babel record, for IF archives,
 * offline sharing, and players. `loominate build --target archive` writes
 * one, and `loominate validate` checks one.
 */
export {
  ARCHIVE_FORMAT,
  ARCHIVE_FORMAT_VERSION,
  ArchiveError,
  IFICTION_PATH,
  ifictionRecord,
  isIfid,
  MANIFEST_PATH,
  readArchive,
  validateArchive,
  writeArchive,
  type Archive,
  type ArchiveDetails,
  type ArchiveFile,
  type ArchiveFileInfo,
  type ArchiveManifest,
} from "./archive.js";
