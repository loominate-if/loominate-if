import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPacked,
  checkRelease,
  ENGINE_VERSION_FILE,
  publishedPackages,
  REPOSITORY_URL,
  setVersion,
} from "./release.ts";

const REPO = resolve(import.meta.dirname, "..");

/** A manifest that's ready to publish, for the package in `dir`. */
const ready = (name: string, dir: string, extra: Record<string, unknown> = {}) => ({
  name,
  version: "0.1.0",
  license: "MIT",
  repository: { type: "git", url: REPOSITORY_URL, directory: dir },
  files: ["dist"],
  publishConfig: { access: "public" },
  ...extra,
});

/** A repo with the given package manifests, by folder. */
function repoWith(manifests: Record<string, Record<string, unknown>>): string {
  const repo = mkdtempSync(join(tmpdir(), "release-"));
  for (const [dir, json] of Object.entries(manifests)) {
    mkdirSync(join(repo, dir), { recursive: true });
    writeFileSync(join(repo, dir, "package.json"), `${JSON.stringify(json, null, 2)}\n`);
  }
  return repo;
}

describe("the repository", () => {
  it("is ready to publish", () => {
    expect(checkRelease(REPO)).toEqual([]);
  });

  it("publishes the packages authors install and the ones the CLI needs", () => {
    expect(publishedPackages(REPO).map((p) => p.name)).toEqual([
      "@loominate-if/cli",
      "@loominate-if/compiler",
      "@loominate-if/core",
      "@loominate-if/create",
      "@loominate-if/inspector",
      "@loominate-if/presentation",
      "@loominate-if/testing",
    ]);
  });

  it("depends on its own packages with ranges npm can share", () => {
    for (const p of publishedPackages(REPO)) {
      for (const [dep, range] of Object.entries(
        (p.json.dependencies as Record<string, string> | undefined) ?? {},
      )) {
        if (dep.startsWith("@loominate-if/"))
          expect([p.name, dep, range]).toEqual([p.name, dep, "workspace:^"]);
      }
    }
  });
});

describe("checkRelease", () => {
  it("leaves out private packages and examples", () => {
    const repo = repoWith({
      "packages/core": ready("@loominate-if/core", "packages/core"),
      "packages/secret": { name: "@loominate-if/secret", private: true },
      "examples/game": { name: "game", version: "1.0.0" },
    });
    expect(publishedPackages(repo).map((p) => p.name)).toEqual(["@loominate-if/core"]);
    expect(checkRelease(repo)).toEqual([]);
  });

  it("wants one version for every package", () => {
    const repo = repoWith({
      "packages/core": ready("@loominate-if/core", "packages/core"),
      "packages/cli": ready("@loominate-if/cli", "packages/cli", { version: "0.2.0" }),
    });
    expect(checkRelease(repo)).toEqual([
      "The published packages must share one version, but have 0.2.0, 0.1.0. Set them with `node scripts/release.ts version <version>`.",
    ]);
  });

  it("explains each missing field", () => {
    const repo = repoWith({ "packages/core": { name: "@loominate-if/core", version: "next" } });
    expect(checkRelease(repo)).toEqual([
      'packages/core/package.json: "version" must be a version like 0.1.0.',
      'packages/core/package.json: "license" must be "MIT".',
      `packages/core/package.json: "repository" must be { "type": "git", "url": "${REPOSITORY_URL}", "directory": "packages/core" }, so npm can check its provenance.`,
      'packages/core/package.json: "publishConfig" must have "access": "public", as a scoped package is private otherwise.',
      'packages/core/package.json: "files" must include "dist".',
    ]);
  });

  it("refuses a runtime dependency on a package that isn't published", () => {
    const repo = repoWith({
      "packages/cli": ready("@loominate-if/cli", "packages/cli", {
        dependencies: { "@loominate-if/secret": "workspace:^" },
        devDependencies: { "@loominate-if/other": "workspace:*" },
      }),
      "packages/secret": { name: "@loominate-if/secret", private: true },
    });
    expect(checkRelease(repo)).toEqual([
      "packages/cli/package.json: it depends on @loominate-if/secret, which isn't published.",
    ]);
  });

  it("checks the tag against the version", () => {
    const repo = repoWith({ "packages/core": ready("@loominate-if/core", "packages/core") });
    expect(checkRelease(repo, "v0.1.0")).toEqual([]);
    expect(checkRelease(repo, "v0.2.0")).toEqual([
      "The tag v0.2.0 doesn't match the packages' version, 0.1.0: tag v0.1.0 instead.",
    ]);
  });
});

describe("setVersion", () => {
  it("sets every published package's version, and nothing else", () => {
    const repo = repoWith({
      "packages/core": ready("@loominate-if/core", "packages/core"),
      "packages/cli": ready("@loominate-if/cli", "packages/cli"),
      "packages/secret": { name: "@loominate-if/secret", version: "0.0.0", private: true },
    });
    setVersion(repo, "0.2.0");
    const version = (dir: string) =>
      (JSON.parse(readFileSync(join(repo, dir, "package.json"), "utf8")) as { version: string })
        .version;
    expect([version("packages/core"), version("packages/cli"), version("packages/secret")]).toEqual(
      ["0.2.0", "0.2.0", "0.0.0"],
    );
    expect(checkRelease(repo, "v0.2.0")).toEqual([]);
  });

  it("sets core's ENGINE_VERSION to match", () => {
    const repo = repoWith({ "packages/core": ready("@loominate-if/core", "packages/core") });
    mkdirSync(join(repo, "packages/core/src/save"), { recursive: true });
    const engine = join(repo, ENGINE_VERSION_FILE);
    writeFileSync(engine, '/** The version. */\nexport const ENGINE_VERSION = "0.1.0";\n');
    setVersion(repo, "0.2.0");
    expect(readFileSync(engine, "utf8")).toBe(
      '/** The version. */\nexport const ENGINE_VERSION = "0.2.0";\n',
    );
  });

  it("refuses something that isn't a version", () => {
    expect(() => {
      setVersion(repoWith({}), "latest");
    }).toThrow('"latest" isn\'t a version like 0.1.0.');
  });
});

describe("checkPacked", () => {
  const packed = {
    name: "@loominate-if/cli",
    bin: { loominate: "./dist/bin.js" },
    exports: {
      ".": { source: "./src/index.ts", types: "./dist/index.d.ts", default: "./dist/index.js" },
    },
    dependencies: { "@loominate-if/compiler": "^0.1.0" },
  };
  const files = [
    "package/package.json",
    "package/dist/bin.js",
    "package/dist/index.d.ts",
    "package/dist/index.js",
  ];

  it("passes a packed manifest with its files", () => {
    expect(checkPacked(packed, files)).toEqual([]);
  });

  it("finds a workspace range pnpm didn't rewrite", () => {
    expect(
      checkPacked({ ...packed, dependencies: { "@loominate-if/compiler": "workspace:^" } }, files),
    ).toEqual(['@loominate-if/cli: @loominate-if/compiler is still "workspace:^".']);
  });

  it("finds exported and bin files that weren't packed", () => {
    expect(checkPacked(packed, ["package/package.json", "package/dist/index.d.ts"])).toEqual([
      "@loominate-if/cli: the package is missing dist/bin.js. Run `pnpm build` first.",
      "@loominate-if/cli: the package is missing dist/index.js. Run `pnpm build` first.",
    ]);
  });
});
