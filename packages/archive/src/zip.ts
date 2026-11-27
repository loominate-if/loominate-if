/**
 * The zip container under a `.loom` archive (ADR 0132): entries stored or
 * deflated, written in a fixed order with a fixed date, so the same files
 * always make the same archive. Written with the web platform's own
 * streams, so it reads in a browser as in Node.
 */

/** A file to put in a zip. */
export type ZipInput = {
  /** Its path in the zip, with `/` between folders. */
  readonly path: string;
  readonly data: Uint8Array;
  /** Deflate it, if that makes it smaller. Otherwise it's stored as it is. */
  readonly compress: boolean;
};

/** An entry of a zip, as its central directory and local header describe it. */
export type ZipEntry = {
  readonly path: string;
  /** 0, stored, or 8, deflated. */
  readonly method: number;
  readonly crc: number;
  readonly size: number;
  readonly compressedSize: number;
  /** Where its local header starts. */
  readonly headerOffset: number;
  /** Where its data starts, after the local header. */
  readonly dataOffset: number;
};

/** Something wrong with a zip's structure. */
export class ZipError extends Error {
  override name = "ZipError";
}

const STORED = 0;
const DEFLATED = 8;
/** 1980-01-01, the earliest date zip holds: every entry has it, so builds are reproducible. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** Bit 11: names are UTF-8. */
const UTF8 = 0x0800;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32, as zip records for each entry. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function through(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const pair = stream as unknown as TransformStream<Uint8Array, Uint8Array>;
  const writer = pair.writable.getWriter();
  // Written while it's read, so a large file doesn't wait on backpressure; a
  // failure shows up in the reading.
  writer.write(data).catch(() => undefined);
  writer.close().catch(() => undefined);
  const reader = pair.readable.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Raw deflate, as zip's method 8 holds it. */
export function deflate(data: Uint8Array): Promise<Uint8Array> {
  return through(data, new CompressionStream("deflate-raw"));
}

/** Undoes {@link deflate}. */
export function inflate(data: Uint8Array): Promise<Uint8Array> {
  return through(data, new DecompressionStream("deflate-raw"));
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** A zip of `files`, in the order given. */
export async function writeZip(files: readonly ZipInput[]): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const crc = crc32(file.data);
    const size = file.data.length;
    let body = file.data;
    let method = STORED;
    if (file.compress && size > 0) {
      const deflated = await deflate(file.data);
      if (deflated.length < size) {
        body = deflated;
        method = DEFLATED;
      }
    }
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed: 2.0
    local.setUint16(6, UTF8, true);
    local.setUint16(8, method, true);
    local.setUint16(10, 0, true); // time: midnight
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    parts.push(new Uint8Array(local.buffer), name, body);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); // central directory header
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, UTF8, true);
    entry.setUint16(10, method, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, DOS_DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, body.length, true);
    entry.setUint32(24, size, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * The entries of a zip, in the order its central directory lists them.
 * @throws ZipError if it isn't a zip this format allows: one disk, no zip64,
 * no encryption, entries stored or deflated.
 */
export function readZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is the last 22 bytes, plus a comment of up to 64 KiB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError("it isn't a zip file: there's no end of central directory.");
  const count = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 8, true) !== count) {
    throw new ZipError("it spans more than one disk.");
  }
  if (count === 0xffff || centralOffset === 0xffffffff) {
    throw new ZipError("it's a zip64 file, which archives don't use.");
  }
  if (centralOffset + centralSize > end) throw new ZipError("its central directory is cut short.");
  const entries: ZipEntry[] = [];
  let at = centralOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) {
      throw new ZipError(`its central directory's entry ${String(i + 1)} is damaged.`);
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const headerOffset = view.getUint32(at + 42, true);
    let path: string;
    try {
      path = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    } catch {
      throw new ZipError(`its entry ${String(i + 1)} has a name that isn't UTF-8.`);
    }
    if ((flags & 1) !== 0) throw new ZipError(`${path} is encrypted.`);
    if (method !== STORED && method !== DEFLATED) {
      throw new ZipError(
        `${path} is compressed with method ${String(method)}; only stored and deflated are allowed.`,
      );
    }
    if (headerOffset + 30 > bytes.length || view.getUint32(headerOffset, true) !== 0x04034b50) {
      throw new ZipError(`${path}'s local header is missing.`);
    }
    const dataOffset =
      headerOffset +
      30 +
      view.getUint16(headerOffset + 26, true) +
      view.getUint16(headerOffset + 28, true);
    if (dataOffset + compressedSize > centralOffset) throw new ZipError(`${path} is cut short.`);
    entries.push({ path, method, crc, size, compressedSize, headerOffset, dataOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * An entry's contents, inflated if need be.
 * @throws ZipError if they don't match its size and CRC-32.
 */
export async function entryData(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const raw = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let data: Uint8Array;
  try {
    data = entry.method === DEFLATED ? await inflate(raw) : raw;
  } catch {
    throw new ZipError(`${entry.path} can't be decompressed.`);
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc) {
    throw new ZipError(`${entry.path} is damaged: its contents don't match its checksum.`);
  }
  return data;
}
