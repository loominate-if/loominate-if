import { defineConfig } from "@loominate-if/cli";

export default defineConfig({
  game: { id: "the-tollhouse", version: "1.0.0" },
  title: "The Tollhouse",
  start: "Road",
  extensions: ["@loominate-if/world"],
});
