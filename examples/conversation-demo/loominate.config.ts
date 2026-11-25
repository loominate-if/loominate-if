import { defineConfig } from "@loominate-if/cli";

export default defineConfig({
  game: { id: "wayfarers-rest", version: "1.0.0" },
  title: "The Wayfarer's Rest",
  author: "Loominate IF",
  start: "Arrival",
  extensions: ["@loominate-if/world"],
});
