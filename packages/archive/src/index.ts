/**
 * @packageDocumentation
 * The `.loom` archive format (ADR 0132): a game's static build in one zip,
 * with a manifest first and a Treaty of Babel record, for IF archives,
 * offline sharing, and players. `loominate build --target archive` writes
 * one, and `loominate validate` checks one. In a browser, a service worker
 * plays a game from its archive (ADR 0133): {@link serveArchives} in the
 * worker, and {@link mountArchiveLoader} on the page that opens archives;
 * `loominate play` serves both.
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
export { mountArchiveLoader, storeArchive, type LoaderOptions } from "./loader.js";
export { archiveResponse, contentType, type ArchiveRequest } from "./serve.js";
export {
  ARCHIVES_CACHE,
  archiveKey,
  GAMES_PATH,
  gameUrl,
  PLAYER_CACHE,
  serveArchives,
  type ArchiveWorkerScope,
  type WorkerEvent,
  type WorkerFetchEvent,
} from "./worker.js";
