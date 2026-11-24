import { build } from "esbuild";
import { transformAsync } from "@babel/core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";

// Measures against this checkout's core by default, so numbers track the runtime as it grows.
const core =
  process.argv[2] ?? fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url));
const solidPlugin = {
  name: "solid",
  setup(b) {
    b.onLoad({ filter: /solid\.tsx$/ }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const out = await transformAsync(src, {
        filename: args.path,
        presets: [
          ["babel-preset-solid", { generate: "dom" }],
          ["@babel/preset-typescript", {}],
        ],
      });
      return { contents: out.code, loader: "js" };
    });
  },
};

const variants = {
  baseline: { entry: "src/baseline.ts" },
  vanilla: { entry: "src/vanilla.ts" },
  preact: { entry: "src/preact.tsx", jsx: "automatic", jsxImportSource: "preact" },
  "preact-signals": {
    entry: "src/preact-signals.tsx",
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  solid: { entry: "src/solid.tsx", plugins: [solidPlugin] },
};

await mkdir("dist", { recursive: true });
const rows = [];
for (const [name, v] of Object.entries(variants)) {
  const result = await build({
    entryPoints: [v.entry],
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    write: false,
    alias: { "@loominate-if/core": core },
    conditions: ["browser", "production"],
    define: { "process.env.NODE_ENV": '"production"' },
    jsx: v.jsx,
    jsxImportSource: v.jsxImportSource,
    plugins: v.plugins ?? [],
    metafile: true,
  });
  const code = result.outputFiles[0].contents;
  await writeFile(`dist/${name}.js`, code);
  const inputs = result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].inputs;
  const fw = Object.entries(inputs)
    .filter(([p]) => p.includes("node_modules"))
    .reduce((n, [, i]) => n + i.bytesInOutput, 0);
  rows.push({
    name,
    min: code.length,
    gzip: gzipSync(code, { level: 9 }).length,
    brotli: brotliCompressSync(code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    frameworkMin: fw,
  });
}
const base = rows.find((r) => r.name === "baseline");
for (const r of rows) {
  r.uiGzip = r.gzip - base.gzip;
  r.uiBrotli = r.brotli - base.brotli;
}
console.table(rows);
await writeFile("dist/sizes.json", JSON.stringify(rows, null, 2));
