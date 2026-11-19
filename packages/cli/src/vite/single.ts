/**
 * The single-file build target (#56, ADR 0025): one HTML file with the
 * game's script, styles, and assets inlined, which opens by double-click with
 * no server. Browsers won't load module scripts from `file:` URLs, but an
 * inline module script needs nothing loaded.
 */
import type { Plugin, UserConfig } from "vite";

/** Vite settings that put the whole game in one script, with assets as data URLs. */
export const singleFileConfig: UserConfig = {
  build: {
    // Only one file is written, so a static build already in dist/ stays beside it.
    emptyOutDir: false,
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    modulePreload: false,
    rolldownOptions: { output: { codeSplitting: false } },
  },
};

/** A script's text made safe to put between `<script>` tags. */
const scriptText = (code: string): string => code.replace(/<\/(script)/gi, "<\\/$1");
/** A stylesheet's text made safe to put between `<style>` tags. */
const styleText = (code: string): string => code.replace(/<\/(style)/gi, "<\\/$1");

/**
 * Inlines the built script and styles into `index.html`, removes them from
 * the output, and writes the page as `<fileName>`.
 */
export function singleFile(fileName: string): Plugin {
  return {
    name: "loominate-single-file",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const page = bundle["index.html"];
      if (page?.type !== "asset") {
        this.error("The single-file target needs the game's index.html.");
      }
      let html = String(page.source);
      const take = (url: string): string | undefined => {
        const name = url.replace(/^\.\//, "");
        const file = bundle[name];
        if (!file) return undefined;
        // Inlined, so it's no longer written as a file of its own.
        Reflect.deleteProperty(bundle, name);
        return file.type === "chunk" ? file.code : String(file.source);
      };
      html = html.replace(
        /<script type="module"[^>]*\ssrc="([^"]+)"[^>]*><\/script>/g,
        (tag, url: string) => {
          const code = take(url);
          return code === undefined ? tag : `<script type="module">${scriptText(code)}</script>`;
        },
      );
      html = html.replace(
        /<link rel="stylesheet"[^>]*\shref="([^"]+)"[^>]*>/g,
        (tag, url: string) => {
          const code = take(url);
          return code === undefined ? tag : `<style>${styleText(code)}</style>`;
        },
      );
      const left = Object.keys(bundle).filter((name) => name !== "index.html");
      if (left.length > 0) {
        this.error(
          `The single-file target couldn't inline ${left.join(", ")}. Files in public/ are copied as they are; put assets the game needs where its code imports them instead.`,
        );
      }
      delete bundle["index.html"];
      this.emitFile({ type: "asset", fileName, source: html });
    },
  };
}
