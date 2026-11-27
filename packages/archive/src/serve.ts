/**
 * A game's files served from its archive (#152, ADR 0133): the responses the
 * service worker gives the game's page for its ordinary relative paths.
 */
import type { Archive } from "./archive.js";

const TYPES: Readonly<Record<string, string>> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  opus: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
};

/** The media type a file is served with, from its extension. */
export function contentType(path: string): string {
  const ext = /\.([^./]+)$/.exec(path)?.[1]?.toLowerCase();
  return (ext !== undefined && TYPES[ext]) || "application/octet-stream";
}

/** What {@link archiveResponse} reads of the request, as a `Request` has it. */
export type ArchiveRequest = {
  readonly method: string;
  readonly headers: { get(name: string): string | null };
};

const text = (status: number, message: string): Response =>
  new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

/**
 * The response for one of a game's files: `path` is relative to the game's
 * folder, as its page names it, with `""` its entry page. A `Range` request
 * gets that part, as media elements ask for.
 */
export async function archiveResponse(
  archive: Archive,
  path: string,
  request: ArchiveRequest = { method: "GET", headers: { get: () => null } },
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return text(405, `${request.method} isn't allowed: an archive's files can only be read.`);
  }
  let file: string;
  try {
    file = path === "" ? archive.manifest.entry : decodeURIComponent(path);
  } catch {
    return text(400, `The path ${path} isn't a file's name.`);
  }
  const data = await archive.read(file);
  if (!data) return text(404, `${file} isn't in the archive of ${archive.manifest.title}.`);
  const headers: Record<string, string> = {
    "Content-Type": contentType(file),
    "Accept-Ranges": "bytes",
    // Same file, same bytes: the archive's own SHA-256.
    ETag: `"${archive.manifest.files.find((f) => f.path === file)?.sha256 ?? ""}"`,
  };
  const body = (part: Uint8Array): BodyInit | null =>
    request.method === "HEAD" ? null : new Uint8Array(part);
  const range = request.headers.get("Range");
  if (range !== null) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    const size = data.length;
    let start = match?.[1] === "" ? NaN : Number(match?.[1]);
    let end = match?.[2] === "" ? size - 1 : Number(match?.[2]);
    if (match && match[1] === "" && match[2] !== "") {
      // The last n bytes.
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (!match || Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(body(data.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${String(start)}-${String(end)}/${String(size)}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  return new Response(body(data), {
    status: 200,
    headers: { ...headers, "Content-Length": String(data.length) },
  });
}
