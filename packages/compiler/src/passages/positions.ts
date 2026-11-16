/** Turning source offsets into the line and column authors see. */
import type { Diagnostic } from "./syntax.js";

/** Converts offsets in one source text to 1-based lines and columns. */
export type Locator = {
  /** The line and column of `offset`, both from 1. */
  locate(offset: number): { line: number; column: number };
  /** An error diagnostic for `start`…`end`. */
  error(message: string, start: number, end?: number): Diagnostic;
};

/** Creates a {@link Locator} for `source`. */
export function locator(source: string): Locator {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const locate = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (lineStarts[lo] ?? 0) + 1 };
  };
  return {
    locate,
    error: (message, start, end = start + 1) => ({
      severity: "error",
      message,
      span: { start, end },
      ...locate(start),
    }),
  };
}
