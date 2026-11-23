import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDependency,
  checkRepo,
  classify,
  findEscapingImports,
  type Kind,
} from "./check-deps.ts";

function kind(dir: string): Kind {
  const k = classify(dir);
  if (!k) throw new Error(`unclassified ${dir}`);
  return k;
}

function allowed(from: string, to: string): boolean {
  return checkDependency(from, kind(from), to, kind(to)) === undefined;
}

describe("classify", () => {
  it("ranks runtime layers and kits", () => {
    expect(classify("packages/core")).toEqual({ kind: "runtime", rank: 0 });
    expect(classify("packages/world")).toEqual({ kind: "runtime", rank: 2 });
    expect(classify("packages/kits/rpg")).toEqual({ kind: "runtime", rank: 3 });
  });

  it("recognizes tooling and examples", () => {
    expect(classify("packages/cli")).toEqual({ kind: "tooling", noOptionalRuntime: false });
    expect(classify("packages/inspector")).toEqual({ kind: "tooling", noOptionalRuntime: true });
    expect(classify("examples/branching-story")).toEqual({ kind: "example" });
  });

  it("leaves unknown packages unclassified", () => {
    expect(classify("packages/mystery")).toBeUndefined();
    expect(classify("tools/thing")).toBeUndefined();
  });
});

describe("checkDependency", () => {
  it("allows runtime dependencies that flow downward", () => {
    expect(allowed("packages/presentation", "packages/core")).toBe(true);
    expect(allowed("packages/world", "packages/presentation")).toBe(true);
    expect(allowed("packages/kits/rpg", "packages/world")).toBe(true);
  });

  it("rejects upward and sideways runtime dependencies", () => {
    expect(allowed("packages/core", "packages/world")).toBe(false);
    expect(allowed("packages/core", "packages/presentation")).toBe(false);
    expect(allowed("packages/kits/rpg", "packages/kits/procgen")).toBe(false);
  });

  it("rejects runtime packages depending on tooling", () => {
    expect(allowed("packages/core", "packages/compiler")).toBe(false);
    expect(allowed("packages/presentation", "packages/inspector")).toBe(false);
  });

  it("keeps compiler and inspector independent of optional packages", () => {
    expect(allowed("packages/compiler", "packages/core")).toBe(true);
    expect(allowed("packages/inspector", "packages/presentation")).toBe(true);
    expect(allowed("packages/inspector", "packages/world")).toBe(false);
    expect(allowed("packages/compiler", "packages/kits/vn")).toBe(false);
    expect(allowed("packages/inspector", "packages/kits/rpg")).toBe(false);
    expect(allowed("packages/inspector", "packages/parser")).toBe(false);
  });

  it("lets other tooling and examples depend on anything but examples", () => {
    expect(allowed("packages/cli", "packages/world")).toBe(true);
    expect(allowed("packages/testing", "packages/compiler")).toBe(true);
    expect(allowed("examples/branching-story", "packages/cli")).toBe(true);
    expect(allowed("packages/cli", "examples/branching-story")).toBe(false);
  });
});

describe("findEscapingImports", () => {
  const pkg = "/repo/packages/core";
  const file = "/repo/packages/core/src/state/store.ts";

  it("ignores imports that stay inside the package", () => {
    const src = `import { a } from "./a.js";\nimport b from "../index.js";`;
    expect(findEscapingImports(pkg, file, src)).toEqual([]);
  });

  it("ignores package-name imports", () => {
    expect(findEscapingImports(pkg, file, `import { x } from "@loominate-if/world";`)).toEqual([]);
  });

  it("reports static, dynamic, and side-effect imports that leave the package", () => {
    const src = [
      `import { w } from "../../../world/src/index.js";`,
      `const m = await import("../../../world/src/m.js");`,
      `import "../../../presentation/src/side.js";`,
      `export * from "../../../cli/src/x.js";`,
    ].join("\n");
    expect(findEscapingImports(pkg, file, src)).toEqual([
      "../../../world/src/index.js",
      "../../../world/src/m.js",
      "../../../presentation/src/side.js",
      "../../../cli/src/x.js",
    ]);
  });
});

describe("checkRepo", () => {
  function repo(
    pkgs: Record<
      string,
      {
        deps?: string[];
        src?: string;
        json?: Record<string, unknown>;
        files?: Record<string, string>;
      }
    >,
  ): string {
    const root = mkdtempSync(join(tmpdir(), "check-deps-"));
    for (const [dir, { deps = [], src, json = {}, files = {} }] of Object.entries(pkgs)) {
      mkdirSync(join(root, dir, "src"), { recursive: true });
      const name = `@loominate-if/${dir.split("/").at(-1)}`;
      const dependencies = Object.fromEntries(
        deps.map((d) => [`@loominate-if/${d}`, "workspace:*"]),
      );
      writeFileSync(
        join(root, dir, "package.json"),
        JSON.stringify({ name, dependencies, ...json }),
      );
      if (src) writeFileSync(join(root, dir, "src", "index.ts"), src);
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(join(root, dir, file, ".."), { recursive: true });
        writeFileSync(join(root, dir, file), text);
      }
    }
    return root;
  }

  it("passes a correctly layered workspace", () => {
    const root = repo({
      "packages/core": {},
      "packages/presentation": { deps: ["core"] },
      "packages/cli": { deps: ["core", "presentation"] },
    });
    expect(checkRepo(root)).toEqual([]);
  });

  it("reports an upward dependency with the offending package.json", () => {
    const root = repo({ "packages/core": { deps: ["presentation"] }, "packages/presentation": {} });
    const errors = checkRepo(root);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^packages\/core\/package\.json: .*flow downward only/);
  });

  it("reports the inspector depending on the world model or a kit, even to test with (#188)", () => {
    const root = repo({
      "packages/core": {},
      "packages/presentation": { deps: ["core"] },
      "packages/world": { deps: ["core", "presentation"] },
      "packages/kits/rpg": { deps: ["core", "world"] },
      "packages/inspector": { deps: ["core", "presentation", "world", "rpg"] },
    });
    expect(checkRepo(root)).toEqual([
      "packages/inspector/package.json: packages/inspector depends on optional package packages/world; it must stay usable without it. Have packages/world register into packages/inspector's extension API instead.",
      "packages/inspector/package.json: packages/inspector depends on optional package packages/kits/rpg; it must stay usable without it. Have packages/kits/rpg register into packages/inspector's extension API instead.",
    ]);
  });

  it("reports unknown packages and escaping relative imports", () => {
    const root = repo({
      "packages/core": { src: `import x from "../../presentation/src/index.js";` },
      "packages/presentation": {},
      "packages/mystery": {},
    });
    const errors = checkRepo(root);
    expect(errors).toContain(
      "packages/mystery: unknown package; classify it in scripts/check-deps.ts.",
    );
    expect(errors.some((e) => e.startsWith("packages/core/src/index.ts: relative import"))).toBe(
      true,
    );
  });

  describe("a runtime package's inspector module (#91, ADR 0055)", () => {
    const inspector = "@loominate-if/inspector";
    const world = (json: Record<string, unknown>, files: Record<string, string> = {}) =>
      repo({
        "packages/core": {},
        "packages/presentation": { deps: ["core"] },
        "packages/inspector": { deps: ["core", "presentation"] },
        "packages/world": { deps: ["core", "presentation"], json, files },
      });
    const module = {
      loominate: { inspector: "./dist/inspector/inspector.js" },
      peerDependencies: { [inspector]: "workspace:^" },
      peerDependenciesMeta: { [inspector]: { optional: true } },
      devDependencies: { [inspector]: "workspace:^" },
    };

    it("may use the inspector, as an optional peer, from its own folder", () => {
      const root = world(module, {
        "src/inspector/inspector.ts": `import { panels } from "${inspector}";`,
      });
      expect(checkRepo(root)).toEqual([]);
    });

    it("but nothing else in the package may import it", () => {
      const root = world(module, { "src/things.ts": `import { panels } from "${inspector}";` });
      expect(checkRepo(root)).toEqual([
        `packages/world/src/things.ts: imports ${inspector}, which only the package's inspector module may, so the inspector stays out of game builds. Move it into the inspector module.`,
      ]);
    });

    it("and only as an optional peer, for a module it names", () => {
      const required = world({ ...module, peerDependenciesMeta: {} });
      expect(checkRepo(required)[0]).toMatch(/only as an optional peer dependency/);
      const unnamed = world({ ...module, loominate: {} });
      expect(checkRepo(unnamed)[0]).toMatch(/except for an inspector module of their own/);
    });
  });
});
