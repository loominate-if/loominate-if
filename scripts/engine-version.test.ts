import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Core has no Node types, so this check lives here: saves record ENGINE_VERSION
// (ADR 0010), and it must be core's package version.
describe("ENGINE_VERSION", () => {
  it("is @loominate-if/core's package version", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const pkg = JSON.parse(read("../packages/core/package.json")) as { version: string };
    const source = read("../packages/core/src/save/save.ts");
    const constant = /^export const ENGINE_VERSION = "([^"]+)";$/m.exec(source)?.[1];
    expect(constant).toBe(pkg.version);
  });
});
