/**
 * Mappings between a generated module and the passage file it came from, and
 * their encoding as a standard (version 3) source map.
 */
import { locator } from "../passages/positions.js";

/**
 * One mapping from generated code to passage source.
 *
 * @remarks
 * With a `length`, the generated text is copied verbatim from the source, so
 * every offset inside it maps exactly. Without one, it marks where generated
 * scaffolding for a source construct begins.
 */
export type Mapping = {
  /** Offset in the generated code. */
  readonly generated: number;
  /** Offset in the passage source. */
  readonly source: number;
  /** Length of verbatim copied code, or 0 for a point mapping. */
  readonly length: number;
};

/** A version 3 source map, as JSON. */
export type SourceMap = {
  /** Always 3. */
  readonly version: 3;
  /** The generated file. */
  readonly file: string;
  /** The passage file. */
  readonly sources: readonly [string];
  /** The passage file's text. */
  readonly sourcesContent: readonly [string];
  /** Unused. */
  readonly names: readonly [];
  /** The encoded mappings. */
  readonly mappings: string;
};

/**
 * Maps an offset in generated code back to the passage source: exactly inside
 * copied code, and otherwise to the start of the nearest construct before it.
 * Returns undefined before the first mapping.
 */
export function toSource(mappings: readonly Mapping[], generated: number): number | undefined {
  let best: Mapping | undefined;
  for (const m of mappings) {
    if (m.generated > generated) break;
    if (m.length > 0 && generated < m.generated + m.length)
      return m.source + generated - m.generated;
    best = m;
  }
  if (!best) return undefined;
  return best.length > 0 ? best.source + best.length : best.source;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(value: number): string {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = "";
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += BASE64[digit];
  } while (v > 0);
  return out;
}

/** Encodes `mappings` (sorted by generated offset) as a source map. */
export function encodeSourceMap(
  mappings: readonly Mapping[],
  generatedCode: string,
  generatedFile: string,
  sourceFile: string,
  source: string,
): SourceMap {
  const gen = locator(generatedCode);
  const src = locator(source);
  // Points: every mapping start, plus each generated line start inside copied code.
  const points: { gen: number; src: number }[] = [];
  for (const m of mappings) {
    points.push({ gen: m.generated, src: m.source });
    for (let i = 0; i < m.length; i++) {
      if (generatedCode[m.generated + i] === "\n" && i + 1 < m.length) {
        points.push({ gen: m.generated + i + 1, src: m.source + i + 1 });
      }
    }
  }
  const lines: string[][] = [];
  let lastCol = 0;
  let lastLine = 0;
  let lastSrcLine = 0;
  let lastSrcCol = 0;
  for (const p of points) {
    const g = gen.locate(p.gen);
    const s = src.locate(p.src);
    while (lines.length < g.line) lines.push([]);
    if (g.line - 1 !== lastLine) {
      lastLine = g.line - 1;
      lastCol = 0;
    }
    const segment =
      vlq(g.column - 1 - lastCol) +
      vlq(0) +
      vlq(s.line - 1 - lastSrcLine) +
      vlq(s.column - 1 - lastSrcCol);
    lastCol = g.column - 1;
    lastSrcLine = s.line - 1;
    lastSrcCol = s.column - 1;
    lines[g.line - 1]?.push(segment);
  }
  return {
    version: 3,
    file: generatedFile,
    sources: [sourceFile],
    sourcesContent: [source],
    names: [],
    mappings: lines.map((l) => l.join(",")).join(";"),
  };
}
