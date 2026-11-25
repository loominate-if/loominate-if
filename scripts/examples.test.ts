// The acceptance games in examples/ (ADR 0027): each passes its walkthroughs,
// builds to both targets, and, for gate 1, carries no world-model code.
// Gate 2 is the world-model piece; gate 3, the conversation-driven one, also
// has nothing its coverage report says can't be reached, and nothing unreached.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { build, coverage, test } from "../packages/cli/src/index.ts";

const repo = join(import.meta.dirname, "..");
const options = (root: string) => ({
  root,
  conditions: ["source"],
  vite: { configFile: false as const, logLevel: "silent" as const },
});

/** Nested runs report to the console; keep it to this run's own. */
let quiet: { mockRestore(): void }[] = [];
beforeAll(() => {
  quiet = [
    vi.spyOn(process.stdout, "write").mockImplementation(() => true),
    vi.spyOn(process.stderr, "write").mockImplementation(() => true),
  ];
});
afterAll(() => {
  for (const spy of quiet) spy.mockRestore();
});

describe("gate 1: examples/branching-story", () => {
  const root = join(repo, "examples/branching-story");

  it("passes its walkthroughs", async () => {
    const result = await test(options(root));
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.tests).toBeGreaterThanOrEqual(8);
  }, 120_000);

  it("builds to the static site and the single file, with no world-model code", async () => {
    await build(options(root));
    await build({ ...options(root), target: "single" });
    const dist = join(root, "dist");
    expect(existsSync(join(dist, "index.html"))).toBe(true);
    expect(existsSync(join(dist, "the-last-watch.html"))).toBe(true);
    const bundles = [
      readFileSync(join(dist, "the-last-watch.html"), "utf8"),
      ...readdirSync(join(dist, "assets")).map((f) =>
        readFileSync(join(dist, "assets", f), "utf8"),
      ),
    ];
    for (const code of bundles) expect(code).not.toContain("loominate-if/world");
    // "Use it or not": a plain story depends on core and presentation alone.
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      "@loominate-if/core",
      "@loominate-if/presentation",
    ]);
  }, 120_000);
});

describe("gate 2: examples/world-model", () => {
  const root = join(repo, "examples/world-model");

  it("passes its walkthroughs", async () => {
    const result = await test(options(root));
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.tests).toBeGreaterThanOrEqual(7);
  }, 120_000);

  it("builds to the static site and the single file, with the world model", async () => {
    await build(options(root));
    await build({ ...options(root), target: "single" });
    const dist = join(root, "dist");
    expect(existsSync(join(dist, "index.html"))).toBe(true);
    const single = readFileSync(join(dist, "the-tollhouse.html"), "utf8");
    expect(single).toContain("toll keeper");
  }, 120_000);
});

describe("gate 3: examples/conversation-demo", () => {
  const root = join(repo, "examples/conversation-demo");

  it("passes its walkthroughs", async () => {
    const result = await test(options(root));
    expect(result.failed).toBe(0);
    expect(result.passed).toBe(true);
    expect(result.tests).toBeGreaterThanOrEqual(14);
  }, 120_000);

  it("has nothing that can't be reached, and its walkthroughs reach every topic, node, fact, and passage", async () => {
    const report = await coverage(options(root));
    expect(report.unreachable).toEqual([]);
    expect(report.notReached.map((c) => [c.check, c.missed])).toEqual(
      report.notReached.map((c) => [c.check, []]),
    );
    expect(report.notReached.map((c) => c.check)).toEqual(
      expect.arrayContaining(["passages", "topics", "facts", "nodes"]),
    );
  }, 120_000);

  it("builds to the static site and the single file, with the world model", async () => {
    await build(options(root));
    await build({ ...options(root), target: "single" });
    const dist = join(root, "dist");
    expect(existsSync(join(dist, "index.html"))).toBe(true);
    const single = readFileSync(join(dist, "wayfarers-rest.html"), "utf8");
    expect(single).toContain("Wayfarer's Rest");
  }, 120_000);
});
