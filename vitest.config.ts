import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace packages to their TypeScript sources, so tests never need a build first.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["packages/**/src/**/*.test.ts", "scripts/**/*.test.ts"],
    // Zed clones the repository there for the grammar when the extension is installed (#411).
    exclude: ["**/node_modules/**", "packages/zed/grammars/**"],
  },
});
