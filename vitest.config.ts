import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolve workspace packages to their TypeScript sources, so tests never need a build first.
  resolve: { conditions: ["source"] },
  ssr: { resolve: { conditions: ["source"] } },
  test: {
    include: ["packages/**/src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
